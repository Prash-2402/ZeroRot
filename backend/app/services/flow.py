"""Field flow: phone entry -> godown (traditional or advanced) -> scan & bag (advanced) -> sell -> transport -> delivery.

Process rates below are operating assumptions (stated, overridable per lot later), not measurements:
  manual loading into a godown 2000 kg/h, grading line throughput 1500 kg/h, bag size 25 kg, unloading at mandi 3000 kg/h,
  reroute turnaround 10 min. Advanced godown chamber: 0.75 kW refrigeration per tonne (min 8 kW), UA 120 W/K, 0.2 ACH.
  Reefer truck 6 kW / UA 45 W/K; open (non-refrigerated) truck UA 400 W/K with 6 ACH through the tarpaulin."""
from __future__ import annotations

import logging
import math
import threading
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (Alert, Inspection, InspectionResult, Lot, NotificationSubscription, ProduceBatch, Shipment, Simulation,
                           StorageFacility, StorageZone, TransportationRoute, Truck)
from app.db.session import SessionLocal
from app.engine.registry import get_produce
from app.integrations import places, push, routing, weather
from app.ml import vision
from app.services import sim_config
from app.simulation import route_geometry as rg
from app.simulation.deterioration_model import predict
from app.simulation.engine import MAX_STORAGE_DAYS
from app.simulation.state import ProduceState
from app.ws.hub import hub

log = logging.getLogger("zerorot.flow")

LOADING_KG_PER_H = 2000.0
GRADING_KG_PER_H = 1500.0
BAG_KG = 25.0
UNLOAD_KG_PER_H = 3000.0
REROUTE_TURNAROUND_S = 600.0
TRANSPORT_RS_PER_KM = 45.0
GRADES = ("A1", "A2", "A3")
# A1 best, A2 medium, A3 low; defect score = lesion share + 1.5 x mould share (from the OpenCV analysis)
GRADE_LIMITS = (("A1", 0.03), ("A2", 0.08), ("A3", 0.20))
# Karnataka APMC market towns; coordinates are resolved live with Open-Meteo geocoding (not hardcoded)
MARKET_TOWNS = ["Bengaluru", "Kolar", "Chikkaballapur", "Chintamani", "Tumakuru", "Mysuru", "Mandya", "Hassan", "Davanagere",
                "Shivamogga", "Hubballi", "Belagavi", "Kalaburagi", "Ballari", "Vijayapura", "Mangaluru", "Chitradurga", "Ramanagara"]
_geo_cache: dict[str, dict | None] = {}


class FlowError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


# ---------------- helpers ----------------
def _manager():
    from app.simulation.manager import manager
    return manager


def _runtime(db: Session, sim_id: int | None):
    if not sim_id:
        return None, None
    sim = db.get(Simulation, sim_id)
    if sim is None:
        return None, None
    try:
        return sim, _manager().runtime(db, sim)
    except ValueError:
        return sim, None


def saleable_kg(rt) -> float:
    p = rt.s.produce
    return p.mass_kg * (1 - p.w) * (1 - p.r)


def add_event(db: Session, lot: Lot, kind: str, title: str, message: str, severity: str = "INFO", sim_id: int | None = None, push_it: bool = True):
    sim_time = None
    sid = sim_id or lot.storage_sim_id
    if sid and sid in _manager().runtimes:
        rt = _manager().runtimes[sid]
        sim_time = rt.live()["sim_time"]
    ev = {"at": datetime.utcnow().isoformat(timespec="seconds"), "sim_time": sim_time, "kind": kind, "title": title, "message": message, "severity": severity}
    lot.events = (list(lot.events or []) + [ev])[-120:]
    db.add(Alert(simulation_id=sid, batch_id=lot.batch_id, severity=severity, code=kind.upper()[:48], title=title, message=message,
                 reading={"lot": lot.id}, expected={}, risk="", recommendation="", status="resolved" if severity == "INFO" else "open"))
    if lot.station_id:
        hub.publish(f"station:{lot.station_id}", {"type": "event", "lot_id": lot.id, "event": ev})
        if push_it:
            for s in db.scalars(select(NotificationSubscription).where(NotificationSubscription.active == True,  # noqa: E712
                                                                       NotificationSubscription.qr_session_id == lot.station_id)).all():
                ok, msg = push.send({"endpoint": s.endpoint, "keys": {"p256dh": s.p256dh, "auth": s.auth}},
                                    {"title": f"ZERO ROT · {title}", "body": message, "url": "/", "tag": f"lot-{lot.id}-{kind}"})
                if not ok and ("410" in msg or "404" in msg):
                    s.active = False
    return ev


def on_sim_alerts(db: Session, sim: Simulation, alerts: list):
    """Forward physics alerts of a lot's simulations to its station (phone + laptop)."""
    lot = db.scalars(select(Lot).where((Lot.storage_sim_id == sim.id))).first()
    if lot is None:
        sh = db.scalars(select(Shipment).where(Shipment.simulation_id == sim.id)).first()
        lot = db.get(Lot, sh.lot_id) if sh else None
    if lot is None or not lot.station_id:
        return
    for a in alerts:
        ev = {"at": datetime.utcnow().isoformat(timespec="seconds"), "sim_time": None, "kind": a.code.lower(), "title": a.title,
              "message": a.message, "severity": a.severity, "recommendation": a.recommendation}
        lot.events = (list(lot.events or []) + [ev])[-120:]
        hub.publish(f"station:{lot.station_id}", {"type": "event", "lot_id": lot.id, "event": ev})


