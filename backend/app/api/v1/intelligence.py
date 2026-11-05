"""Alerts & corrective actions, market intelligence, profit, AI explanations, analytics, QR access, notifications, system status."""
from __future__ import annotations

import copy
from datetime import datetime

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import Principal, ai_limiter, audit, current_principal, current_user, err
from app.db.models import (Alert, AuditLog, CorrectiveAction, MarketEvent, MarketPrice, NotificationSubscription, PriceForecast, ProduceBatch,
                           ProfitScenario, QRAccessSession, Simulation, StorageFacility, StorageZone, Truck)
from app.db.session import get_db
from app.engine.registry import get_produce
from app.integrations import groq_ai, market, push, routing, weather
from app.ml import forecasting, vision
from app.services import analytics, profit, qr, reports
from app.simulation.manager import manager

router = APIRouter(tags=["intelligence"])


# ---------------- alerts ----------------
def alert_dict(a: Alert) -> dict:
    return {"id": a.id, "simulation_id": a.simulation_id, "batch_id": a.batch_id, "truck_id": a.truck_id, "zone_id": a.zone_id, "severity": a.severity,
            "code": a.code, "title": a.title, "message": a.message, "reading": a.reading, "expected": a.expected, "risk": a.risk,
            "recommendation": a.recommendation, "status": a.status, "sim_seconds": a.sim_seconds, "created_at": a.created_at.isoformat(timespec="seconds"),
            "acknowledged_at": a.acknowledged_at.isoformat(timespec="seconds") if a.acknowledged_at else None, "origin": "simulation"}


