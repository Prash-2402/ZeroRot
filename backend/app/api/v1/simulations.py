"""Simulations: create from records + live data, control the authoritative state, read history."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import Principal, audit, current_principal, current_user, err
from app.db.models import Alert, Prediction, ProduceBatch, Simulation, StorageAllocation, StorageZone, TransportationRoute, Truck, VirtualSensorReading
from app.db.session import get_db
from app.services import sim_config
from app.simulation.manager import manager
from app.simulation.scenario_manager import CONTROLS, SCENARIOS, TOGGLES

router = APIRouter(prefix="/simulations", tags=["simulations"])


class ManualAmbient(BaseModel):
    t: float = Field(..., ge=-20, le=55)
    rh: float = Field(..., ge=1, le=100)


class SimIn(BaseModel):
    kind: str = Field(..., pattern="^(traditional_storage|cold_storage|cold_chain)$")
    name: str | None = Field(None, max_length=160)
    batch_id: int
    duration_days: float | None = Field(None, gt=0, le=14)
    lat: float | None = Field(None, ge=-90, le=90)
    lng: float | None = Field(None, ge=-180, le=180)
    location_name: str | None = None
    structure: str | None = Field(None, pattern="^(brick|mud|tin)$")
    length_m: float | None = Field(None, gt=1, le=60)
    width_m: float | None = Field(None, gt=1, le=60)
    height_m: float | None = Field(None, gt=1.5, le=15)
    ach: float | None = Field(None, ge=0, le=20)
    zone_id: int | None = None
    truck_id: int | None = None
    route_id: int | None = None
    target_temp_c: float | None = Field(None, ge=-2, le=25)
    rh_requirement: float | None = Field(None, ge=40, le=100)
    speed_kmh: float | None = Field(None, gt=5, le=100)
    initial_internal_temp: float | None = Field(None, ge=-5, le=50)
    auto_control: bool = False
    backup_cooling_available: bool | None = None
    price_per_kg: float | None = Field(None, gt=0, le=1000)
    manual_ambient: ManualAmbient | None = None
    speed: float = Field(600, ge=1, le=7200)


def sim_dict(s: Simulation, live: bool = False) -> dict:
    cfg = s.config or {}
    d = {"id": s.id, "kind": s.kind, "name": s.name, "batch_id": s.batch_id, "zone_id": s.zone_id, "truck_id": s.truck_id, "route_id": s.route_id,
         "status": s.status, "sim_seconds": s.sim_seconds, "speed": s.speed, "scenario": s.scenario, "created_at": s.created_at.isoformat(timespec="minutes"),
         "batch": cfg.get("batch"), "location": cfg.get("location"), "route": cfg.get("route"), "truck": cfg.get("truck"), "zone": cfg.get("zone"),
         "duration_days": cfg.get("duration_days"), "setpoint": cfg.get("setpoint"), "summary": cfg.get("summary"), "last_error": cfg.get("last_error"),
         "weather": {"source": (cfg.get("weather") or {}).get("source"), "retrieved_at": (cfg.get("weather") or {}).get("retrieved_at"),
                     "status": (cfg.get("weather") or {}).get("status")}, "manual_ambient": cfg.get("manual_ambient"),
         "route_geometry": cfg.get("route_geometry") if live else None, "auto_control": cfg.get("auto_control"), "price_per_kg": cfg.get("price_per_kg"),
         "dimensions_m": cfg.get("dimensions_m"), "structure": cfg.get("structure")}
    return d


def get_sim(db: Session, sid: int, p: Principal) -> Simulation:
    s = db.get(Simulation, sid)
    if s is None or not (p.kind == "user" or p.can_access("simulation", sid) or (s.batch_id and p.can_access("batch", s.batch_id))):
        err(404, "not_found", "Simulation not found")
    return s


@router.get("/scenarios")
def scenarios():
    return {"scenarios": SCENARIOS, "controls": {k: {"min": v[0], "max": v[1]} for k, v in CONTROLS.items()}, "toggles": list(TOGGLES)}


@router.get("")
def list_sims(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rows = db.scalars(select(Simulation).order_by(Simulation.id.desc())).all()
    if p.kind == "qr":
        rows = [s for s in rows if p.can_access("simulation", s.id) or (s.batch_id and p.can_access("batch", s.batch_id))]
    return {"simulations": [sim_dict(s) for s in rows]}


@router.post("", status_code=201)
def create(body: SimIn, request: Request, p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    b = db.get(ProduceBatch, body.batch_id)
    if b is None:
        err(404, "not_found", "Batch not found")
    req = body.model_dump(exclude_none=True)
    if body.manual_ambient:
        req["manual_ambient"] = body.manual_ambient.model_dump()
    try:
        if body.kind == "traditional_storage":
            cfg, e = sim_config.traditional(b, req)
            name = body.name or f"Traditional storage · {b.code}"
        elif body.kind == "cold_storage":
            alloc = db.scalars(select(StorageAllocation).where(StorageAllocation.batch_id == b.id, StorageAllocation.status == "active")
                               .order_by(StorageAllocation.id.desc())).first()
            zone_id = body.zone_id or (alloc.zone_id if alloc else None)
            z = db.get(StorageZone, zone_id) if zone_id else None
            if z is None:
                err(422, "invalid_input", "Allocate the batch to a cold-storage zone first (or give zone_id)")
            cfg, e = sim_config.cold_room(b, z, req, alloc.setpoint if alloc and alloc.zone_id == z.id else None,
                                          alloc.rh_setpoint if alloc and alloc.zone_id == z.id else None)
            name = body.name or f"Cold storage · {z.name} · {b.code}"
        else:
            t, r = db.get(Truck, body.truck_id or 0), db.get(TransportationRoute, body.route_id or 0)
            if t is None or r is None:
                err(422, "invalid_input", "Choose a truck and a route")
            if b.quantity_kg > t.capacity_kg:
                err(422, "invalid_input", f"Batch ({b.quantity_kg:.0f} kg) exceeds truck capacity ({t.capacity_kg:.0f} kg)")
            cfg, e = sim_config.cold_chain(b, t, r, req)
            name = body.name or f"Cold chain · {r.origin_name} → {r.dest_name} · {b.code}"
    except ValueError as ex:
        err(422, "invalid_input", str(ex))
    if e:
        err(503 if "unavailable" in e.lower() else 422, "simulation_input_unavailable", e)
    s = Simulation(kind=body.kind, name=name, batch_id=b.id, zone_id=cfg.get("zone", {}).get("id") if cfg.get("zone") else None,
                   truck_id=body.truck_id if body.kind == "cold_chain" else None, route_id=body.route_id if body.kind == "cold_chain" else None,
                   config=cfg, speed=body.speed, created_by=p.user.id)
    db.add(s)
    db.flush()
    try:
        manager.runtime(db, s)
    except ValueError as ex:
        db.rollback()
        err(422, "invalid_input", str(ex))
    if body.kind == "cold_chain":
        b.status = "in_transit"
    elif b.status == "registered":
        b.status = "in_storage"
    audit(db, p, "create_simulation", "simulation", s.id, {"kind": body.kind}, request)
    db.commit()
    return sim_dict(s, live=True)


@router.get("/{sid}")
def get_one(sid: int, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    s = get_sim(db, sid, p)
    d = sim_dict(s, live=True)
    try:
        d["live"] = manager.runtime(db, s).live()
    except ValueError as e:
        d["live"] = None
        d["last_error"] = str(e)
    return d


class SpeedIn(BaseModel):
    speed: float = Field(..., ge=1, le=7200)


class ScenarioIn(BaseModel):
    scenario: str


class ControlIn(BaseModel):
    name: str
    value: float | bool | None = None


def _control(db: Session, s: Simulation, p: Principal, request: Request, action: str, details: dict):
    audit(db, p, action, "simulation", s.id, details, request)
    db.commit()
    return get_one(s.id, p, db)


def _authorize_control(p: Principal):
    if p.kind == "qr" and "control" not in (p.scope or {}).get("permissions", []):
        err(403, "forbidden", "This mobile link has view-only access")


@router.post("/{sid}/start")
def start(sid: int, request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    _authorize_control(p)
    s = get_sim(db, sid, p)
    if s.status == "completed":
        err(409, "completed", "Simulation finished; reset it to run again")
    manager.runtime(db, s)
    s.status = "running"
    return _control(db, s, p, request, "start_simulation", {})


@router.post("/{sid}/pause")
def pause(sid: int, request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    _authorize_control(p)
    s = get_sim(db, sid, p)
    if s.status == "running":
        s.status = "paused"
        from app.db.models import SimulationState
        rt = manager.runtime(db, s)
        db.add(SimulationState(simulation_id=s.id, sim_seconds=rt.s.t_seconds, state=rt.snapshot()))
    return _control(db, s, p, request, "pause_simulation", {})


@router.post("/{sid}/resume")
def resume(sid: int, request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return start(sid, request, p, db)


@router.post("/{sid}/reset")
def reset(sid: int, request: Request, p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    s = get_sim(db, sid, p)
    manager.reset(db, s)
    manager.runtime(db, s)
    return _control(db, s, p, request, "reset_simulation", {})


@router.post("/{sid}/speed")
def speed(sid: int, body: SpeedIn, request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    _authorize_control(p)
    s = get_sim(db, sid, p)
    s.speed = body.speed
    return _control(db, s, p, request, "speed_simulation", {"speed": body.speed})


@router.post("/{sid}/scenario")
def scenario(sid: int, body: ScenarioIn, request: Request, p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    s = get_sim(db, sid, p)
    rt = manager.runtime(db, s)
    with manager.lock:
        try:
            desc = rt.scenario(body.scenario)
        except ValueError as e:
            err(422, "invalid_input", str(e))
    s.scenario = body.scenario if body.scenario != "normal" else None
    return _control(db, s, p, request, "inject_scenario", {"scenario": body.scenario, "description": desc})


@router.post("/{sid}/control")
def control(sid: int, body: ControlIn, request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    _authorize_control(p)
    s = get_sim(db, sid, p)
    rt = manager.runtime(db, s)
    with manager.lock:
        try:
            rt.control(body.name, body.value)
        except (ValueError, TypeError) as e:
            err(422, "invalid_input", str(e))
    return _control(db, s, p, request, "set_control", {"control": body.name, "value": body.value})


@router.get("/{sid}/history")
def history(sid: int, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    s = get_sim(db, sid, p)
    rt = manager.runtime(db, s)
    preds = db.scalars(select(Prediction).where(Prediction.simulation_id == sid).order_by(Prediction.sim_seconds)).all()
    return {"series": rt.meta.get("history", []), "predictions": [{"t": x.sim_seconds, "quality": x.quality, "shelf_life_days": x.shelf_life_days,
                                                                    "p10": x.shelf_life_p10, "p90": x.shelf_life_p90, "spoilage": x.spoilage_risk} for x in preds],
            "label": "SIMULATED virtual sensor readings"}


@router.get("/{sid}/readings")
def readings(sid: int, sensor_id: str | None = None, limit: int = 2000, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    get_sim(db, sid, p)
    q = select(VirtualSensorReading).where(VirtualSensorReading.simulation_id == sid)
    if sensor_id:
        q = q.where(VirtualSensorReading.sensor_id == sensor_id)
    rows = db.scalars(q.order_by(VirtualSensorReading.sim_seconds.desc()).limit(min(limit, 10000))).all()
    return {"readings": [{"sensor_id": r.sensor_id, "kind": r.kind, "value": r.value, "unit": r.unit, "t": r.sim_seconds, "origin": r.origin} for r in reversed(rows)]}


@router.get("/{sid}/alerts")
def sim_alerts(sid: int, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    get_sim(db, sid, p)
    from app.api.v1.intelligence import alert_dict
    return {"alerts": [alert_dict(a) for a in db.scalars(select(Alert).where(Alert.simulation_id == sid).order_by(Alert.id.desc())).all()]}