def geocode_town(name: str) -> dict | None:
    if name in _geo_cache:
        return _geo_cache[name]
    try:
        res = weather.geocode(f"{name}", 5)
        hit = next((r for r in res if (r.get("admin1") or "").lower() == "karnataka"), res[0] if res else None)
    except weather.Unavailable:
        return None
    _geo_cache[name] = hit
    return hit


# ---------------- provisioning (stated engineering assumptions) ----------------
def _advanced_zone(db: Session, lot_code: str, b: ProduceBatch, name: str) -> tuple[StorageZone, float, float]:
    p = get_produce(b.commodity_id)
    setpoint = max(p.v("t_ref"), p.v("t_chill") + 0.5)
    rh = (p.v("rh_low") + p.v("rh_high")) / 2
    f = db.scalars(select(StorageFacility).where(StorageFacility.kind == "cold", StorageFacility.name == f"Advanced godown · {name}")).first()
    if f is None:
        f = StorageFacility(name=f"Advanced godown · {name}", kind="cold", location_name=name, lat=b.lat, lng=b.lng)
        db.add(f)
        db.flush()
    tonnes = b.quantity_kg / 1000
    z = StorageZone(facility_id=f.id, name=f"Chamber {lot_code}", temp_min=round(setpoint - 3, 1), temp_max=round(setpoint + 5, 1), setpoint=setpoint,
                    rh_setpoint=rh, capacity_kg=max(10000.0, b.quantity_kg * 1.5), cooling_capacity_kw=max(8.0, 0.75 * tonnes),
                    ua_w_per_k=120.0, volume_m3=max(150.0, b.quantity_kg / 1000 * 15), air_changes_per_hour=0.2, cost_per_kg_day=0.6)
    db.add(z)
    db.flush()
    return z, setpoint, rh


def _truck(db: Session, refrigerated: bool) -> Truck:
    code = "ZR-REEFER-01" if refrigerated else "ZR-OPEN-01"
    t = db.scalars(select(Truck).where(Truck.code == code)).first()
    if t is None:
        t = Truck(code=code, name="Refrigerated truck (6 kW)" if refrigerated else "Open truck with tarpaulin",
                  cooling_capacity_kw=6.0 if refrigerated else 0.0, ua_w_per_k=45.0 if refrigerated else 400.0, cargo_volume_m3=30.0, capacity_kg=12000.0)
        db.add(t)
        db.flush()
    return t


# ---------------- lots ----------------
def create_lot(db: Session, *, commodity: str, quantity_kg: float, quality: float, maturity: str | None, mode: str,
               lat: float, lng: float, location_name: str, station_id: int | None, user_id: int | None, speed: float = 60.0,
               manual_ambient: dict | None = None, plan_days: float = 5.0) -> Lot:
    try:
        p = get_produce(commodity)
    except ValueError as e:
        raise FlowError(422, "unsupported_commodity", str(e))
    if not 50 <= quantity_kg <= 50000:
        raise FlowError(422, "invalid_input", "Quantity must be between 50 kg and 50 tonnes")
    seq = (db.scalar(select(ProduceBatch.id).order_by(ProduceBatch.id.desc())) or 0) + 1
    code = f"ZR-{commodity[:3].upper()}-{seq:05d}"
    b = ProduceBatch(code=code, commodity_id=commodity, quantity_kg=quantity_kg, harvest_time=datetime.utcnow(), initial_quality=quality,
                     maturity=maturity if commodity in ("tomato", "mango", "banana") else None,
                     location_name=location_name, lat=lat, lng=lng, storage_path=mode, status="in_storage", created_by=user_id)
    db.add(b)
    db.flush()
    loading_s = quantity_kg / LOADING_KG_PER_H * 3600.0
    req = {"duration_days": MAX_STORAGE_DAYS, "lat": lat, "lng": lng, "location_name": location_name, "auto_control": True}
    if manual_ambient:
        try:
            req["manual_ambient"] = {"t": float(manual_ambient["t"]), "rh": float(manual_ambient["rh"])}
        except (KeyError, TypeError, ValueError):
            raise FlowError(422, "invalid_input", "manual_ambient needs numeric t and rh")
    if mode == "traditional":
        cfg, e = sim_config.traditional(b, {**req, "structure": "brick"})
        zone_id = None
    else:
        z, sp, rh = _advanced_zone(db, code, b, location_name)
        cfg, e = sim_config.cold_room(b, z, req, sp, rh)
        zone_id = z.id
        cfg["initial_internal_temp"] = None
    if e:
        db.rollback()
        raise FlowError(503 if "unavailable" in e.lower() else 422, "simulation_input_unavailable", e)
    cfg["loading_s"] = loading_s
    cfg["plan_days"] = float(plan_days)
    cfg["loading_rate_kg_h"] = LOADING_KG_PER_H
    if mode == "advanced":
        # crates enter at outside temperature; the chamber starts at its setpoint
        cfg["initial_internal_temp"] = cfg["setpoint"]
    sim = Simulation(kind="traditional_storage" if mode == "traditional" else "cold_storage",
                     name=f"{'Traditional' if mode == 'traditional' else 'Advanced'} godown · {code}", batch_id=b.id, zone_id=zone_id,
                     config=cfg, speed=speed, status="running", created_by=user_id)
    db.add(sim)
    db.flush()
    lot = Lot(batch_id=b.id, station_id=station_id, mode=mode, stage="intake", storage_sim_id=sim.id, speed=speed, created_by=user_id, events=[])
    db.add(lot)
    db.flush()
    try:
        _manager().runtime(db, sim)
    except ValueError as ex:
        db.rollback()
        raise FlowError(422, "invalid_input", str(ex))
    add_event(db, lot, "intake_started", "Intake started",
              f"{quantity_kg:.0f} kg of {p.display_name.lower()} entering the {mode} godown at {location_name} "
              f"(about {loading_s / 60:.0f} min of loading at {LOADING_KG_PER_H:.0f} kg/h).", push_it=False)
    db.commit()
    return lot


