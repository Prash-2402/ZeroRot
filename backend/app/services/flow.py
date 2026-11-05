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
BAG_KG = 20.0              # one sorting box (crate)
ITEM_Q_SD = 7.0            # item-to-item quality spread within a lot (assumption)
SCAN_LIMITS = (("A1", 85.0), ("A2", 70.0))   # A3 down to the commodity's minimum saleable quality
UNLOAD_KG_PER_H = 3000.0
REROUTE_TURNAROUND_S = 600.0
TRANSPORT_RS_PER_KM = 45.0
GRADES = ("A1", "A2", "A3")
# A1 best, A2 medium, A3 low; defect score = lesion share + 1.5 x mould share (from the OpenCV analysis)
GRADE_LIMITS = (("A1", 0.03), ("A2", 0.08), ("A3", 0.20))
# Karnataka APMC market towns; coordinates are resolved live with Open-Meteo geocoding (not hardcoded)
MARKET_TOWNS = ["Bengaluru", "Kolar", "Chik Ballapur", "Chintamani", "Tumakuru", "Mysuru", "Mandya", "Hassan", "Davangere",
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


EMERGENCY_CODES = {"COOLING_FAILURE", "DOOR_OPEN", "ROUTE_DELAY"}


def is_emergency(code: str, severity: str) -> bool:
    """Only emergencies interrupt the farmer (pop-up + approval). Everything else goes to the log."""
    code = code.upper()
    return code in EMERGENCY_CODES or (severity == "CRITICAL" and code in ("TEMP_EXCURSION", "GAS_ABNORMAL"))


def add_event(db: Session, lot: Lot, kind: str, title: str, message: str, severity: str = "INFO", sim_id: int | None = None, push_it: bool = True,
              log: bool = False):
    sim_time = None
    if sim_id is None:   # narrate on the clock of whatever is moving now (truck), else the godown
        moving = db.scalars(select(Shipment).where(Shipment.lot_id == lot.id, Shipment.status != "delivered").order_by(Shipment.id.desc())).first()
        sim_id = moving.simulation_id if moving and lot.stage not in ("intake", "storage") else None
    sid = sim_id or lot.storage_sim_id
    if sid and sid in _manager().runtimes:
        rt = _manager().runtimes[sid]
        sim_time = rt.live()["sim_time"]
    ev = {"at": datetime.utcnow().isoformat(timespec="seconds"), "sim_time": sim_time, "kind": kind, "title": title, "message": message, "severity": severity,
          "log": log}
    push_it = push_it and not log
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


ACTION_TITLE = {"activate_backup_cooling": "Auto-control: backup cooling on", "adjust_setpoint": "Auto-control: setpoint lowered",
                "ventilate": "Auto-control: ventilation increased", "adjust_humidity": "Auto-control: humidity corrected"}


def on_sim_actions(db: Session, sim: Simulation, actions: list[dict]):
    """Automatic corrective actions of the advanced godown / reefer become notifications on the phone and laptop."""
    lot = db.scalars(select(Lot).where(Lot.storage_sim_id == sim.id)).first()
    if lot is None:
        sh = db.scalars(select(Shipment).where(Shipment.simulation_id == sim.id)).first()
        lot = db.get(Lot, sh.lot_id) if sh else None
    if lot is None:
        return
    for a in actions:
        add_event(db, lot, "auto_" + a["action"], ACTION_TITLE.get(a["action"], "Auto-control action"), a["reason"], severity="INFO", sim_id=sim.id, log=True)


FIX_LABEL = {
    "restore_cooling": "Repair the cooling unit (send technician)", "activate_backup_cooling": "Switch on backup cooling",
    "close_door": "Close the door", "adjust_setpoint": "Lower the setpoint by 1 °C", "raise_setpoint": "Raise the setpoint by 1 °C",
    "ventilate": "Increase ventilation", "open_vents": "Open the vents", "increase_humidity": "Raise humidity setpoint",
    "reduce_humidity": "Fix humidifier and ventilate", "replan_route": "Take an alternative road", "prioritise_batch": "Sell sooner (open the decision)",
}


def _fixes_for(sim: Simulation, a) -> list[str]:
    """Which fixes to offer for an alert. Traditional godowns have no cooling, so heat alerts can only be answered by selling sooner."""
    kind = sim.kind
    code = a.code
    if code == "COOLING_FAILURE":
        return ["restore_cooling", "activate_backup_cooling"]
    if code == "DOOR_OPEN":
        return ["close_door"]
    if code == "TEMP_EXCURSION":
        return ["prioritise_batch"] if kind == "traditional_storage" else ["adjust_setpoint", "restore_cooling"]
    if code == "CHILLING_RISK":
        return ["raise_setpoint"]
    if code == "GAS_ABNORMAL":
        return ["open_vents"] if kind == "traditional_storage" else ["ventilate"]
    if code == "HUMIDITY_DEVIATION":
        low = (a.reading or {}).get("rh_pct", 100) < (a.expected or {}).get("min_pct", 0)
        if kind == "traditional_storage":
            return [] if low else ["open_vents"]
        return ["increase_humidity"] if low else ["reduce_humidity"]
    if code == "ROUTE_DELAY":
        return ["replan_route"]
    if code in ("SPOILAGE_RISK", "ABNORMAL_DETERIORATION"):
        return ["prioritise_batch"]
    return []


def _ensure_fixes(db: Session, sim: Simulation, a) -> list[dict]:
    from app.db.models import CorrectiveAction
    existing = {c.action: c for c in db.scalars(select(CorrectiveAction).where(CorrectiveAction.alert_id == a.id)).all()}
    out = []
    for act in _fixes_for(sim, a):
        c = existing.get(act)
        if c is None:
            c = CorrectiveAction(alert_id=a.id, simulation_id=sim.id, action=act, reason=a.recommendation or "", parameters={"label": FIX_LABEL.get(act)},
                                 automatic=False, applied=False)
            db.add(c)
            db.flush()
        out.append({"id": c.id, "action": act, "label": FIX_LABEL.get(act, act)})
    return out


def pending_fixes(db: Session, lot: Lot) -> list[dict]:
    from app.db.models import CorrectiveAction
    sims = {lot.storage_sim_id: "godown"} if lot.stage in ("intake", "storage") else {}
    for sh in db.scalars(select(Shipment).where(Shipment.lot_id == lot.id, Shipment.status == "in_transit")).all():
        sims[sh.simulation_id] = f"truck {sh.grade if sh.grade != 'ALL' else ''}".strip()
    out = []
    for sid, where in sims.items():
        seen = set()
        handled = set(db.scalars(select(CorrectiveAction.alert_id).where(CorrectiveAction.simulation_id == sid, CorrectiveAction.applied == True,  # noqa: E712
                                                                         CorrectiveAction.automatic == False)).all()) if sid else set()  # noqa: E712
        for c in db.execute(select(CorrectiveAction, Alert).join(Alert, Alert.id == CorrectiveAction.alert_id)
                            .where(CorrectiveAction.simulation_id == sid, CorrectiveAction.applied == False, CorrectiveAction.automatic == False,  # noqa: E712
                                   Alert.status == "open").order_by(CorrectiveAction.id.desc())).all() if sid else []:
            ca, al = c
            if ca.action in seen or ca.action not in FIX_LABEL or al.id in handled or not is_emergency(al.code, al.severity):
                continue
            seen.add(ca.action)
            out.append({"id": ca.id, "action": ca.action, "label": FIX_LABEL[ca.action], "where": where, "alert": al.title, "severity": al.severity,
                        "message": al.message})
    return out


def approve_fix(db: Session, lot: Lot, cid: int) -> dict:
    from app.db.models import CorrectiveAction
    from app.engine.registry import get_produce as gp
    c = db.get(CorrectiveAction, cid)
    if c is None or c.simulation_id is None:
        raise FlowError(404, "not_found", "Fix not found")
    sh = db.scalars(select(Shipment).where(Shipment.simulation_id == c.simulation_id)).first()
    if not (c.simulation_id == lot.storage_sim_id or (sh is not None and sh.lot_id == lot.id)):
        raise FlowError(404, "not_found", "Fix not found")
    if c.applied:
        return {"applied": True, "message": "Already applied"}
    sim, rt = _runtime(db, c.simulation_id)
    if rt is None:
        raise FlowError(409, "no_state", "Simulation not available")
    eq, act = rt.s.equipment, c.action
    msg = None
    with _manager().lock:
        if act == "restore_cooling":
            eq.cooling_failed, eq.refrigeration_on, eq.cooling_efficiency = False, True, 1.0
            rt.s.faults = [f for f in rt.s.faults if f not in ("cooling_failure", "refrigeration_failure", "cooling_degradation")]
            msg = "Technician repaired the cooling unit; full capacity restored."
        elif act == "activate_backup_cooling":
            eq.backup_cooling = True
            msg = "Backup cooling switched on (about 50% of rated capacity)."
        elif act == "close_door":
            eq.door_open = False
            rt.s.faults = [f for f in rt.s.faults if f != "door_open"]
            msg = "Door closed."
        elif act in ("adjust_setpoint", "raise_setpoint") and eq.setpoint is not None:
            safe = gp(rt.s.produce.commodity).v("t_chill") + 0.5
            eq.setpoint = round(max(safe, eq.setpoint - 1.0), 2) if act == "adjust_setpoint" else round(eq.setpoint + 1.0, 2)
            msg = f"Setpoint now {eq.setpoint:.1f} °C."
        elif act == "ventilate":
            eq.fresh_air_ach = max(eq.fresh_air_ach or 0.0, 4.0)
            msg = "Fresh-air ventilation increased to 4 air changes/h."
        elif act == "open_vents":
            eq.vents_open = True
            rt.s.faults = [f for f in rt.s.faults if f != "vents_closed"]
            msg = "Vents opened."
        elif act == "increase_humidity" and eq.rh_setpoint is not None:
            eq.rh_setpoint = min(98.0, eq.rh_setpoint + 3.0)
            msg = f"Humidity setpoint raised to {eq.rh_setpoint:.0f}%."
        elif act == "reduce_humidity":
            eq.humidifier_fault = False
            eq.fresh_air_ach = max(eq.fresh_air_ach or 0.0, 2.0)
            rt.s.faults = [f for f in rt.s.faults if f != "humidity_deviation"]
            msg = "Humidifier fixed and ventilation increased."
    if act == "replan_route" and sh is not None:
        info = reroute(db, sh, "Delay ahead")
        msg = f"Alternative road taken: {info['new_remaining_km']:.1f} km to go."
    if act == "prioritise_batch":
        msg = "Open Predict → Decision to sell sooner."
    if msg is None:
        raise FlowError(422, "not_applicable", "This fix cannot be applied here")
    if sim.scenario and act in ("restore_cooling", "close_door", "open_vents", "reduce_humidity"):
        sim.scenario = None
    c.applied = True
    add_event(db, lot, "fix_applied", f"Fix approved: {FIX_LABEL.get(act, act)}", msg, sim_id=sim.id)
    db.commit()
    return {"applied": True, "message": msg}


def on_sim_alerts(db: Session, sim: Simulation, alerts: list):
    """Forward physics alerts of a lot's simulations to its station (phone + laptop), with the fixes the farmer can approve."""
    lot = db.scalars(select(Lot).where((Lot.storage_sim_id == sim.id))).first()
    if lot is None:
        sh = db.scalars(select(Shipment).where(Shipment.simulation_id == sim.id)).first()
        lot = db.get(Lot, sh.lot_id) if sh else None
    if lot is None or not lot.station_id:
        return
    for a in alerts:
        emergency = is_emergency(a.code, a.severity)
        fixes = _ensure_fixes(db, sim, a) if emergency else []
        ev = {"at": datetime.utcnow().isoformat(timespec="seconds"), "sim_time": None, "kind": a.code.lower(), "title": a.title,
              "message": a.message, "severity": a.severity if emergency else "INFO", "recommendation": a.recommendation, "fixes": fixes,
              "log": not emergency}
        if fixes:
            for s_ in db.scalars(select(NotificationSubscription).where(NotificationSubscription.active == True,  # noqa: E712
                                                                        NotificationSubscription.qr_session_id == lot.station_id)).all():
                push.send({"endpoint": s_.endpoint, "keys": {"p256dh": s_.p256dh, "auth": s_.auth}},
                          {"title": f"ZERO ROT · {a.title}", "body": f"{a.message} Tap to approve a fix.", "url": "/", "tag": f"fix-{a.id}"})
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


# ---------------- produce that was stored before it was entered ----------------
KEPT = {"open": "in the open (outdoor air)", "shade": "in a shaded shed (outdoor air, daily swings damped)", "cold": "in cold storage (recommended conditions)"}


def preage(commodity: str, maturity: str | None, quality: float, days: float, kept: str, lat: float, lng: float) -> dict:
    """Replay the time since harvest through the decay model with the real past weather of the location (or the
    recommended conditions for 'cold'), so a lot registered late starts with its present quality, weight loss and rot."""
    from bisect import bisect_left
    from app.simulation.deterioration_model import step_produce
    pp = get_produce(commodity)
    st = ProduceState(commodity, maturity, 1000.0, float(quality))
    hours = int(round(days * 24))
    source = "recommended storage conditions"
    if kept == "cold":
        series = [(pp.v("t_ref"), (pp.v("rh_low") + pp.v("rh_high")) / 2)] * hours
    else:
        try:
            h = weather.history(lat, lng, math.ceil(days))
        except weather.Unavailable as e:
            raise FlowError(503, "weather_unavailable", f"Cannot reconstruct the storage history: {e}")
        import time as _t
        now = _t.time()
        ts, tt, rr = h["times"], h["t"], h["rh"]
        series = []
        for i in range(hours):
            want = now - (hours - i) * 3600
            j = min(len(ts) - 1, max(0, bisect_left(ts, want)))
            series.append((tt[j], rr[j]))
        if kept == "shade":   # a shed lags and damps the outdoor swing: blend with the 24 h running mean
            out, win = [], []
            for t_, r_ in series:
                win = (win + [t_])[-24:]
                out.append((0.6 * t_ + 0.4 * sum(win) / len(win), r_))
            series = out
        source = h["source"]
    for t_, r_ in series:
        step_produce(st, t_, r_, 0.2095, 0.00042, 3600.0)
    temps = [x[0] for x in series] or [pp.v("t_ref")]
    return {"days": days, "kept": kept, "kept_label": KEPT[kept], "quality_at_harvest": quality, "quality_now": round(st.q, 2),
            "w": st.w, "r": st.r, "e": st.e, "loss": {k: round(v, 2) for k, v in st.loss.items()},
            "mean_temp_c": round(sum(temps) / len(temps), 1), "max_temp_c": round(max(temps), 1), "weather_source": source}


# ---------------- lots ----------------
def create_lot(db: Session, *, commodity: str, quantity_kg: float, quality: float, maturity: str | None, mode: str,
               lat: float, lng: float, location_name: str, station_id: int | None, user_id: int | None, speed: float = 60.0,
               manual_ambient: dict | None = None, plan_days: float = 5.0, days_since_harvest: float = 0.0, kept_as: str = "shade") -> Lot:
    try:
        p = get_produce(commodity)
    except ValueError as e:
        raise FlowError(422, "unsupported_commodity", str(e))
    if not 50 <= quantity_kg <= 50000:
        raise FlowError(422, "invalid_input", "Quantity must be between 50 kg and 50 tonnes")
    aged = None
    if days_since_harvest and days_since_harvest > 0:
        if kept_as not in KEPT:
            raise FlowError(422, "invalid_input", "kept_as must be open, shade or cold")
        aged = preage(commodity, maturity if commodity in ("tomato", "mango", "banana") else None, quality, days_since_harvest, kept_as, lat, lng)
    seq = (db.scalar(select(ProduceBatch.id).order_by(ProduceBatch.id.desc())) or 0) + 1
    code = f"ZR-{commodity[:3].upper()}-{seq:05d}"
    from datetime import timedelta as _td
    b = ProduceBatch(code=code, commodity_id=commodity, quantity_kg=quantity_kg, harvest_time=datetime.utcnow() - _td(days=days_since_harvest or 0),
                     initial_quality=aged["quality_now"] if aged else quality,
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
        rt = _manager().runtime(db, sim)
    except ValueError as ex:
        db.rollback()
        raise FlowError(422, "invalid_input", str(ex))
    if aged:
        rt.s.produce.w, rt.s.produce.r, rt.s.produce.e = aged["w"], aged["r"], aged["e"]
        rt.s.produce.loss = dict(aged["loss"])
        rt.meta["preaged"] = aged
        top = sorted(((k, v) for k, v in aged["loss"].items() if v > 0.05), key=lambda x: -x[1])[:3]
        add_event(db, lot, "preaged", f"Already {aged['days']:.0f} days since harvest",
                  f"Kept {aged['kept_label']} (mean {aged['mean_temp_c']} °C, max {aged['max_temp_c']} °C): quality {aged['quality_at_harvest']:.0f} → "
                  f"{aged['quality_now']:.0f}. Biggest causes: " + ", ".join(f"{k} −{v:.1f}" for k, v in top) + ".", push_it=False)
        if aged["quality_now"] < get_produce(commodity).v("q_min"):
            add_event(db, lot, "unsellable_on_entry", "Below sellable quality on entry",
                      "The model estimates this lot is already below the minimum sellable quality. Consider discarding or processing.", severity="WARNING")
    add_event(db, lot, "intake_started", "Intake started",
              f"{quantity_kg:.0f} kg of {p.display_name.lower()} entering the {mode} godown at {location_name} "
              f"(about {loading_s / 60:.0f} min of loading at {LOADING_KG_PER_H:.0f} kg/h).", push_it=False)
    if mode == "advanced":
        # crates carry field heat: the chamber air starts at the outside temperature and is pulled down to the target
        from app.simulation.engine import ambient
        from app.simulation.environment import humidity_ratio
        from app.simulation.state import AirState
        amb = ambient(cfg, rt.s)
        if amb["t"] is not None and amb["t"] > cfg["setpoint"] + 1:
            rt.s.air = AirState(t=float(amb["t"]), w=humidity_ratio(float(amb["t"]), min(100.0, float(amb["rh"])), amb["p"]), x_o2=rt.s.air.x_o2, x_co2=rt.s.air.x_co2)
            rt.meta["precool"] = {"from": round(amb["t"], 1), "target": cfg["setpoint"], "done": False}
            rt.last_readings = {}
            add_event(db, lot, "precooling", "Pre-cooling started",
                      f"Produce arrives at {amb['t']:.1f} °C; automatic control is pulling the chamber down to {cfg['setpoint']:.1f} °C "
                      f"({cfg['cooling_kw']:.0f} kW refrigeration).", push_it=False)
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


def scan(db: Session, lot: Lot) -> dict:
    """Simulated scanning line: every item passes a virtual camera that reads its quality from the lot's digital twin.
    Item quality ~ Normal(lot quality, ITEM_Q_SD); the model's rejected (decayed) fraction goes straight to rejects.
    Grades: A1 >= 85, A2 >= 70, A3 >= minimum saleable quality, otherwise rejected."""
    import random
    from statistics import NormalDist
    if lot.mode != "advanced":
        raise FlowError(409, "not_applicable", "Scanning and sorting is part of the advanced godown path; traditional lots go straight to the truck")
    if lot.stage != "storage":
        raise FlowError(409, "wrong_stage", f"Lot is in stage '{lot.stage}'; scanning needs the produce stored in the godown")
    b = db.get(ProduceBatch, lot.batch_id)
    sim, rt = _runtime(db, lot.storage_sim_id)
    if rt is None:
        raise FlowError(409, "no_state", "Storage state unavailable")
    p = rt.s.produce
    q_min = get_produce(b.commodity_id).v("q_min")
    nd = NormalDist(p.q, ITEM_Q_SD)
    good = (1 - p.r)
    cdf = lambda x: nd.cdf(x)
    shares = {"A1": good * (1 - cdf(SCAN_LIMITS[0][1])), "A2": good * (cdf(SCAN_LIMITS[0][1]) - cdf(SCAN_LIMITS[1][1])),
              "A3": good * (cdf(SCAN_LIMITS[1][1]) - cdf(q_min))}
    shares["rejected"] = max(0.0, 1 - sum(shares.values()))
    total = p.mass_kg * (1 - p.w)
    kg = {k: round(total * v, 1) for k, v in shares.items()}
    bags = {g: math.ceil(kg[g] / BAG_KG) if kg[g] >= 1 else 0 for g in GRADES}
    rnd = random.Random(f"scan-{lot.id}")
    items = []
    for _ in range(80):   # items shown on the line, drawn from the same distribution
        if rnd.random() < p.r:
            items.append({"grade": "rejected", "quality": 0.0})
            continue
        qi = rnd.gauss(p.q, ITEM_Q_SD)
        g = "A1" if qi >= SCAN_LIMITS[0][1] else "A2" if qi >= SCAN_LIMITS[1][1] else "A3" if qi >= q_min else "rejected"
        items.append({"grade": g, "quality": round(qi, 1)})
    counts = {k: sum(1 for i in items if i["grade"] == k) for k in (*GRADES, "rejected")} | {"uncertain": 0}
    if sim is not None and sim.status == "running":
        sim.status = "paused"     # stock leaves the chamber for the scanning house
    lot.grading = {"objects": len(items), "counts": counts, "items": items, "shares": {k: round(v, 4) for k, v in shares.items()},
                   "kg": kg, "bags": bags, "bag_kg": BAG_KG, "total_kg": round(total, 1), "processed_kg": 0.0, "bags_filled": {g: 0 for g in GRADES},
                   "rate_kg_h": GRADING_KG_PER_H, "quality_at_grading": round(p.q, 2), "method": "virtual_scan", "item_sd": ITEM_Q_SD,
                   "thresholds": {"A1": SCAN_LIMITS[0][1], "A2": SCAN_LIMITS[1][1], "A3": q_min},
                   "label": f"SIMULATED scan: item quality drawn from the lot's modelled quality ({p.q:.0f} ± {ITEM_Q_SD:.0f}); A1 ≥ 85, A2 ≥ 70, A3 ≥ {q_min:.0f}."}
    lot.stage = "grading"
    add_event(db, lot, "grading_started", "Scanning started",
              f"Lot quality {p.q:.0f}/100 → estimated {bags['A1']} A1, {bags['A2']} A2, {bags['A3']} A3 boxes of {BAG_KG:.0f} kg; "
              f"{kg['rejected']:.0f} kg rejected.", push_it=False)
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


def refresh_prices(db: Session, commodity: str, state: str = "Karnataka", max_age_h: float = 6.0) -> str | None:
    """Pull today's verified Agmarknet prices when none are stored or the latest retrieval is older than max_age_h."""
    from datetime import timedelta
    from app.db.models import MarketPrice
    from app.integrations import market
    last = db.scalar(select(MarketPrice.retrieved_at).where(MarketPrice.commodity_id == commodity).order_by(MarketPrice.retrieved_at.desc()))
    if last and datetime.utcnow() - last < timedelta(hours=max_age_h):
        return None
    errors = []
    for src in market.sources():
        try:
            recs = src.fetch(commodity, state)
        except market.Unavailable as e:
            errors.append(str(e))
            continue
        for r in recs:
            exists = db.scalar(select(MarketPrice.id).where(MarketPrice.commodity_id == commodity, MarketPrice.market == r["market"],
                                                           MarketPrice.variety == r["variety"], MarketPrice.observation_date == r["observation_date"],
                                                           MarketPrice.source == r["source"]))
            if exists:
                continue
            db.add(MarketPrice(commodity_id=commodity, market=r["market"], district=r["district"], state=r["state"], variety=r["variety"],
                               price_min=r["price_min"], price_max=r["price_max"], price_modal=r["price_modal"], unit=r["unit"],
                               observation_date=r["observation_date"], source=r["source"], origin="live", retrieved_at=datetime.utcnow()))
    db.commit()
    return "; ".join(errors) or None


def mandi_rates(db: Session, commodity: str, lat: float, lng: float) -> dict:
    from app.db.models import MarketPrice
    refresh_error = refresh_prices(db, commodity)
    rows = db.scalars(select(MarketPrice).where(MarketPrice.commodity_id == commodity).order_by(MarketPrice.observation_date.desc()).limit(2000)).all()
    if not rows:
        return {"status": "data_unavailable", "message": "No verified mandi prices available for this crop"
                + (f" ({refresh_error})" if refresh_error else " in Karnataka today") + ".", "markets": []}
    latest = {}
    for r in rows:
        latest.setdefault(r.market, r)
    markets = []
    for r in latest.values():
        import re as _re
        town = _re.sub(r"\(.*?\)|APMC|F&V", "", r.market).strip(" ,-")   # "Bangarpet APMC" -> "Bangarpet"
        town = town.split()[-1] if town and len(town.split()) > 1 and town.split()[-1] in ("Bengaluru", "Hubballi", "Mysuru") else town
        gt = geocode_town(town) if town else None
        g = gt or geocode_town(r.district or r.market)
        d = round(rg.haversine_m(lat, lng, g["lat"], g["lng"]) / 1000, 1) if g else None
        markets.append({"market": r.market, "district": r.district, "lat": g["lat"] if g else None, "lng": g["lng"] if g else None, "distance_km": d,
                        "distance_basis": "town" if gt else ("district" if g else None),
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
            used = {c["name"] for c in cps if c.get("name")}
            for c in cps:
                if not c.get("name"):
                    nm = places.reverse_names(c["lat"], c["lng"])
                    n = nm["en"] or f"Km {c['km']:.0f}"
                    dup = n in used
                    c["name"] = n if not dup else f"{n} (km {c['km']:.0f})"
                    c["name_kn"] = (nm["kn"] + (f" (ಕಿಮೀ {c['km']:.0f})" if dup else "")) if nm["kn"] else None
                    used.add(c["name"])
            sh2 = db.get(Shipment, shipment_id)
            # merge names only (passed flags may have changed meanwhile)
            merged = [dict(c) for c in sh2.checkpoints]
            for m in merged:
                hit = next((c for c in cps if c["km"] == m["km"]), None)
                if hit and not m.get("name"):
                    m["name"], m["name_kn"] = hit["name"], hit.get("name_kn")
            sh2.checkpoints = merged
            db.commit()
    threading.Thread(target=work, daemon=True).start()


def scan_then_dispatch(db: Session, lot: Lot, dest_name: str, dest_lat: float, dest_lng: float, plan: dict | None = None) -> dict:
    """Advanced lots never leave unsorted: scanning starts now and each grade ships automatically when sorting finishes.
    Default plan: A1 and A2 to the chosen market, A3 to the nearest local market (low-budget outlet)."""
    b = db.get(ProduceBatch, lot.batch_id)
    chosen = {"name": dest_name, "lat": dest_lat, "lng": dest_lng}
    if not plan:
        towns = [t for t in market_towns(b.lat, b.lng) if t["name"] != dest_name]
        local = towns[0] if towns else None
        plan = {"A1": chosen, "A2": chosen, "A3": ({"name": local["name"], "lat": local["lat"], "lng": local["lng"]} if local else chosen)}
    g = scan(db, lot)
    g = dict(lot.grading)
    g["pending_dispatch"] = plan
    lot.grading = g
    add_event(db, lot, "scan_before_dispatch", "Sorting before dispatch",
              f"Advanced lots are scanned and boxed first. Then A1 → {plan['A1']['name']}, A2 → {plan['A2']['name']}, A3 → {plan['A3']['name']}.", push_it=False)
    db.commit()
    return g


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
              f"{qty:.0f} kg ({'all produce' if grade == 'ALL' else grade + ' boxes'}) left for {dest_name} by {truck.name[0].lower() + truck.name[1:]}: "
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


# ---------------- playable sample situations ----------------
H = 3600
SCRIPTS = {
    "monsoon_tomato": {
        "title": "Monsoon tomato · advanced cold chain",
        "summary": "2 t tomato from Kolar into the advanced godown: pre-cooling, compressor failure with backup cooling, door left open, "
                   "scanning into A1/A2/A3, quoted-price decision, three trucks to three markets, reefer failure and a road block on the highway.",
        "lot": {"commodity": "tomato", "quantity_kg": 2000, "quality": 92, "maturity": "turning", "mode": "advanced", "plan_days": 5, "speed": 300},
        "steps": [
            {"when": "stored", "after": 1 * H, "do": "godown_scenario", "args": {"scenario": "cooling_failure"}, "say": "Compressor trips in the cold godown. Watch backup cooling switch on automatically."},
            {"when": "stored", "after": 3 * H, "do": "godown_scenario", "args": {"scenario": "normal"}, "say": "Technician repairs the compressor; normal cooling resumes."},
            {"when": "stored", "after": 4 * H, "do": "godown_control", "args": {"name": "door_open", "value": True}, "say": "A worker leaves the chamber door open."},
            {"when": "stored", "after": 4.8 * H, "do": "godown_control", "args": {"name": "door_open", "value": False}, "say": "Door closed after the alert."},
            {"when": "stored", "after": 5.5 * H, "do": "scan", "say": "The lot moves to the scanning house: every item is scanned and sorted into A1, A2 and A3 boxes."},
            {"when": "graded", "after": 600, "do": "decide", "args": {"price": 22}, "say": "The farmer checks the decision with today's quoted price of Rs 22/kg."},
            {"when": "graded", "after": 900, "do": "dispatch", "args": {"grade": "A1", "town": "Bengaluru"}, "say": "A1 boxes go to the highest-price market: Bengaluru APMC."},
            {"when": "graded", "after": 1200, "do": "dispatch", "args": {"grade": "A2", "town": "Chik Ballapur"}, "say": "A2 boxes go to a standard market: Chikkaballapur APMC."},
            {"when": "graded", "after": 1500, "do": "dispatch", "args": {"grade": "A3", "town": "Chintamani"}, "say": "A3 boxes go to the nearby low-budget market: Chintamani APMC."},
            {"when": "in_transit:A1", "after": 600, "do": "truck_scenario", "args": {"grade": "A1", "scenario": "refrigeration_failure"}, "say": "The A1 reefer's compressor fails on the highway; cargo starts warming from the rear."},
            {"when": "in_transit:A1", "after": 1500, "do": "truck_scenario", "args": {"grade": "A1", "scenario": "normal"}, "say": "The driver restarts the refrigeration unit."},
            {"when": "in_transit:A1", "after": 1800, "do": "road_block", "args": {"grade": "A1"}, "say": "Road blocked ahead of the A1 truck. Finding an alternative road."},
        ],
    },
    "heatwave_banana": {
        "title": "Heat-wave banana · traditional storage",
        "summary": "3 t banana in a brick godown during a heat wave: rising temperature, vents closed and gas build-up, spoilage risk, "
                   "sell-now decision, open truck straight from the godown, traffic delay and a road block.",
        "lot": {"commodity": "banana", "quantity_kg": 3000, "quality": 90, "maturity": "mature_green", "mode": "traditional", "plan_days": 5, "speed": 300},
        "steps": [
            {"when": "stored", "after": 1 * H, "do": "godown_scenario", "args": {"scenario": "heat_wave"}, "say": "Heat wave: outside air is 8 degC hotter than forecast. The brick godown warms through the walls."},
            {"when": "stored", "after": 3 * H, "do": "godown_scenario", "args": {"scenario": "vents_closed"}, "say": "Vents are closed to keep dust out; CO2 from respiring bananas builds up."},
            {"when": "stored", "after": 5 * H, "do": "godown_scenario", "args": {"scenario": "normal"}, "say": "Vents reopened and the heat wave eases."},
            {"when": "stored", "after": 6 * H, "do": "decide", "args": {"price": 30}, "say": "The farmer checks the decision with today's quoted price of Rs 30/kg."},
            {"when": "stored", "after": 6.3 * H, "do": "dispatch", "args": {"grade": "ALL", "town": "Bengaluru"}, "say": "Traditional storage has no scanning: the lot goes straight onto an open truck to Bengaluru APMC."},
            {"when": "in_transit:ALL", "after": 1200, "do": "truck_scenario", "args": {"grade": "ALL", "scenario": "extended_delay"}, "say": "The truck is stuck in traffic for 4 hours."},
            {"when": "in_transit:ALL", "after": 4.5 * H, "do": "road_block", "args": {"grade": "ALL"}, "say": "Road blocked ahead. Finding an alternative road."},
        ],
    },
}


def start_script(db: Session, name: str, station_id: int | None, user_id: int | None) -> Lot:
    sc = SCRIPTS.get(name)
    if sc is None:
        raise FlowError(404, "not_found", "Unknown sample situation")
    g = geocode_town("Kolar")
    if g is None:
        raise FlowError(503, "geocoding_unavailable", "Could not locate Kolar (geocoding unavailable)")
    lot = create_lot(db, station_id=station_id, user_id=user_id, lat=g["lat"], lng=g["lng"], location_name=f"{g['name']}, Karnataka", **sc["lot"])
    lot.script = {"name": name, "idx": 0, "clock": 0.0, "since": {}, "done": False}
    add_event(db, lot, "script", f"Sample situation: {sc['title']}", sc["summary"], push_it=False)
    db.commit()
    return lot


def _ship_by_grade(db: Session, lot: Lot, grade: str) -> Shipment | None:
    return db.scalars(select(Shipment).where(Shipment.lot_id == lot.id, Shipment.grade == grade).order_by(Shipment.id.desc())).first()


def _script_condition(db: Session, lot: Lot, when: str) -> bool:
    if when == "stored":
        return lot.stage != "intake"
    if when == "graded":
        return lot.stage in ("graded", "dispatched", "arrived", "delivered") and bool(lot.grading)
    if when.startswith("in_transit:"):
        return _ship_by_grade(db, lot, when.split(":", 1)[1]) is not None
    return True


def _run_script(db: Session, lot: Lot, dt: float):
    st = dict(lot.script)
    sc = SCRIPTS[st["name"]]
    st["clock"] += dt
    since = dict(st.get("since") or {})
    for w in {x["when"] for x in sc["steps"]}:   # step delays count from when their condition FIRST became true
        if w not in since and _script_condition(db, lot, w):
            since[w] = st["clock"]
    st["since"] = since
    lot.script = st
    while st["idx"] < len(sc["steps"]):
        step = sc["steps"][st["idx"]]
        if step["when"] not in since or st["clock"] - since[step["when"]] < step["after"]:
            break
        st["idx"] += 1
        lot.script = dict(st)
        add_event(db, lot, "script", f"Step {st['idx']}/{len(sc['steps'])}", step["say"], push_it=False)
        try:
            _script_action(db, lot, step)
        except FlowError as e:
            add_event(db, lot, "script", "Step skipped", e.message, severity="WARNING", push_it=False)
        except Exception as e:   # keep the situation running
            log.exception("script step failed")
            add_event(db, lot, "script", "Step skipped", f"{type(e).__name__}: {e}", severity="WARNING", push_it=False)
        st = dict(lot.script)
    if st["idx"] >= len(sc["steps"]) and not st["done"]:
        st["done"] = True
        add_event(db, lot, "script", "Sample situation: all events played", "The remaining trucks continue to their markets. Watch the phone for deliveries.", push_it=False)
    lot.script = dict(st)


def _script_action(db: Session, lot: Lot, step: dict):
    a, args = step["do"], step.get("args", {})
    if a in ("godown_scenario", "godown_control"):
        sim, rt = _runtime(db, lot.storage_sim_id)
        if rt is None or lot.stage not in ("intake", "storage"):
            raise FlowError(409, "wrong_stage", "The godown is no longer active")
        with _manager().lock:
            if a == "godown_scenario":
                rt.scenario(args["scenario"])
                sim.scenario = None if args["scenario"] == "normal" else args["scenario"]
            else:
                rt.control(args["name"], args["value"])
    elif a == "scan":
        scan(db, lot)
    elif a == "decide":
        decision(db, lot, args.get("price"), None)
    elif a == "dispatch":
        g = geocode_town(args["town"])
        if g is None:
            raise FlowError(503, "geocoding_unavailable", f"Could not locate {args['town']}")
        dispatch(db, lot, grade=args["grade"], dest_name=f"{g['name']} APMC", dest_lat=g["lat"], dest_lng=g["lng"], user_id=None)
    elif a in ("truck_scenario", "road_block"):
        sh = _ship_by_grade(db, lot, args["grade"])
        if sh is None or sh.status != "in_transit":
            raise FlowError(409, "not_in_transit", "That truck is no longer on the road")
        if a == "road_block":
            reroute(db, sh, "Road blocked ahead")
        else:
            sim, rt = _runtime(db, sh.simulation_id)
            with _manager().lock:
                rt.scenario(args["scenario"])
            sim.scenario = None if args["scenario"] == "normal" else args["scenario"]


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
    if lot.script and not lot.script.get("done"):
        _run_script(db, lot, dt)
    if lot.stage == "intake":
        sim, rt = _runtime(db, lot.storage_sim_id)
        if rt and (rt.loading() or {}).get("done"):
            lot.stage = "storage"
            add_event(db, lot, "stored", "Stored in godown", f"All {rt.s.produce.mass_kg:.0f} kg loaded; door closed. "
                      + ("Automatic climate control is active." if lot.mode == "advanced" else "Monitoring with live weather."))
    if lot.mode == "advanced" and lot.stage in ("intake", "storage"):
        sim, rt = _runtime(db, lot.storage_sim_id)
        pc = rt.meta.get("precool") if rt else None
        if pc and pc.get("done") and not pc.get("notified"):
            pc["notified"] = True
            add_event(db, lot, "target_reached", "Target temperature reached",
                      f"Chamber at {rt.s.air.t:.1f} °C (target {pc['target']:.1f} °C) after {rt.s.t_seconds / 3600:.1f} h of pre-cooling from {pc['from']:.1f} °C.")
    if lot.stage == "grading":
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
            plan = g.get("pending_dispatch")
            add_event(db, lot, "bagged", "Sorting complete", f"{g['bags']['A1']} A1, {g['bags']['A2']} A2 and {g['bags']['A3']} A3 boxes ready "
                      f"({g['kg']['rejected']:.0f} kg rejected). " + ("Trucks are leaving now." if plan else "Open Predict to choose where to sell each grade."))
            if plan:
                g2 = dict(lot.grading)
                g2.pop("pending_dispatch", None)
                lot.grading = g2
                for grade in GRADES:
                    if g["kg"].get(grade, 0) > 0 and grade in plan:
                        d = plan[grade]
                        try:
                            dispatch(db, lot, grade=grade, dest_name=d["name"], dest_lat=d["lat"], dest_lng=d["lng"], user_id=None)
                        except FlowError as e:
                            add_event(db, lot, "dispatch_failed", f"{grade} not dispatched", e.message, severity="WARNING")
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


# ---------------- the farmer's choice: store or discard (sell = dispatch) ----------------
SALVAGE = ["Processing unit (pulp, juice, sauce or dried product) for produce that is soft but safe",
           "Animal feed for unspoiled but unsaleable produce", "Compost or biogas for rotten produce"]


def store_choice(db: Session, lot: Lot, days: float) -> dict:
    if lot.stage not in ("storage", "graded"):
        raise FlowError(409, "wrong_stage", "Only produce in the godown can be kept in storage")
    sim, rt = _runtime(db, lot.storage_sim_id)
    if rt is not None and days:
        rt.cfg["plan_days"] = rt.s.t_seconds / 86400.0 + float(days)
        sim.config = {**sim.config, "plan_days": rt.cfg["plan_days"]}
    add_event(db, lot, "choice_store", "Decision: keep in storage", f"Kept in the godown for about {days:.0f} more days; the Decision will be re-checked.")
    db.commit()
    return {"choice": "store", "days": days}


def discard_choice(db: Session, lot: Lot, reason: str | None) -> dict:
    if lot.stage not in ("intake", "storage", "graded"):
        raise FlowError(409, "wrong_stage", "Only produce still in the godown can be discarded")
    b = db.get(ProduceBatch, lot.batch_id)
    sim, rt = _runtime(db, lot.storage_sim_id)
    lost = saleable_kg(rt) if rt else b.quantity_kg
    if sim is not None and sim.status != "completed":
        sim.status = "completed"
        if rt is not None:
            sim.config = {**sim.config, "summary": rt.summary()}
    lot.stage = "discarded"
    b.status = "discarded"
    add_event(db, lot, "choice_discard", "Decision: discard", f"{lost:.0f} kg removed from storage{(': ' + reason) if reason else ''}. "
              "Salvage options: " + "; ".join(SALVAGE) + ".")
    db.commit()
    return {"choice": "discard", "kg": round(lost, 1), "salvage": SALVAGE}


def history_entry(db: Session, lot: Lot) -> dict:
    b = db.get(ProduceBatch, lot.batch_id)
    ships = db.scalars(select(Shipment).where(Shipment.lot_id == lot.id).order_by(Shipment.id)).all()
    out = []
    for sh in ships:
        sim = db.get(Simulation, sh.simulation_id) if sh.simulation_id else None
        summ = (sim.config or {}).get("summary") if sim else None
        out.append({"grade": sh.grade, "kg": sh.quantity_kg, "to": sh.destination_name, "status": sh.status,
                    "delivered_at": sh.delivered_at.isoformat(timespec="minutes") if sh.delivered_at else None,
                    "final_quality": summ.get("final_quality") if summ else None, "reroutes": len(sh.reroutes or [])})
    return {"id": lot.id, "code": b.code, "commodity": b.commodity_id, "quantity_kg": b.quantity_kg, "mode": lot.mode, "stage": lot.stage,
            "created_at": lot.created_at.isoformat(timespec="minutes"), "location": b.location_name, "shipments": out,
            "decision": lot.decision, "events": (lot.events or [])[-12:]}


def reset_station(db: Session, station_id: int) -> int:
    """Demo reset: remove every lot of this station with its simulations (readings, alerts, snapshots cascade)."""
    from sqlalchemy import delete
    lots = db.scalars(select(Lot).where(Lot.station_id == station_id)).all()
    sim_ids, batch_ids = [], []
    for lot in lots:
        sim_ids += [lot.storage_sim_id] + [sh.simulation_id for sh in db.scalars(select(Shipment).where(Shipment.lot_id == lot.id)).all()]
        batch_ids.append(lot.batch_id)
    sim_ids = [x for x in sim_ids if x]
    with _manager().lock:
        for sid in sim_ids:
            _manager().drop(sid)
        db.execute(delete(Shipment).where(Shipment.lot_id.in_([l.id for l in lots])))
        db.execute(delete(Lot).where(Lot.station_id == station_id))
        from app.db.models import CorrectiveAction, Prediction, SimulationState, VirtualSensorReading
        for model in (VirtualSensorReading, SimulationState, Prediction, CorrectiveAction, Alert):
            db.execute(delete(model).where(model.simulation_id.in_(sim_ids)))
        db.execute(delete(Simulation).where(Simulation.id.in_(sim_ids)))
        db.execute(delete(Alert).where(Alert.batch_id.in_(batch_ids)))
        db.execute(delete(ProduceBatch).where(ProduceBatch.id.in_(batch_ids)))
        db.commit()
    return len(lots)


# ---------------- payloads ----------------
def lot_payload(db: Session, lot: Lot, full: bool = False) -> dict:
    b = db.get(ProduceBatch, lot.batch_id)
    out = {"id": lot.id, "code": b.code, "commodity": b.commodity_id, "quantity_kg": b.quantity_kg, "initial_quality": b.initial_quality,
           "maturity": b.maturity, "location": {"name": b.location_name, "lat": b.lat, "lng": b.lng}, "mode": lot.mode, "stage": lot.stage,
           "speed": lot.speed, "paused": lot.paused, "grading": lot.grading, "decision": lot.decision, "events": (lot.events or [])[-30:],
           "created_at": lot.created_at.isoformat(timespec="seconds"), "storage": None, "shipments": [], "pending_fixes": pending_fixes(db, lot),
           "script": ({"name": lot.script["name"], "title": SCRIPTS[lot.script["name"]]["title"], "step": lot.script["idx"],
                       "steps": len(SCRIPTS[lot.script["name"]]["steps"]), "done": lot.script["done"]} if lot.script else None)}
    sim, rt = _runtime(db, lot.storage_sim_id)
    if rt is not None:
        lv = rt.live()
        out["storage"] = {"sim_id": sim.id, "status": sim.status, "kind": sim.kind, "sim_time": lv["sim_time"], "t_seconds": lv["t_seconds"],
                          "readings": lv["readings"], "ambient": lv["ambient"], "produce": lv["produce"], "equipment": lv["equipment"],
                          "prediction": lv["prediction"], "flows": lv["flows"], "loading": lv["loading"], "faults": lv["faults"],
                          "active_alerts": lv["active_alerts"], "weather_extras": lv["weather_extras"], "saleable_kg": round(saleable_kg(rt), 1),
                          "sensors": lv["sensors"] if full else None, "setpoint": rt.cfg.get("setpoint"), "dimensions_m": rt.cfg.get("dimensions_m"),
                          "structure": rt.cfg.get("structure"), "loss": {k: round(v, 2) for k, v in (rt.s.produce.loss or {}).items()},
                          "preaged": rt.meta.get("preaged") and {k: rt.meta["preaged"][k] for k in ("days", "kept_label", "quality_at_harvest", "quality_now")},
                          "history": rt.meta.get("history", [])[-120::4]}
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
    active = db.scalars(select(Lot).where(Lot.station_id == station_id, Lot.stage.notin_(("delivered", "discarded"))).order_by(Lot.id.desc()).limit(6)).all()
    done = db.scalars(select(Lot).where(Lot.station_id == station_id, Lot.stage.in_(("delivered", "discarded"))).order_by(Lot.id.desc()).limit(20)).all()
    return {"type": "station", "station_id": station_id, "at": datetime.utcnow().isoformat(timespec="seconds"), "lots": [lot_payload(db, l) for l in active],
            "history": [history_entry(db, l) for l in done]}


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