@router.get("/alerts")
def alerts(status: str | None = None, severity: str | None = None, limit: int = 200, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    q = select(Alert).order_by(Alert.id.desc()).limit(min(limit, 500))
    if status:
        q = q.where(Alert.status == status)
    if severity:
        q = q.where(Alert.severity == severity)
    rows = db.scalars(q).all()
    if p.kind == "qr":
        rows = [a for a in rows if (a.simulation_id and p.can_access("simulation", a.simulation_id)) or (a.batch_id and p.can_access("batch", a.batch_id))]
    return {"alerts": [alert_dict(a) for a in rows]}


@router.post("/alerts/{aid}/acknowledge")
def acknowledge(aid: int, request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    a = db.get(Alert, aid)
    if a is None or not (p.kind == "user" or (a.simulation_id and p.can_access("simulation", a.simulation_id)) or (a.batch_id and p.can_access("batch", a.batch_id))):
        err(404, "not_found", "Alert not found")
    if p.kind == "qr" and "acknowledge_alerts" not in (p.scope or {}).get("permissions", []):
        err(403, "forbidden", "Not permitted")
    if a.status == "open":
        a.status, a.acknowledged_at = "acknowledged", datetime.utcnow()
        a.acknowledged_by = p.user.id if p.user else None
    audit(db, p, "acknowledge_alert", "alert", aid, request=request)
    db.commit()
    return alert_dict(a)


@router.get("/corrective-actions")
def actions(simulation_id: int | None = None, p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    q = select(CorrectiveAction).order_by(CorrectiveAction.id.desc()).limit(300)
    if simulation_id:
        q = q.where(CorrectiveAction.simulation_id == simulation_id)
    return {"actions": [{"id": c.id, "alert_id": c.alert_id, "simulation_id": c.simulation_id, "action": c.action, "reason": c.reason, "parameters": c.parameters,
                         "automatic": c.automatic, "applied": c.applied, "created_at": c.created_at.isoformat(timespec="seconds")} for c in db.scalars(q).all()]}


APPLY = {"activate_backup_cooling": ("backup_cooling", True), "close_door": ("door_open", False), "restore_cooling": None,
         "ventilate": ("fresh_air_ach", 4.0)}


@router.post("/corrective-actions/{cid}/apply")
def apply_action(cid: int, request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    c = db.get(CorrectiveAction, cid)
    if c is None or c.simulation_id is None:
        err(404, "not_found", "Action not found")
    if p.kind == "qr" and not (p.can_access("simulation", c.simulation_id) and "control" in (p.scope or {}).get("permissions", [])):
        err(403, "forbidden", "This mobile link cannot apply controls")
    sim = db.get(Simulation, c.simulation_id)
    rt = manager.runtime(db, sim)
    with manager.lock:
        if c.action == "restore_cooling":
            rt.s.equipment.cooling_failed = False
            rt.s.equipment.refrigeration_on = True
        elif c.action == "adjust_setpoint" and rt.s.equipment.setpoint is not None:
            pp = get_produce(rt.s.produce.commodity)
            rt.s.equipment.setpoint = max(pp.v("t_chill") + 0.5, rt.s.equipment.setpoint - 1.0)
        elif c.action == "raise_setpoint" and rt.s.equipment.setpoint is not None:
            rt.s.equipment.setpoint += 1.0
        elif c.action in APPLY and APPLY[c.action]:
            rt.control(*APPLY[c.action])
        else:
            err(422, "manual_action", "This action must be carried out on site (it has no simulated control)")
    c.applied, c.actor_user_id = True, p.user.id if p.user else None
    audit(db, p, "apply_corrective_action", "corrective_action", cid, {"action": c.action}, request)
    db.commit()
    return {"ok": True, "action": c.action}


# ---------------- market ----------------
@router.get("/market/status")
def market_status(p: Principal = Depends(current_principal)):
    return {"sources": [{"name": s.name, "status": s.status()[0], "detail": s.status()[1]} for s in market.sources()],
            "forecast_min_points": forecasting.MIN_POINTS, "groq": groq_ai.available()}


@router.post("/market/refresh")
def market_refresh(commodity: str, state: str | None = "Karnataka", p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    added, errors = 0, []
    for src in market.sources():
        try:
            recs = src.fetch(commodity, state)
        except market.Unavailable as e:
            errors.append(f"{src.name}: {e}")
            continue
        for r in recs:
            exists = db.scalars(select(MarketPrice.id).where(MarketPrice.commodity_id == commodity, MarketPrice.market == r["market"],
                                                             MarketPrice.variety == r["variety"], MarketPrice.observation_date == r["observation_date"],
                                                             MarketPrice.source == r["source"])).first()
            if exists:
                continue
            db.add(MarketPrice(commodity_id=commodity, market=r["market"], district=r["district"], state=r["state"], variety=r["variety"],
                               price_min=r["price_min"], price_max=r["price_max"], price_modal=r["price_modal"], unit=r["unit"],
                               observation_date=r["observation_date"], source=r["source"], origin="live", retrieved_at=datetime.utcnow()))
            added += 1
    db.commit()
    if errors and not added:
        err(503, "market_unavailable", "Market data unavailable: " + "; ".join(errors))
    return {"added": added, "errors": errors}


@router.get("/market/prices")
def market_prices(commodity: str, market_name: str | None = None, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    q = select(MarketPrice).where(MarketPrice.commodity_id == commodity)
    if market_name:
        q = q.where(MarketPrice.market == market_name)
    rows = db.scalars(q.order_by(MarketPrice.observation_date.desc()).limit(3000)).all()
    if not rows:
        return {"status": "data_unavailable", "message": "No verified market prices stored for this commodity. Configure DATA_GOV_API_KEY and refresh.",
                "prices": [], "markets": []}
    latest = {}
    for r in rows:
        latest.setdefault(r.market, r)
    return {"status": "ok", "markets": sorted({r.market for r in rows}),
            "latest": [{"market": r.market, "district": r.district, "state": r.state, "variety": r.variety, "modal_per_kg": round(r.price_modal / 100, 2),
                        "min_per_kg": round((r.price_min or 0) / 100, 2), "max_per_kg": round((r.price_max or 0) / 100, 2), "unit": "Rs/kg",
                        "observation_date": r.observation_date.date().isoformat(), "source": r.source, "retrieved_at": r.retrieved_at.isoformat(timespec="minutes"),
                        "freshness_days": (datetime.utcnow() - r.observation_date).days, "origin": r.origin} for r in latest.values()],
            "history": [{"date": r.observation_date.date().isoformat(), "market": r.market, "modal_per_kg": round(r.price_modal / 100, 2)} for r in reversed(rows)]}


@router.post("/market/forecast")
def market_forecast(commodity: str, market_name: str, horizon: int = 14, p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(MarketPrice).where(MarketPrice.commodity_id == commodity, MarketPrice.market == market_name)).all()
    res = forecasting.forecast([(r.observation_date.date(), r.price_modal / 100) for r in rows], horizon=min(30, max(1, horizon)))
    if res["status"] == "ok":
        db.add(PriceForecast(commodity_id=commodity, market=market_name, model=res["model"], horizon_days=res["horizon_days"],
                             trained_points=res["trained_points"], metrics=res["metrics"], points=res["points"]))
        db.commit()
    return res


@router.get("/market/events")
def market_events(commodity: str, p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    try:
        arts = market.news(commodity)
    except market.Unavailable as e:
        stored = db.scalars(select(MarketEvent).where(MarketEvent.commodity_id == commodity).order_by(MarketEvent.id.desc()).limit(20)).all()
        return {"status": "unavailable", "message": str(e), "articles": [], "events": [{"title": x.title, "summary": x.summary, "kind": x.kind,
                                                                                         "url": x.source_url} for x in stored]}
    out = {"status": "ok", "articles": arts, "source": "GDELT DOC 2.0", "label": "News is context only, not evidence of price movement."}
    if groq_ai.available() and arts:
        try:
            ev = groq_ai.market_events(commodity, arts)
            out["ai"] = ev
            for e in ev["events"][:10]:
                db.add(MarketEvent(commodity_id=commodity, title=str(e.get("title", ""))[:300], summary=f"{e.get('kind')} / {e.get('direction')}",
                                   kind=str(e.get("kind", "other"))[:48], source_url=str(e.get("url", ""))[:500] or None, extracted_by=settings.groq_model))
            db.commit()
        except groq_ai.Unavailable as e:
            out["ai_error"] = str(e)
    return out


# ---------------- profit ----------------
class ProfitIn(BaseModel):
    batch_id: int
    price_per_kg: float | None = Field(None, gt=0, le=1000)
    market_name: str | None = None
    use_forecast: bool = True
    storage: str = Field("cold", pattern="^(cold|traditional)$")
    zone_id: int | None = None
    storage_temp_c: float | None = Field(None, ge=-2, le=45)
    storage_rh_pct: float | None = Field(None, ge=20, le=100)
    storage_cost_per_kg_day: float | None = Field(None, ge=0, le=50)
    transport_cost: float = Field(0, ge=0, le=1e7)
    commission_pct: float = Field(6, ge=0, le=30)
    other_costs: float = Field(0, ge=0, le=1e7)
    max_days: int = Field(14, ge=1, le=30)


@router.post("/profit/evaluate")
def profit_eval(body: ProfitIn, p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    b = db.get(ProduceBatch, body.batch_id)
    if b is None:
        err(404, "not_found", "Batch not found")
    pp = get_produce(b.commodity_id)
    price, origin, fc = body.price_per_kg, "manual", None
    if body.market_name:
        r = db.scalars(select(MarketPrice).where(MarketPrice.commodity_id == b.commodity_id, MarketPrice.market == body.market_name)
                       .order_by(MarketPrice.observation_date.desc())).first()
        if r is None and price is None:
            err(409, "price_unavailable", "No verified price for that market; enter a price manually")
        if r is not None:
            price, origin = r.price_modal / 100, f"verified: {r.source}, {r.observation_date.date()}"
        if body.use_forecast:
            f = db.scalars(select(PriceForecast).where(PriceForecast.commodity_id == b.commodity_id, PriceForecast.market == body.market_name)
                           .order_by(PriceForecast.id.desc())).first()
            fc = f.points if f else None
    if price is None:
        err(422, "invalid_input", "A price is required (verified market price or manual entry)")
    z = db.get(StorageZone, body.zone_id) if body.zone_id else None
    temp = body.storage_temp_c if body.storage_temp_c is not None else (z.setpoint if z else (pp.v("t_ref") if body.storage == "cold" else None))
    if temp is None:
        err(422, "invalid_input", "Give the expected storage temperature for traditional storage")
    rh = body.storage_rh_pct if body.storage_rh_pct is not None else ((pp.v("rh_low") + pp.v("rh_high")) / 2 if body.storage == "cold" else 65.0)
    cost = body.storage_cost_per_kg_day if body.storage_cost_per_kg_day is not None else (z.cost_per_kg_day if z else 0.0)
    res = profit.evaluate(commodity=b.commodity_id, maturity=b.maturity, quantity_kg=b.quantity_kg, quality=b.initial_quality, price_now_per_kg=price,
                          price_origin=origin, forecast_points=fc, storage_temp=temp, storage_rh=rh, storage_cost_per_kg_day=cost,
                          transport_cost=body.transport_cost, commission_rate=body.commission_pct / 100, other_costs=body.other_costs,
                          max_days=body.max_days, seed_key=f"profit-{b.id}")
    row = ProfitScenario(batch_id=b.id, inputs=body.model_dump(), results=res, recommendation=res["recommendation"], created_by=p.user.id)
    db.add(row)
    db.commit()
    res["scenario_id"] = row.id
    return res


# ---------------- AI explanations ----------------
class ExplainIn(BaseModel):
    task: str = Field(..., pattern="^(shelf_life|simulation|alert|price_forecast|profit|cold_chain)$")
    simulation_id: int | None = None
    alert_id: int | None = None
    profit_scenario_id: int | None = None
    commodity: str | None = None
    market_name: str | None = None
    language: str = Field("en", pattern="^(en|kn)$")


@router.post("/ai/explain")
def explain(body: ExplainIn, request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    if not ai_limiter.check(f"ai:{request.client.host if request.client else '?'}"):
        err(429, "rate_limited", "Too many AI requests; wait a minute")
    payload: dict
    if body.task in ("simulation", "shelf_life", "cold_chain") and body.simulation_id:
        s = db.get(Simulation, body.simulation_id)
        if s is None or not (p.kind == "user" or p.can_access("simulation", s.id)):
            err(404, "not_found", "Simulation not found")
        live = manager.runtime(db, s).live()
        payload = {"simulation": {"kind": s.kind, "name": s.name, "status": s.status, "batch": s.config.get("batch")},
                   "readings_SIMULATED": live["readings"], "ambient": live["ambient"], "produce": live["produce"], "prediction": live["prediction"],
                   "faults": live["faults"], "equipment": {k: v for k, v in live["equipment"].items() if k != "power_kw"}, "active_alerts": live["active_alerts"],
                   "route": live.get("route")}
    elif body.task == "alert" and body.alert_id:
        a = db.get(Alert, body.alert_id)
        if a is None:
            err(404, "not_found", "Alert not found")
        payload = alert_dict(a)
    elif body.task == "profit" and body.profit_scenario_id:
        ps = db.get(ProfitScenario, body.profit_scenario_id)
        if ps is None:
            err(404, "not_found", "Scenario not found")
        payload = {"inputs": ps.inputs, "sell_now": ps.results["sell_now"], "best": ps.results["best"], "recommendation": ps.results["recommendation"],
                   "assumptions": ps.results["assumptions"]}
    elif body.task == "price_forecast" and body.commodity and body.market_name:
        f = db.scalars(select(PriceForecast).where(PriceForecast.commodity_id == body.commodity, PriceForecast.market == body.market_name)
                       .order_by(PriceForecast.id.desc())).first()
        if f is None:
            err(409, "no_forecast", "Train a forecast first")
        payload = {"commodity": body.commodity, "market": body.market_name, "model": f.model, "metrics": f.metrics, "points": f.points}
    else:
        err(422, "invalid_input", "Missing reference for this explanation task")
    try:
        return groq_ai.explain(body.task, payload, body.language)
    except groq_ai.Unavailable as e:
        err(503, "ai_unavailable", f"AI explanation unavailable: {e}. Numerical results above are unaffected.")


# ---------------- analytics ----------------
@router.get("/analytics/summary")
def summary(p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    batches = db.scalars(select(ProduceBatch)).all()
    active = [b for b in batches if b.status in ("registered", "inspected", "in_storage", "in_transit")]
    sims = db.scalars(select(Simulation)).all()
    running = [s for s in sims if s.status == "running"]
    qualities, shelf = [], []
    for s in sims:
        if s.status in ("running", "paused", "created") and s.id in manager.runtimes:
            rt = manager.runtimes[s.id]
            qualities.append(rt.s.produce.q)
            sl = (rt.s.last_prediction or {}).get("shelf_life_days")
            if sl is not None:
                shelf.append(sl)
    completed = [s for s in sims if s.status == "completed" and (s.config or {}).get("summary")]
    loss_kg = sum(s.config["summary"]["lost_kg"] for s in completed)
    init_kg = sum(s.config["summary"]["initial_kg"] for s in completed)
    return {"active_batches": len(active), "monitored_kg": round(sum(b.quantity_kg for b in active), 1),
            "mean_quality": round(sum(qualities) / len(qualities), 1) if qualities else None,
            "mean_shelf_life_days": round(sum(shelf) / len(shelf), 2) if shelf else None,
            "storage_facilities": db.scalar(select(func.count(StorageFacility.id))) or 0, "trucks": db.scalar(select(func.count(Truck.id))) or 0,
            "active_vehicles": sum(1 for s in running if s.kind == "cold_chain"), "running_simulations": len(running),
            "critical_alerts_open": db.scalar(select(func.count(Alert.id)).where(Alert.severity == "CRITICAL", Alert.status == "open")) or 0,
            "open_alerts": db.scalar(select(func.count(Alert.id)).where(Alert.status == "open")) or 0,
            "completed_simulations": len(completed), "completed_loss_pct": round(loss_kg / init_kg * 100, 2) if init_kg else None,
            "market_prices_stored": db.scalar(select(func.count(MarketPrice.id))) or 0,
            "simulations_by_kind": {k: sum(1 for s in sims if s.kind == k) for k in ("traditional_storage", "cold_storage", "cold_chain")}}


class CompareIn(BaseModel):
    mode: str = Field(..., pattern="^(storage|cold_chain)$")
    simulation_id: int
    other_zone_id: int | None = None
    fault_scenario: str = "refrigeration_failure"
    price_per_kg: float | None = Field(None, gt=0)


def _compare(db: Session, body: CompareIn) -> tuple[dict, dict]:
    s = db.get(Simulation, body.simulation_id)
    if s is None:
        err(404, "not_found", "Simulation not found")
    cfg = copy.deepcopy(s.config)
    for k in ("summary", "last_error"):
        cfg.pop(k, None)
    price = body.price_per_kg or cfg.get("price_per_kg")
    if body.mode == "storage":
        b = db.get(ProduceBatch, s.batch_id)
        if s.kind == "traditional_storage":
            trad = cfg
            z = db.get(StorageZone, body.other_zone_id) if body.other_zone_id else None
            if z is None:
                err(422, "invalid_input", "Choose a cold-storage zone to compare against")
            pp = get_produce(b.commodity_id)
            cold = copy.deepcopy(cfg)
            cold.update(volume_m3=z.volume_m3, ua_w_per_k=z.ua_w_per_k, ach=z.air_changes_per_hour, c_struct_j_per_k=3e6, cooling_kw=z.cooling_capacity_kw,
                        setpoint=max(pp.v("t_ref"), pp.v("t_chill") + 0.5), rh_setpoint=(pp.v("rh_low") + pp.v("rh_high")) / 2)
            cold_cost = z.cost_per_kg_day
        elif s.kind == "cold_storage":
            cold, cold_cost = cfg, cfg.get("storage_cost_per_kg_day", 0)
            if not (cfg.get("location") or {}).get("lat"):
                err(422, "invalid_input", "Location needed for comparison")
            from app.services.sim_config import REF_AREA, STRUCTURES
            area = 2 * (8 + 6) * 3.5 + 48
            trad = copy.deepcopy(cfg)
            trad.update(volume_m3=168.0, ua_w_per_k=STRUCTURES["brick"][0] * area, ach=2.0, c_struct_j_per_k=STRUCTURES["brick"][1], cooling_kw=0.0)
            trad.pop("setpoint", None)
            trad.pop("rh_setpoint", None)
        else:
            err(422, "invalid_input", "Storage comparison needs a storage simulation")
        days = cfg["duration_days"]
        kg = cfg["batch"]["quantity_kg"]
        res = analytics.compare(("traditional_storage", trad, None), ("cold_storage", cold, None), price,
                                {"baseline": {}, "improved": {"storage_cost": kg * cold_cost * days}, "energy_tariff": 8.0},
                                ("Traditional storage", "Intelligent cold storage"))
        ctx = {"Comparison": "Traditional vs intelligent storage", "Batch": cfg["batch"]["code"], "Duration (days)": days,
               "Price (Rs/kg)": price or "not given", "Energy tariff": "Rs 8/kWh (assumption)"}
    else:
        if s.kind != "cold_chain":
            err(422, "invalid_input", "Cold-chain comparison needs a cold-chain simulation")
        dist_km = cfg["route_distance_m"] / 1000
        tc = dist_km * cfg.get("transport_rate_per_km", 45.0)
        res = analytics.compare(("cold_chain", cfg, body.fault_scenario), ("cold_chain", cfg, None), price,
                                {"baseline": {"transport_cost": tc}, "improved": {"transport_cost": tc}, "energy_tariff": 8.0},
                                (f"Fault: {body.fault_scenario.replace('_', ' ')}", "Normal cold chain"))
        ctx = {"Comparison": "Fault-affected vs normal cold chain", "Route": f"{cfg['route']['origin']} -> {cfg['route']['dest']}",
               "Distance (km)": round(dist_km, 1), "Price (Rs/kg)": price or "not given"}
    if "error" in res:
        err(503, "comparison_failed", res["error"])
    return res, ctx


@router.post("/analytics/compare")
def compare(body: CompareIn, p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    res, ctx = _compare(db, body)
    return {**res, "context": ctx}


@router.post("/analytics/compare/export")
def compare_export(body: CompareIn, fmt: str = "csv", p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    res, ctx = _compare(db, body)
    if fmt == "pdf":
        return Response(reports.comparison_pdf(res, "Loss analysis", ctx), media_type="application/pdf",
                        headers={"Content-Disposition": f'attachment; filename="zerorot-comparison-{body.simulation_id}.pdf"'})
    return Response(reports.comparison_csv(res), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="zerorot-comparison-{body.simulation_id}.csv"'})


# ---------------- QR access ----------------
class QRIn(BaseModel):
    resource_type: str = Field(..., pattern="^(batch|simulation|zone|truck)$")
    resource_id: int
    ttl_minutes: int = Field(720, ge=5, le=60 * 24 * 14)
    allow_control: bool = False


@router.post("/qr/sessions", status_code=201)
def qr_create(body: QRIn, request: Request, p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    model = {"batch": ProduceBatch, "simulation": Simulation, "zone": StorageZone, "truck": Truck}[body.resource_type]
    if db.get(model, body.resource_id) is None:
        err(404, "not_found", "Resource not found")
    perms = ["view", "acknowledge_alerts"] + (["control"] if body.allow_control else [])
    out = qr.create(db, body.resource_type, body.resource_id, body.ttl_minutes, perms, p.user.id)
    base = settings.public_base_url or str(request.base_url).rstrip("/")
    out["url"] = f"{base}/m/{out['token']}"
    audit(db, p, "create_qr_session", "qr_session", out["id"], {"resource": f"{body.resource_type}:{body.resource_id}", "perms": perms}, request)
    db.commit()
    return out


@router.get("/qr/sessions")
def qr_list(p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    return {"sessions": [{"id": q.id, "resource_type": q.resource_type, "resource_id": q.resource_id, "permissions": q.permissions,
                          "expires_at": q.expires_at.isoformat(timespec="minutes"), "revoked": q.revoked, "uses": q.uses,
                          "expired": q.expires_at < datetime.utcnow()} for q in db.scalars(select(QRAccessSession).order_by(QRAccessSession.id.desc())).all()]}


@router.post("/qr/sessions/{qid}/revoke")
def qr_revoke(qid: int, request: Request, p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    q = db.get(QRAccessSession, qid)
    if q is None:
        err(404, "not_found", "Session not found")
    q.revoked = True
    audit(db, p, "revoke_qr_session", "qr_session", qid, request=request)
    db.commit()
    return {"ok": True}


class QRVerifyIn(BaseModel):
    token: str = Field(..., min_length=20, max_length=128)
    pin: str = Field(..., pattern=r"^\d{6}$")


@router.post("/qr/verify")
def qr_verify(body: QRVerifyIn, request: Request, db: Session = Depends(get_db)):
    from app.core.deps import limiter
    if not limiter.check(f"qr:{request.client.host if request.client else '?'}", cost=5):
        err(429, "rate_limited", "Too many attempts; wait a minute")
    q, why = qr.verify(db, body.token, body.pin)
    if q is None:
        msgs = {"invalid_token": "This QR link is not valid", "revoked": "This QR link was revoked", "expired": "This QR link has expired",
                "locked": "Too many wrong PINs; ask for a new QR code", "wrong_pin": "Wrong PIN"}
        err(401 if why == "wrong_pin" else 403, why, msgs[why])
    audit(db, None, "qr_access", "qr_session", q.id, {"resource": f"{q.resource_type}:{q.resource_id}"}, request)
    db.commit()
    return {"access_token": qr.session_token(q), "scope": {"type": q.resource_type, "id": q.resource_id, "permissions": q.permissions},
            "expires_at": q.expires_at.isoformat(timespec="minutes")}


@router.get("/mobile/overview")
def mobile_overview(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    if p.kind != "qr":
        err(403, "forbidden", "Mobile overview is for QR sessions")
    sc = p.scope
    sims = []
    if sc["type"] == "simulation":
        s = db.get(Simulation, sc["id"])
        sims = [s] if s else []
    elif sc["type"] == "batch":
        sims = db.scalars(select(Simulation).where(Simulation.batch_id == sc["id"]).order_by(Simulation.id.desc())).all()
    elif sc["type"] == "zone":
        sims = db.scalars(select(Simulation).where(Simulation.zone_id == sc["id"]).order_by(Simulation.id.desc())).all()
    elif sc["type"] == "truck":
        sims = db.scalars(select(Simulation).where(Simulation.truck_id == sc["id"]).order_by(Simulation.id.desc())).all()
    out = []
    for s in sims[:5]:
        try:
            live = manager.runtime(db, s).live()
        except ValueError:
            live = None
        out.append({"id": s.id, "kind": s.kind, "name": s.name, "status": s.status, "live": live})
    ids = [s.id for s in sims]
    al = db.scalars(select(Alert).where(Alert.simulation_id.in_(ids)).order_by(Alert.id.desc()).limit(30)).all() if ids else []
    return {"scope": sc, "simulations": out, "alerts": [alert_dict(a) for a in al]}


# ---------------- notifications ----------------
@router.get("/notifications/vapid")
def vapid():
    return {"public_key": push.keys()["public"]}


class SubIn(BaseModel):
    endpoint: str = Field(..., max_length=1000)
    keys: dict


@router.post("/notifications/subscribe", status_code=201)
def subscribe(body: SubIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    if not body.endpoint.startswith("https://"):
        err(422, "invalid_input", "Push endpoint must be HTTPS")
    s = db.scalars(select(NotificationSubscription).where(NotificationSubscription.endpoint == body.endpoint)).first()
    if s is None:
        s = NotificationSubscription(endpoint=body.endpoint, p256dh=body.keys.get("p256dh", ""), auth=body.keys.get("auth", ""))
        db.add(s)
    s.user_id = p.user.id if p.user else None
    s.qr_session_id = p.qr_session_id
    s.active = True
    db.commit()
    return {"ok": True, "id": s.id}


@router.post("/notifications/test")
def test_push(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    q = select(NotificationSubscription).where(NotificationSubscription.active == True)  # noqa: E712
    q = q.where(NotificationSubscription.qr_session_id == p.qr_session_id) if p.kind == "qr" else q.where(NotificationSubscription.user_id == p.user.id)
    subs = db.scalars(q).all()
    if not subs:
        err(409, "no_subscription", "This device has not enabled notifications")
    results = [push.send({"endpoint": s.endpoint, "keys": {"p256dh": s.p256dh, "auth": s.auth}},
                         {"title": "ZERO ROT", "body": "Test notification: alerts will appear like this.", "url": "/"}) for s in subs]
    return {"results": [{"ok": ok, "detail": d} for ok, d in results]}


# ---------------- system ----------------
@router.get("/integrations")
def integrations(p: Principal = Depends(current_principal)):
    out = []
    try:
        weather.geocode("Bengaluru", 1)
        out.append({"name": "Weather (Open-Meteo)", "status": "live", "detail": "Forecast and geocoding reachable"})
    except weather.Unavailable as e:
        out.append({"name": "Weather (Open-Meteo)", "status": "unavailable", "detail": str(e)})
    try:
        routing.route((12.97, 77.59), (12.52, 76.90))
        out.append({"name": "Routing (OSRM)", "status": "live", "detail": settings.osrm_url})
    except routing.Unavailable as e:
        out.append({"name": "Routing (OSRM)", "status": "unavailable", "detail": str(e)})
    for s in market.sources():
        st, d = s.status()
        out.append({"name": f"Market prices ({s.name})", "status": "configured" if st == "configured" else "unavailable", "detail": d})
    out.append({"name": "Groq AI", "status": "configured" if groq_ai.available() else "unavailable",
                "detail": f"model {settings.groq_model}" if groq_ai.available() else "GROQ_API_KEY not configured"})
    out.append({"name": "Computer vision", "status": "available", "detail": vision.model_status().get("message") or "ONNX model loaded"})
    out.append({"name": "Web push", "status": "configured", "detail": "VAPID keys ready; delivery needs HTTPS and browser permission"})
    out.append({"name": "Database", "status": "connected", "detail": settings.database_url.split(":")[0]})
    return {"integrations": out}


@router.get("/audit")
def audit_log(p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    if p.role != "admin":
        err(403, "forbidden", "Admins only")
    return {"entries": [{"id": a.id, "actor": a.actor_label, "action": a.action, "entity": a.entity, "entity_id": a.entity_id, "details": a.details,
                         "ip": a.ip, "created_at": a.created_at.isoformat(timespec="seconds")} for a in db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(300)).all()]}