# ---------------- grading (scan & bag) ----------------
def _grade_of(obj: dict) -> str:
    if obj["category"] == "uncertain":
        return "uncertain"
    score = obj["features"]["defect_score"]
    for g, lim in GRADE_LIMITS:
        if score < lim:
            return g
    return "rejected"


def grade(db: Session, lot: Lot, images: list[tuple[str, bytes]], user_id: int | None) -> dict:
    if lot.mode != "advanced":
        raise FlowError(409, "not_applicable", "Scan & bag is part of the advanced godown path")
    if lot.stage not in ("storage", "graded"):
        raise FlowError(409, "wrong_stage", f"Lot is in stage '{lot.stage}'; grading needs the produce stored in the godown")
    b = db.get(ProduceBatch, lot.batch_id)
    results, failed = [], []
    for name, data in images[:20]:
        try:
            results.append(vision.inspect(data, name, b.commodity_id))
        except ValueError as e:
            failed.append({"image": name, "error": str(e)})
    if not results:
        raise FlowError(422, "invalid_image", "No image could be inspected")
    objs = [o for r in results for o in r["objects"]]
    counts = {k: 0 for k in (*GRADES, "rejected", "uncertain")}
    items = []
    for o in objs:
        g = _grade_of(o)
        counts[g] += 1
        items.append({"grade": g, "confidence": o["confidence"], "defect_score": o["features"]["defect_score"]})
    classified = sum(counts[k] for k in (*GRADES, "rejected"))
    if classified == 0:
        raise FlowError(422, "nothing_classified", "No produce item could be classified confidently; retake photos on a plain background")
    sim, rt = _runtime(db, lot.storage_sim_id)
    total = saleable_kg(rt) if rt else b.quantity_kg
    shares = {k: counts[k] / classified for k in (*GRADES, "rejected")}
    kg = {k: round(total * shares[k], 1) for k in shares}
    bags = {g: math.ceil(kg[g] / BAG_KG) if kg[g] > 0 else 0 for g in GRADES}
    ins = Inspection(batch_id=b.id, commodity_id=b.commodity_id, method=results[0]["method"], model_version=results[0]["model_version"],
                     images_count=len(results), objects_detected=len(objs), summary={"counts": counts, "shares": shares}, created_by=user_id)
    db.add(ins)
    db.flush()
    for r in results:
        for i, o in enumerate(r["objects"]):
            db.add(InspectionResult(inspection_id=ins.id, image_name=r["image_name"], object_index=i, bbox=o["bbox"], category=o["category"],
                                    confidence=o["confidence"], features=o["features"]))
    if sim is not None and sim.status == "running":
        sim.status = "paused"     # stock leaves the chamber for the grading line
    lot.grading = {"inspection_id": ins.id, "objects": len(objs), "counts": counts, "items": items[:60], "shares": {k: round(v, 4) for k, v in shares.items()},
                   "kg": kg, "bags": bags, "bag_kg": BAG_KG, "total_kg": round(total, 1), "processed_kg": 0.0, "bags_filled": {g: 0 for g in GRADES},
                   "rate_kg_h": GRADING_KG_PER_H, "quality_at_grading": round(rt.s.produce.q, 2) if rt else b.initial_quality,
                   "method": results[0]["method"], "failed_images": failed,
                   "label": "Grades from the photographed sample, extrapolated to the lot (estimate). Uncertain items are excluded and need a manual check."}
    lot.stage = "grading"
    add_event(db, lot, "grading_started", "Scan & bag started",
              f"Sample: {counts['A1']} A1, {counts['A2']} A2, {counts['A3']} A3, {counts['rejected']} rejected, {counts['uncertain']} uncertain. "
              f"Estimated {bags['A1']} A1 / {bags['A2']} A2 / {bags['A3']} A3 bags of {BAG_KG:.0f} kg.", push_it=False)
    db.commit()
    return lot.grading


# ---------------- prediction ----------------
def market_towns(lat: float, lng: float) -> list[dict]:
    out = []
    for name in MARKET_TOWNS:
        g = geocode_town(name)
        if g:
            out.append({"name": f"{g['name']} APMC", "town": g["name"], "lat": g["lat"], "lng": g["lng"],
                        "distance_km": round(rg.haversine_m(lat, lng, g["lat"], g["lng"]) / 1000, 1)})
    return sorted([t for t in out if t["distance_km"] >= 3.0], key=lambda x: x["distance_km"])   # skip the town you are already in


def mandi_rates(db: Session, commodity: str, lat: float, lng: float) -> dict:
    from app.db.models import MarketPrice
    rows = db.scalars(select(MarketPrice).where(MarketPrice.commodity_id == commodity).order_by(MarketPrice.observation_date.desc()).limit(2000)).all()
    if not rows:
        return {"status": "data_unavailable", "message": "No verified mandi prices stored. Configure DATA_GOV_API_KEY (data.gov.in) and refresh prices.",
                "markets": []}
    latest = {}
    for r in rows:
        latest.setdefault(r.market, r)
    markets = []
    for r in latest.values():
        g = geocode_town(r.district or r.market)
        d = round(rg.haversine_m(lat, lng, g["lat"], g["lng"]) / 1000, 1) if g else None
        markets.append({"market": r.market, "district": r.district, "lat": g["lat"] if g else None, "lng": g["lng"] if g else None, "distance_km": d,
                        "modal_per_kg": round(r.price_modal / 100, 2), "min_per_kg": round((r.price_min or r.price_modal) / 100, 2),
                        "max_per_kg": round((r.price_max or r.price_modal) / 100, 2), "date": r.observation_date.date().isoformat(),
                        "age_days": (datetime.utcnow() - r.observation_date).days, "source": r.source})
    markets.sort(key=lambda m: (m["distance_km"] is None, m["distance_km"] or 0))
    return {"status": "ok", "markets": markets[:15], "unit": "Rs/kg", "label": "Verified Agmarknet prices (data.gov.in)"}


def spoilage(db: Session, lot: Lot) -> dict:
    sim, rt = _runtime(db, lot.storage_sim_id)
    if rt is None:
        raise FlowError(409, "no_state", "Storage state unavailable")
    live = rt.live()
    p = rt.s.produce
    pp = get_produce(p.commodity)
    r = live["readings"]
    ideal_t, ideal_rh = max(pp.v("t_ref"), pp.v("t_chill") + 0.5), (pp.v("rh_low") + pp.v("rh_high")) / 2
    here = live["prediction"] or predict(p, r["temperature_c"], r["rh_pct"], 0.0, f"lot-{lot.id}-now", draws=100)
    ideal = predict(ProduceState(p.commodity, p.maturity, p.mass_kg, p.q, p.w, p.r, p.e), ideal_t, ideal_rh, 0.0, f"lot-{lot.id}-ideal", draws=100)
    return {"quality": round(p.q, 1), "q_min": pp.v("q_min"), "saleable_kg": round(saleable_kg(rt), 1), "weight_loss_pct": round(p.w * 100, 2),
            "conditions": {"temperature_c": r["temperature_c"], "rh_pct": r["rh_pct"]}, "current": here,
            "at_recommended": {"temperature_c": ideal_t, "rh_pct": ideal_rh, **ideal}, "sim_time": live["sim_time"],
            "label": "Model estimate (Q10 decay, Monte Carlo P10-P90); assumes conditions stay as stated."}


def decision(db: Session, lot: Lot, price_per_kg: float | None, market: str | None) -> dict:
    from app.services import profit
    b = db.get(ProduceBatch, lot.batch_id)
    sim, rt = _runtime(db, lot.storage_sim_id)
    if rt is None:
        raise FlowError(409, "no_state", "Storage state unavailable")
    rates = mandi_rates(db, b.commodity_id, b.lat, b.lng)
    chosen, origin = None, "manual"
    if rates["status"] == "ok":
        chosen = next((m for m in rates["markets"] if m["market"] == market), None) or max(
            [m for m in rates["markets"] if m["distance_km"] is not None and m["distance_km"] <= 300] or rates["markets"],
            key=lambda m: m["modal_per_kg"])
        if price_per_kg is None:
            price_per_kg = chosen["modal_per_kg"]
            origin = f"verified: {chosen['source']} {chosen['market']} {chosen['date']}"
        else:
            origin = "manual (price quoted by the user)"
    if not price_per_kg:
        raise FlowError(409, "price_unavailable", "No verified mandi price available. Enter today's price you were quoted (Rs/kg) to get a decision.")
    r = rt.readings()
    dist_km = chosen["distance_km"] if chosen and chosen.get("distance_km") else 60.0
    res = profit.evaluate(commodity=b.commodity_id, maturity=b.maturity, quantity_kg=saleable_kg(rt), quality=rt.s.produce.q,
                          price_now_per_kg=price_per_kg, price_origin=origin, forecast_points=None, storage_temp=r["temperature_c"], storage_rh=r["rh_pct"],
                          storage_cost_per_kg_day=0.6 if lot.mode == "advanced" else 0.0, transport_cost=dist_km * TRANSPORT_RS_PER_KM,
                          commission_rate=0.06, other_costs=0.0, max_days=10, seed_key=f"lot-{lot.id}")
    per_grade = None
    if lot.grading and chosen:
        price_for = {"A1": chosen["max_per_kg"], "A2": chosen["modal_per_kg"], "A3": chosen["min_per_kg"]}
        per_grade = {g: {"kg": lot.grading["kg"][g], "price_per_kg": price_for[g], "value": round(lot.grading["kg"][g] * price_for[g], 0)} for g in GRADES}
    out = {"recommendation": res["recommendation"], "best_day": res["best_day"], "sell_now": res["sell_now"], "best": res["best"],
           "gain_vs_now": res["gain_vs_now"], "shelf_life_days": res["shelf_life_days"], "shelf_life_p10_days": res["shelf_life_p10_days"],
           "rows": res["rows"], "assumptions": res["assumptions"] + [f"Transport {TRANSPORT_RS_PER_KM:.0f} Rs/km for {dist_km:.0f} km (assumption).",
                                                                     "Commission 6% (typical APMC; assumption)."],
           "price_per_kg": price_per_kg, "price_origin": origin, "market": chosen, "per_grade": per_grade,
           "grade_price_basis": "A1 at the mandi maximum, A2 at modal, A3 at minimum price" if per_grade else None}
    lot.decision = {k: out[k] for k in ("recommendation", "best_day", "gain_vs_now", "price_per_kg", "price_origin", "shelf_life_days")} | {
        "net_now": res["sell_now"]["net_profit"], "net_best": res["best"]["net_profit"], "at": datetime.utcnow().isoformat(timespec="seconds")}
    db.commit()
    return out


# ---------------- dispatch, tracking, reroute ----------------
def _checkpoints(geom: list, distance_m: float, start_total_m: float, n: int = 5) -> list[dict]:
    cum = rg.cumulative_m(geom)
    scale = cum[-1] / max(1.0, distance_m)
    out = []
    for i in range(1, n + 1):
        d = distance_m * i / (n + 1)
        lat, lng, _ = rg.point_at(geom, cum, d * scale)
        out.append({"name": None, "km": round((start_total_m + d) / 1000, 1), "lat": round(lat, 5), "lng": round(lng, 5), "passed": False, "passed_sim_time": None})
    return out


def _name_checkpoints_async(shipment_id: int):
    def work():
        with SessionLocal() as db:
            sh = db.get(Shipment, shipment_id)
            if sh is None:
                return
            cps = [dict(c) for c in sh.checkpoints]
            for c in cps:
                if not c.get("name"):
                    c["name"] = places.reverse(c["lat"], c["lng"]) or f"Km {c['km']:.0f}"
            sh2 = db.get(Shipment, shipment_id)
            # merge names only (passed flags may have changed meanwhile)
            merged = [dict(c) for c in sh2.checkpoints]
            for m in merged:
                hit = next((c for c in cps if c["km"] == m["km"]), None)
                if hit and not m.get("name"):
                    m["name"] = hit["name"]
            sh2.checkpoints = merged
            db.commit()
    threading.Thread(target=work, daemon=True).start()


def dispatch(db: Session, lot: Lot, *, grade: str, dest_name: str, dest_lat: float, dest_lng: float, user_id: int | None) -> Shipment:
    if lot.stage not in ("storage", "graded"):
        raise FlowError(409, "wrong_stage", f"Lot is in stage '{lot.stage}'; it can be dispatched from the godown or after bagging")
    b = db.get(ProduceBatch, lot.batch_id)
    ssim, srt = _runtime(db, lot.storage_sim_id)
    if srt is None:
        raise FlowError(409, "no_state", "Storage state unavailable")
    if lot.mode == "advanced" and lot.stage == "graded":
        if grade not in GRADES:
            raise FlowError(422, "invalid_input", "Choose a bag grade (A1, A2 or A3) to dispatch")
        if any(s.grade == grade and s.status != "cancelled" for s in db.scalars(select(Shipment).where(Shipment.lot_id == lot.id)).all()):
            raise FlowError(409, "already_dispatched", f"{grade} bags were already dispatched")
        qty = lot.grading["kg"][grade]
        quality = lot.grading["quality_at_grading"]
        if qty <= 0:
            raise FlowError(422, "invalid_input", f"No {grade} produce in this lot")
    else:
        grade = "ALL"
        qty, quality = saleable_kg(srt), srt.s.produce.q
    try:
        options = routing.routes([(b.lat, b.lng), (dest_lat, dest_lng)])
    except routing.Unavailable as e:
        raise FlowError(503, "route_unavailable", f"Route unavailable: {e}")
    r0 = options[0]
    refrigerated = lot.mode == "advanced"
    truck = _truck(db, refrigerated)
    if qty > truck.capacity_kg:
        raise FlowError(422, "over_capacity", f"{qty:.0f} kg exceeds one truck ({truck.capacity_kg:.0f} kg); dispatch by grade")
    route = TransportationRoute(origin_name=b.location_name or "Godown", origin_lat=b.lat, origin_lng=b.lng, dest_name=dest_name, dest_lat=dest_lat,
                                dest_lng=dest_lng, distance_m=r0["distance_m"], duration_s=r0["duration_s"], geometry=r0["geometry"], source=r0["source"])
    db.add(route)
    db.flush()
    pp = get_produce(b.commodity_id)
    from types import SimpleNamespace
    tmp_batch = SimpleNamespace(id=b.id, code=b.code, commodity_id=b.commodity_id, maturity=b.maturity, quantity_kg=qty, initial_quality=quality)
    cfg, e = sim_config.cold_chain(tmp_batch, truck, route, {"target_temp_c": max(pp.v("t_ref"), pp.v("t_chill") + 0.5),
                                                              "initial_internal_temp": srt.readings()["temperature_c"],
                                                              "auto_control": refrigerated, "backup_cooling_available": refrigerated})
    if e:
        db.rollback()
        raise FlowError(503, "simulation_input_unavailable", e)
    if not refrigerated:
        cfg.update(refrigerated=False, setpoint=None, cooling_kw=0.0, ach=6.0)
    from datetime import timedelta
    leave = datetime.fromisoformat(srt.cfg["start_time"]) + timedelta(seconds=srt.s.t_seconds + float((lot.grading or {}).get("elapsed_s", 0.0)))
    cfg["start_time"] = leave.replace(second=0, microsecond=0).isoformat()   # continuous simulated clock: godown -> bagging -> road
    sim = Simulation(kind="cold_chain", name=f"{'Reefer' if refrigerated else 'Open truck'} · {b.code} {grade} → {dest_name}", batch_id=b.id,
                     truck_id=truck.id, route_id=route.id, config=cfg, speed=lot.speed, status="running", created_by=user_id)
    db.add(sim)
    db.flush()
    _manager().runtime(db, sim)
    sh = Shipment(lot_id=lot.id, simulation_id=sim.id, grade=grade, quantity_kg=round(qty, 1), destination_name=dest_name, dest_lat=dest_lat, dest_lng=dest_lng,
                  status="in_transit", checkpoints=_checkpoints(r0["geometry"], r0["distance_m"], 0.0), reroutes=[])
    db.add(sh)
    db.flush()
    remaining_grades = [g for g in GRADES if lot.grading and lot.grading["kg"].get(g, 0) > 0] if lot.stage == "graded" else []
    shipped = {s.grade for s in db.scalars(select(Shipment).where(Shipment.lot_id == lot.id)).all()}
    if grade == "ALL" or set(remaining_grades) <= shipped:
        lot.stage = "dispatched"
        if ssim is not None and ssim.status in ("running", "paused"):
            ssim.status = "completed"
            ssim.config = {**ssim.config, "summary": srt.summary()}
    b.status = "in_transit"
    add_event(db, lot, "dispatched", "Dispatched",
              f"{qty:.0f} kg ({'all produce' if grade == 'ALL' else grade + ' bags'}) left for {dest_name} by {truck.name[0].lower() + truck.name[1:]}: "
              f"{r0['distance_m'] / 1000:.1f} km, about {r0['duration_s'] / 3600:.1f} h by road.", sim_id=sim.id)
    db.commit()
    _name_checkpoints_async(sh.id)
    return sh


def reroute(db: Session, sh: Shipment, reason: str = "Road blocked ahead") -> dict:
    sim, rt = _runtime(db, sh.simulation_id)
    if rt is None or sh.status != "in_transit":
        raise FlowError(409, "not_in_transit", "Shipment is not on the road")
    geom, dist = rt.cfg["route_geometry"], rt.cfg["route_distance_m"]
    cum = rg.cumulative_m(geom)
    scale = cum[-1] / max(1.0, dist)
    here_m = rt.s.route_progress_m
    remaining = dist - here_m
    if remaining < 3000:
        raise FlowError(409, "too_close", "Less than 3 km to the destination; no reroute needed")
    lat0, lng0, _ = rg.point_at(geom, cum, here_m * scale)
    block_m = here_m + min(2500.0, remaining * 0.3)
    blat, blng, bhead = rg.point_at(geom, cum, block_m * scale)

    def avoids(g: list) -> bool:
        return min(rg.haversine_m(blat, blng, y, x) for x, y in g) > 250.0

    cands = []
    try:
        cands = [c for c in routing.routes([(lat0, lng0), (sh.dest_lat, sh.dest_lng)], alternatives=True) if avoids(c["geometry"])]
    except routing.Unavailable:
        pass
    if not cands:
        # detour through points offset perpendicular to the road at the blockage (2.5-8 km either side)
        for off in (2500, 5000, 8000):
            for side in (90, -90):
                h = math.radians(bhead + side)
                vlat = blat + (off * math.cos(h)) / 111320.0
                vlng = blng + (off * math.sin(h)) / (111320.0 * math.cos(math.radians(blat)))
                try:
                    c = routing.routes([(lat0, lng0), (vlat, vlng), (sh.dest_lat, sh.dest_lng)])[0]
                except routing.Unavailable:
                    continue
                if avoids(c["geometry"]):
                    cands.append(c)
            if cands:
                break
    if not cands:
        raise FlowError(503, "no_alternative", "No alternative road found around the blockage")
    best = min(cands, key=lambda c: c["distance_m"])
    with _manager().lock:
        old = rt.reroute(best["geometry"], best["distance_m"], best["duration_s"], reason)
        rt.s.delay_remaining_s = REROUTE_TURNAROUND_S
        sim.config = {**rt.cfg}
    done_total = rt.cfg.get("distance_done_before_m", 0.0)
    passed = [c for c in sh.checkpoints if c.get("passed")]
    new_cps = _checkpoints(best["geometry"], best["distance_m"], done_total, n=max(1, 5 - len(passed)))
    sh.checkpoints = passed + new_cps
    info = {"at": datetime.utcnow().isoformat(timespec="seconds"), "reason": reason, "blocked": [round(blat, 5), round(blng, 5)],
            "at_km": round(done_total / 1000, 1), "old_remaining_km": round(remaining / 1000, 1), "new_remaining_km": round(best["distance_m"] / 1000, 1),
            "added_km": round((best["distance_m"] - remaining) / 1000, 1), "old_geometry": rg.slice_from(old["geometry"], cum, here_m * scale)}
    sh.reroutes = list(sh.reroutes or []) + [info]
    lot = db.get(Lot, sh.lot_id)
    add_event(db, lot, "rerouted", "Rerouted", f"{reason} at km {info['at_km']:.0f}. New road: {info['new_remaining_km']:.1f} km to {sh.destination_name} "
                                               f"({info['added_km']:+.1f} km).", severity="WARNING", sim_id=sim.id)
    db.commit()
    _name_checkpoints_async(sh.id)
    return info


# ---------------- per-tick progress (called by the simulation manager) ----------------
def tick(db: Session, dt_real: float):
    lots = db.scalars(select(Lot).where(Lot.stage.in_(("intake", "storage", "grading", "graded", "dispatched", "arrived")))).all()
    for lot in lots:
        try:
            _tick_lot(db, lot, dt_real)
        except Exception:
            log.exception("lot %s tick failed", lot.id)
    db.commit()


def _sync_sims(db: Session, lot: Lot):
    ids = [lot.storage_sim_id] + [s.simulation_id for s in db.scalars(select(Shipment).where(Shipment.lot_id == lot.id)).all()]
    for sid in ids:
        sim = db.get(Simulation, sid) if sid else None
        if sim is None:
            continue
        sim.speed = lot.speed
        if lot.paused and sim.status == "running":
            sim.status = "paused"
        elif not lot.paused and sim.status == "paused" and not (sid == lot.storage_sim_id and lot.stage not in ("intake", "storage")):
            sim.status = "running"


def _tick_lot(db: Session, lot: Lot, dt_real: float):
    _sync_sims(db, lot)
    if lot.paused:
        return
    dt = lot.speed * dt_real
    if lot.stage == "intake":
        sim, rt = _runtime(db, lot.storage_sim_id)
        if rt and (rt.loading() or {}).get("done"):
            lot.stage = "storage"
            add_event(db, lot, "stored", "Stored in godown", f"All {rt.s.produce.mass_kg:.0f} kg loaded; door closed. "
                      + ("Automatic climate control is active." if lot.mode == "advanced" else "Monitoring with live weather."))
    elif lot.stage == "grading":
        g = dict(lot.grading)
        g["processed_kg"] = min(g["total_kg"], g["processed_kg"] + GRADING_KG_PER_H * dt / 3600.0)
        g["elapsed_s"] = g.get("elapsed_s", 0.0) + dt
        frac = g["processed_kg"] / max(1.0, g["total_kg"])
        g["bags_filled"] = {k: min(g["bags"][k], int(g["bags"][k] * frac)) for k in GRADES}
        lot.grading = g
        if frac >= 1.0:
            g["bags_filled"] = dict(g["bags"])
            lot.grading = g
            lot.stage = "graded"
            add_event(db, lot, "bagged", "Bagging complete", f"{g['bags']['A1']} A1, {g['bags']['A2']} A2 and {g['bags']['A3']} A3 bags ready "
                      f"({g['kg']['rejected']:.0f} kg rejected). Open Predict to choose where to sell each grade.")
    if lot.stage in ("graded", "dispatched", "arrived"):
        ships = db.scalars(select(Shipment).where(Shipment.lot_id == lot.id, Shipment.status != "cancelled")).all()
        for sh in ships:
            _tick_shipment(db, lot, sh, dt)
        if ships and all(s.status in ("arrived", "delivered") for s in ships) and lot.stage == "dispatched" and _all_dispatched(db, lot):
            lot.stage = "arrived"
        if ships and all(s.status == "delivered" for s in ships) and _all_dispatched(db, lot):
            lot.stage = "delivered"
            b = db.get(ProduceBatch, lot.batch_id)
            b.status = "sold"
            add_event(db, lot, "completed", "All deliveries complete", "Every dispatched lot has been delivered. Ask the assistant if you need anything.")


def _all_dispatched(db: Session, lot: Lot) -> bool:
    if not lot.grading:
        return True
    shipped = {s.grade for s in db.scalars(select(Shipment).where(Shipment.lot_id == lot.id)).all()}
    return all(g in shipped for g in GRADES if lot.grading["kg"].get(g, 0) > 0)


def _tick_shipment(db: Session, lot: Lot, sh: Shipment, dt: float):
    sim, rt = _runtime(db, sh.simulation_id)
    if rt is None:
        return
    if sh.status == "in_transit":
        total_done_km = (rt.cfg.get("distance_done_before_m", 0.0) + rt.s.route_progress_m) / 1000
        cps = [dict(c) for c in sh.checkpoints]
        changed = False
        for c in cps:
            if not c["passed"] and total_done_km >= c["km"]:
                c["passed"], c["passed_sim_time"], changed = True, rt.live()["sim_time"], True
                add_event(db, lot, "checkpoint", f"Passed {c.get('name') or 'km ' + str(round(c['km']))}",
                          f"{sh.grade if sh.grade != 'ALL' else 'Truck'} at km {c['km']:.0f} on the way to {sh.destination_name}.", sim_id=sim.id)
        if changed:
            sh.checkpoints = cps
        if rt.finished():
            sh.status = "arrived"
            add_event(db, lot, "arrived", f"Arrived at {sh.destination_name}",
                      f"{sh.quantity_kg:.0f} kg arrived; quality {rt.s.produce.q:.0f}/100. Unloading has started.", sim_id=sim.id)
    elif sh.status == "arrived":
        sh.unload_progress = min(1.0, sh.unload_progress + UNLOAD_KG_PER_H * dt / 3600.0 / max(1.0, sh.quantity_kg))
        if sh.unload_progress >= 1.0:
            sh.status = "delivered"
            sh.delivered_at = datetime.utcnow()
            add_event(db, lot, "delivered", "Delivered", f"{sh.quantity_kg:.0f} kg {'' if sh.grade == 'ALL' else sh.grade + ' '}handed over at {sh.destination_name}.",
                      sim_id=sim.id)


# ---------------- payloads ----------------
def lot_payload(db: Session, lot: Lot, full: bool = False) -> dict:
    b = db.get(ProduceBatch, lot.batch_id)
    out = {"id": lot.id, "code": b.code, "commodity": b.commodity_id, "quantity_kg": b.quantity_kg, "initial_quality": b.initial_quality,
           "maturity": b.maturity, "location": {"name": b.location_name, "lat": b.lat, "lng": b.lng}, "mode": lot.mode, "stage": lot.stage,
           "speed": lot.speed, "paused": lot.paused, "grading": lot.grading, "decision": lot.decision, "events": (lot.events or [])[-30:],
           "created_at": lot.created_at.isoformat(timespec="seconds"), "storage": None, "shipments": []}
    sim, rt = _runtime(db, lot.storage_sim_id)
    if rt is not None:
        lv = rt.live()
        out["storage"] = {"sim_id": sim.id, "status": sim.status, "kind": sim.kind, "sim_time": lv["sim_time"], "t_seconds": lv["t_seconds"],
                          "readings": lv["readings"], "ambient": lv["ambient"], "produce": lv["produce"], "equipment": lv["equipment"],
                          "prediction": lv["prediction"], "flows": lv["flows"], "loading": lv["loading"], "faults": lv["faults"],
                          "active_alerts": lv["active_alerts"], "weather_extras": lv["weather_extras"], "saleable_kg": round(saleable_kg(rt), 1),
                          "sensors": lv["sensors"] if full else None, "setpoint": rt.cfg.get("setpoint"), "dimensions_m": rt.cfg.get("dimensions_m"),
                          "structure": rt.cfg.get("structure")}
    for sh in db.scalars(select(Shipment).where(Shipment.lot_id == lot.id).order_by(Shipment.id)).all():
        ssim, srt = _runtime(db, sh.simulation_id)
        d = {"id": sh.id, "grade": sh.grade, "quantity_kg": sh.quantity_kg, "destination": {"name": sh.destination_name, "lat": sh.dest_lat, "lng": sh.dest_lng},
             "status": sh.status, "checkpoints": sh.checkpoints, "reroute_count": len(sh.reroutes or []), "unload_progress": round(sh.unload_progress, 3),
             "delivered_at": sh.delivered_at.isoformat(timespec="seconds") if sh.delivered_at else None, "sim_id": sh.simulation_id}
        if srt is not None:
            lv = srt.live()
            done = srt.cfg.get("distance_done_before_m", 0.0)
            d["live"] = {"sim_time": lv["sim_time"], "readings": lv["readings"], "ambient": lv["ambient"], "produce": lv["produce"], "equipment": lv["equipment"],
                         "prediction": lv["prediction"], "route": lv["route"], "pose": lv["pose"], "faults": lv["faults"], "flows": lv["flows"],
                         "weather_extras": lv["weather_extras"], "refrigerated": bool(srt.cfg.get("refrigerated", True)), "setpoint": srt.cfg.get("setpoint"),
                         "total_done_km": round((done + srt.s.route_progress_m) / 1000, 2), "total_km": round((done + srt.cfg["route_distance_m"]) / 1000, 2),
                         "status": ssim.status, "sensors": lv["sensors"] if full else None}
        out["shipments"].append(d)
    return out


def shipment_geometry(db: Session, sh: Shipment) -> dict:
    sim, rt = _runtime(db, sh.simulation_id)
    route = db.get(TransportationRoute, sim.route_id) if sim else None
    return {"id": sh.id, "current": rt.cfg["route_geometry"] if rt else None, "current_distance_m": rt.cfg["route_distance_m"] if rt else None,
            "original": route.geometry if route else None, "origin": [route.origin_lat, route.origin_lng] if route else None,
            "destination": [sh.dest_lat, sh.dest_lng], "reroutes": sh.reroutes, "checkpoints": sh.checkpoints, "source": route.source if route else None}


def station_payload(db: Session, station_id: int) -> dict:
    lots = db.scalars(select(Lot).where(Lot.station_id == station_id).order_by(Lot.id.desc()).limit(6)).all()
    return {"type": "station", "station_id": station_id, "at": datetime.utcnow().isoformat(timespec="seconds"), "lots": [lot_payload(db, l) for l in lots]}


def chat_context(db: Session, lot: Lot | None) -> dict:
    if lot is None:
        return {"platform": "ZERO ROT", "note": "No lot selected"}
    p = lot_payload(db, lot)
    st = p.get("storage") or {}
    return {"lot": {k: p[k] for k in ("code", "commodity", "quantity_kg", "mode", "stage", "location")},
            "godown_SIMULATED": {k: st.get(k) for k in ("sim_time", "readings", "ambient", "produce", "prediction", "equipment", "saleable_kg", "faults")},
            "grading": {k: (p["grading"] or {}).get(k) for k in ("counts", "kg", "bags", "label")} if p["grading"] else None,
            "decision": p["decision"],
            "shipments": [{k: s.get(k) for k in ("grade", "quantity_kg", "destination", "status", "checkpoints")} |
                          {"live": {k: (s.get("live") or {}).get(k) for k in ("total_done_km", "total_km", "readings", "produce")}} for s in p["shipments"]],
            "recent_events": [{k: e.get(k) for k in ("title", "message", "severity")} for e in p["events"][-10:]]}
