"""Field-flow API: the phone app (paired by QR to a laptop 'station') drives lots through godown, grading, sale and delivery;
the laptop's 3D world shows the same state live over /ws/station/{id}."""
from __future__ import annotations

import socket
from datetime import datetime

from fastapi import APIRouter, Depends, File, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import ROOT, settings
from app.core.deps import Principal, ai_limiter, audit, current_principal, current_user, err
from app.db.models import Lot, QRAccessSession, Shipment, Simulation
from app.db.session import get_db
from app.integrations import groq_ai
from app.services import flow, qr
from app.simulation.manager import manager

router = APIRouter(prefix="/flow", tags=["field flow"])


# ---------------- access ----------------
def station_id_of(p: Principal) -> int | None:
    if p.kind == "qr":
        if (p.scope or {}).get("type") != "station":
            err(403, "forbidden", "This QR link is not a station pairing")
        return p.qr_session_id
    return None


def get_lot(db: Session, lot_id: int, p: Principal) -> Lot:
    lot = db.get(Lot, lot_id)
    if lot is None or (p.kind == "qr" and lot.station_id != station_id_of(p)):
        err(404, "not_found", "Lot not found")
    return lot


def _flow_call(fn, *a, **k):
    try:
        return fn(*a, **k)
    except flow.FlowError as e:
        err(e.status, e.code, e.message)


def lan_base_url(request: Request) -> str:
    if settings.public_base_url:
        return settings.public_base_url.rstrip("/")
    host = request.url.hostname or "localhost"
    port = request.url.port
    if host in ("localhost", "127.0.0.1", "::1"):
        try:   # UDP "connect" picks the outbound interface; no packet is sent
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("10.255.255.255", 1))
            host = s.getsockname()[0]
            s.close()
        except OSError:
            pass
    return f"{request.url.scheme}://{host}{':' + str(port) if port else ''}"


# ---------------- stations (laptop) ----------------
class StationIn(BaseModel):
    ttl_minutes: int = Field(720, ge=10, le=60 * 24 * 7)


@router.post("/stations", status_code=201)
def create_station(body: StationIn, request: Request, p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    out = qr.create(db, "station", 0, body.ttl_minutes, ["operate", "view", "acknowledge_alerts", "control"], p.user.id)
    out["url"] = f"{lan_base_url(request)}/p/{out['token']}"
    audit(db, p, "create_station", "qr_session", out["id"], {}, request)
    db.commit()
    return out


@router.get("/stations")
def list_stations(p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(QRAccessSession).where(QRAccessSession.resource_type == "station", QRAccessSession.revoked == False,  # noqa: E712
                                                    QRAccessSession.expires_at > datetime.utcnow()).order_by(QRAccessSession.id.desc())).all()
    return {"stations": [{"id": q.id, "expires_at": q.expires_at.isoformat(timespec="minutes"), "uses": q.uses} for q in rows]}


@router.get("/stations/{sid}/state")
def station_state(sid: int, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    if p.kind == "qr" and station_id_of(p) != sid:
        err(404, "not_found", "Station not found")
    return flow.station_payload(db, sid)


@router.get("/me")
def me(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    sid = station_id_of(p)
    if sid is None:
        err(403, "forbidden", "Phone sessions only")
    q = db.get(QRAccessSession, sid)
    return {"station_id": sid, "expires_at": q.expires_at.isoformat(timespec="minutes"), "groq": groq_ai.available()}


# ---------------- lots ----------------
class LotIn(BaseModel):
    commodity: str = Field(..., pattern="^[a-z_]{3,32}$")   # validated against the parameter registry
    quantity_kg: float = Field(..., gt=0, le=50000)
    quality: float = Field(90, ge=40, le=100)
    maturity: str | None = Field(None, pattern="^(mature_green|turning|ripe)$")
    mode: str = Field(..., pattern="^(traditional|advanced)$")
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    location_name: str = Field(..., min_length=2, max_length=160)
    station_id: int | None = None
    speed: float = Field(60, ge=1, le=7200)
    plan_days: float = Field(5, ge=0.5, le=14)   # farmer's intended holding time; spoilage risk is judged against it
    days_since_harvest: float = Field(0, ge=0, le=365)   # produce may already have been stored before entry
    kept_as: str = Field("shade", pattern="^(open|shade|cold)$")
    manual_ambient: dict | None = None    # {"t": degC, "rh": %} only when live weather is unavailable (labelled MANUAL)


@router.post("/lots", status_code=201)
def create_lot(body: LotIn, request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    sid = station_id_of(p) if p.kind == "qr" else body.station_id
    lot = _flow_call(flow.create_lot, db, commodity=body.commodity, quantity_kg=body.quantity_kg, quality=body.quality, maturity=body.maturity,
                     mode=body.mode, lat=body.lat, lng=body.lng, location_name=body.location_name, station_id=sid,
                     user_id=p.user.id if p.user else None, speed=body.speed, manual_ambient=body.manual_ambient, plan_days=body.plan_days,
                     days_since_harvest=body.days_since_harvest, kept_as=body.kept_as)
    audit(db, p, "create_lot", "lot", lot.id, {"commodity": body.commodity, "kg": body.quantity_kg, "mode": body.mode}, request)
    db.commit()
    return flow.lot_payload(db, lot, full=True)


@router.get("/lots")
def list_lots(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    q = select(Lot).order_by(Lot.id.desc()).limit(30)
    if p.kind == "qr":
        q = q.where(Lot.station_id == station_id_of(p))
    return {"lots": [flow.lot_payload(db, l) for l in db.scalars(q).all()]}


@router.get("/lots/{lot_id}")
def lot(lot_id: int, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return flow.lot_payload(db, get_lot(db, lot_id, p), full=True)


class ControlIn(BaseModel):
    name: str
    value: float | bool | None = None


@router.post("/lots/{lot_id}/control")
def lot_control(lot_id: int, body: ControlIn, request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    lot = get_lot(db, lot_id, p)
    sim = db.get(Simulation, lot.storage_sim_id)
    if sim is None or lot.stage not in ("intake", "storage"):
        err(409, "wrong_stage", "The godown is not active for this lot")
    rt = manager.runtime(db, sim)
    with manager.lock:
        try:
            rt.control(body.name, body.value)
        except (ValueError, TypeError) as e:
            err(422, "invalid_input", str(e))
    audit(db, p, "lot_control", "lot", lot.id, {"control": body.name, "value": body.value}, request)
    db.commit()
    return flow.lot_payload(db, lot, full=True)


class ScenarioIn(BaseModel):
    scenario: str


@router.post("/lots/{lot_id}/scenario")
def lot_scenario(lot_id: int, body: ScenarioIn, request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    lot = get_lot(db, lot_id, p)
    sim = db.get(Simulation, lot.storage_sim_id)
    if sim is None or lot.stage not in ("intake", "storage"):
        err(409, "wrong_stage", "The godown is not active for this lot")
    rt = manager.runtime(db, sim)
    with manager.lock:
        try:
            desc = rt.scenario(body.scenario)
        except ValueError as e:
            err(422, "invalid_input", str(e))
    sim.scenario = None if body.scenario == "normal" else body.scenario
    flow.add_event(db, lot, "scenario", f"Test scenario: {body.scenario.replace('_', ' ')}", desc, severity="INFO", push_it=False)
    audit(db, p, "lot_scenario", "lot", lot.id, {"scenario": body.scenario}, request)
    db.commit()
    return flow.lot_payload(db, lot, full=True)


class SpeedIn(BaseModel):
    speed: float = Field(..., ge=1, le=7200)


@router.post("/lots/{lot_id}/speed")
def lot_speed(lot_id: int, body: SpeedIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    lot = get_lot(db, lot_id, p)
    lot.speed = body.speed
    flow._sync_sims(db, lot)
    db.commit()
    return {"speed": lot.speed, "paused": lot.paused}


class PauseIn(BaseModel):
    paused: bool


@router.post("/lots/{lot_id}/pause")
def lot_pause(lot_id: int, body: PauseIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    lot = get_lot(db, lot_id, p)
    lot.paused = body.paused
    flow._sync_sims(db, lot)
    db.commit()
    return {"speed": lot.speed, "paused": lot.paused}


class StepIn(BaseModel):
    seconds: float = Field(..., gt=0, le=6 * 3600)


@router.post("/lots/{lot_id}/step")
def lot_step(lot_id: int, body: StepIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    """Advance this lot by an exact amount of simulated time (works while paused) for slow, step-by-step testing."""
    lot = get_lot(db, lot_id, p)
    sims = [lot.storage_sim_id] if lot.stage in ("intake", "storage") else []
    sims += [s.simulation_id for s in db.scalars(select(Shipment).where(Shipment.lot_id == lot.id, Shipment.status == "in_transit")).all()]
    with manager.lock:
        for sid in sims:
            sim = db.get(Simulation, sid)
            if sim is None or sim.status == "completed":
                continue
            rt = manager.runtime(db, sim)
            out = rt.advance(body.seconds)
            alerts = manager.persist(db, sim, rt, out)
            if alerts:
                manager.notify(db, sim, alerts)
        was = lot.paused
        lot.paused = False
        flow._tick_lot(db, lot, body.seconds / max(1.0, lot.speed))
        lot.paused = was
        flow._sync_sims(db, lot)
        db.commit()
    return flow.lot_payload(db, lot, full=True)


# ---------------- scan & sort ----------------
@router.post("/lots/{lot_id}/scan", status_code=201)
def lot_scan(lot_id: int, request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    lot = get_lot(db, lot_id, p)
    res = _flow_call(flow.scan, db, lot)
    audit(db, p, "lot_scan", "lot", lot.id, {}, request)
    db.commit()
    return res


@router.post("/lots/{lot_id}/grade", status_code=201)
async def lot_grade(lot_id: int, request: Request, files: list[UploadFile] = File(...), p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    lot = get_lot(db, lot_id, p)
    imgs = []
    for f in files[:20]:
        data = await f.read()
        if len(data) > 10_000_000:
            err(422, "invalid_image", f"{f.filename} is larger than 10 MB")
        imgs.append((f.filename or "photo.jpg", data))
    if not imgs:
        err(422, "invalid_image", "Add at least one photo")
    res = _flow_call(flow.grade, db, lot, imgs, p.user.id if p.user else None)
    audit(db, p, "lot_grade", "lot", lot.id, {"images": len(imgs)}, request)
    db.commit()
    return res


@router.post("/lots/{lot_id}/grade-sample", status_code=201)
def lot_grade_sample(lot_id: int, request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    """Grades the bundled reference photographs of this commodity (for testing without a camera). Labelled as sample images."""
    lot = get_lot(db, lot_id, p)
    from app.db.models import ProduceBatch
    c = db.get(ProduceBatch, lot.batch_id).commodity_id
    imgs = []
    for folder in (ROOT / "frontend" / "dist" / "produce", ROOT / "frontend" / "public" / "produce"):
        for stage in ("fresh", "aging", "spoiling"):
            f = folder / f"{c}_{stage}.jpg"
            if f.exists() and not any(n == f.name for n, _ in imgs):
                imgs.append((f.name, f.read_bytes()))
    if not imgs:
        err(404, "no_samples", f"No bundled sample photographs for {c}; use the camera")
    res = _flow_call(flow.grade, db, lot, imgs, p.user.id if p.user else None)
    res["sample_images"] = [n for n, _ in imgs]
    audit(db, p, "lot_grade_sample", "lot", lot.id, {}, request)
    db.commit()
    return res


# ---------------- predict ----------------
@router.get("/market-towns")
def towns(lat: float, lng: float, p: Principal = Depends(current_principal)):
    return {"towns": flow.market_towns(lat, lng), "source": "Open-Meteo geocoding (live)"}


@router.get("/lots/{lot_id}/rates")
def lot_rates(lot_id: int, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    lot = get_lot(db, lot_id, p)
    from app.db.models import ProduceBatch
    b = db.get(ProduceBatch, lot.batch_id)
    return flow.mandi_rates(db, b.commodity_id, b.lat, b.lng)


@router.get("/lots/{lot_id}/spoilage")
def lot_spoilage(lot_id: int, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return _flow_call(flow.spoilage, db, get_lot(db, lot_id, p))


@router.get("/lots/{lot_id}/decision")
def lot_decision(lot_id: int, price_per_kg: float | None = None, market: str | None = None, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    if price_per_kg is not None and not 0 < price_per_kg <= 1000:
        err(422, "invalid_input", "Price must be between 0 and 1000 Rs/kg")
    return _flow_call(flow.decision, db, get_lot(db, lot_id, p), price_per_kg, market)


# ---------------- dispatch & tracking ----------------
class DispatchIn(BaseModel):
    grade: str = Field("ALL", pattern="^(A1|A2|A3|ALL)$")
    destination_name: str = Field(..., min_length=2, max_length=160)
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    plan: dict | None = None   # advanced lots: {"A1": {name, lat, lng}, "A2": ..., "A3": ...}


@router.post("/lots/{lot_id}/dispatch", status_code=201)
def lot_dispatch(lot_id: int, body: DispatchIn, request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    lot = get_lot(db, lot_id, p)
    if lot.mode == "advanced" and lot.stage == "storage":
        _flow_call(flow.scan_then_dispatch, db, lot, body.destination_name, body.lat, body.lng, body.plan)
        audit(db, p, "lot_scan_dispatch", "lot", lot.id, {"to": body.destination_name}, request)
        db.commit()
        return flow.lot_payload(db, lot, full=True)
    sh = _flow_call(flow.dispatch, db, lot, grade=body.grade, dest_name=body.destination_name, dest_lat=body.lat, dest_lng=body.lng,
                    user_id=p.user.id if p.user else None)
    audit(db, p, "lot_dispatch", "shipment", sh.id, {"lot": lot.id, "grade": body.grade, "to": body.destination_name}, request)
    db.commit()
    return flow.lot_payload(db, lot, full=True)


def get_shipment(db: Session, shid: int, p: Principal) -> Shipment:
    sh = db.get(Shipment, shid)
    if sh is None:
        err(404, "not_found", "Shipment not found")
    get_lot(db, sh.lot_id, p)
    return sh


@router.get("/shipments/{shid}")
def shipment(shid: int, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return flow.shipment_geometry(db, get_shipment(db, shid, p))


@router.post("/shipments/{shid}/scenario")
def shipment_scenario(shid: int, body: ScenarioIn, request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    sh = get_shipment(db, shid, p)
    lot = db.get(Lot, sh.lot_id)
    if body.scenario == "road_blocked":
        info = _flow_call(flow.reroute, db, sh, "Road blocked ahead")
        audit(db, p, "shipment_reroute", "shipment", sh.id, {"reason": info["reason"]}, request)
        db.commit()
        return {"rerouted": {k: v for k, v in info.items() if k != "old_geometry"}, "lot": flow.lot_payload(db, lot)}
    sim = db.get(Simulation, sh.simulation_id)
    if sim is None or sh.status != "in_transit":
        err(409, "not_in_transit", "Shipment is not on the road")
    rt = manager.runtime(db, sim)
    with manager.lock:
        try:
            desc = rt.scenario(body.scenario)
        except ValueError as e:
            err(422, "invalid_input", str(e))
    sim.scenario = None if body.scenario == "normal" else body.scenario
    flow.add_event(db, lot, "scenario", f"Test scenario: {body.scenario.replace('_', ' ')}", desc, severity="INFO", sim_id=sim.id, push_it=False)
    audit(db, p, "shipment_scenario", "shipment", sh.id, {"scenario": body.scenario}, request)
    db.commit()
    return {"lot": flow.lot_payload(db, lot)}


# ---------------- playable sample situations ----------------
@router.get("/scripts")
def scripts(p: Principal = Depends(current_principal)):
    return {"scripts": [{"name": k, "title": v["title"], "summary": v["summary"], "steps": len(v["steps"]), "mode": v["lot"]["mode"]}
                        for k, v in flow.SCRIPTS.items()]}


class ScriptIn(BaseModel):
    station_id: int | None = None


@router.post("/scripts/{name}", status_code=201)
def start_script(name: str, body: ScriptIn, request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    sid = station_id_of(p) if p.kind == "qr" else body.station_id
    lot = _flow_call(flow.start_script, db, name, sid, p.user.id if p.user else None)
    audit(db, p, "start_script", "lot", lot.id, {"script": name}, request)
    db.commit()
    return flow.lot_payload(db, lot, full=True)


# ---------------- sell / store / discard ----------------
class ChoiceIn(BaseModel):
    choice: str = Field(..., pattern="^(store|discard)$")
    days: float = Field(3, ge=0.5, le=180)
    reason: str | None = Field(None, max_length=200)


@router.post("/lots/{lot_id}/choice")
def lot_choice(lot_id: int, body: ChoiceIn, request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    lot = get_lot(db, lot_id, p)
    res = _flow_call(flow.store_choice, db, lot, body.days) if body.choice == "store" else _flow_call(flow.discard_choice, db, lot, body.reason)
    audit(db, p, f"lot_{body.choice}", "lot", lot.id, {}, request)
    db.commit()
    return {**res, "lot": flow.lot_payload(db, lot, full=True)}


@router.post("/stations/{sid}/reset")
def reset_station(sid: int, request: Request, p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    n = flow.reset_station(db, sid)
    audit(db, p, "reset_station", "qr_session", sid, {"lots": n}, request)
    db.commit()
    return {"removed_lots": n}


# ---------------- fixes approved by the farmer ----------------
@router.post("/lots/{lot_id}/fixes/{cid}/approve")
def approve_fix(lot_id: int, cid: int, request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    lot = get_lot(db, lot_id, p)
    res = _flow_call(flow.approve_fix, db, lot, cid)
    audit(db, p, "approve_fix", "corrective_action", cid, {"lot": lot.id}, request)
    db.commit()
    return {**res, "lot": flow.lot_payload(db, lot, full=True)}


# ---------------- voice entry ----------------
class ParseIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=500)


KN_UNITS = {"ಒಂದು": 1, "ಒಂದೂವರೆ": 1.5, "ಎರಡು": 2, "ಎರಡೂವರೆ": 2.5, "ಮೂರು": 3, "ನಾಲ್ಕು": 4, "ಐದು": 5, "ಆರು": 6, "ಏಳು": 7, "ಎಂಟು": 8,
            "ಒಂಬತ್ತು": 9, "ಹತ್ತು": 10, "ಹದಿನೈದು": 15, "ಇಪ್ಪತ್ತು": 20, "ಇಪ್ಪತ್ತೈದು": 25, "ಮೂವತ್ತು": 30, "ನಲವತ್ತು": 40, "ಐವತ್ತು": 50,
            "ಅರವತ್ತು": 60, "ಎಪ್ಪತ್ತು": 70, "ಎಂಬತ್ತು": 80, "ತೊಂಬತ್ತು": 90, "ಅರ್ಧ": 0.5}
KN_HUNDREDS = {"ನೂರು": 100, "ಇನ್ನೂರು": 200, "ಮುನ್ನೂರು": 300, "ನಾನ್ನೂರು": 400, "ನಾನೂರು": 400, "ಐನೂರು": 500, "ಆರುನೂರು": 600, "ಆರ್ನೂರು": 600,
               "ಏಳುನೂರು": 700, "ಎಳ್ನೂರು": 700, "ಎಂಟುನೂರು": 800, "ಒಂಬೈನೂರು": 900, "ಒಂಬತ್ತುನೂರು": 900}
KN_THOUSAND = ("ಸಾವಿರ", "ಸಾವಿರದ")


def kn_number(text: str) -> float | None:
    """Kannada number words -> value, e.g. 'ಎರಡು ಸಾವಿರದ ಐನೂರು' = 2500, 'ಐನೂರು' = 500, 'ಮೂರು' = 3."""
    words = text.replace(",", " ").split()
    total, cur, seen = 0.0, 0.0, False
    for w in words:
        base = w.rstrip("ಕೆ").rstrip("ಗೆ") if w not in KN_UNITS and w not in KN_HUNDREDS else w
        if w in KN_UNITS or base in KN_UNITS:
            cur += KN_UNITS.get(w, KN_UNITS.get(base, 0)); seen = True
        elif w in KN_HUNDREDS or base in KN_HUNDREDS:
            cur = (cur or 1) * 100 if (w == "ನೂರು" and cur) else cur + KN_HUNDREDS.get(w, KN_HUNDREDS.get(base, 0)); seen = True
        elif any(w.startswith(t) for t in KN_THOUSAND):
            total += (cur or 1) * 1000; cur = 0; seen = True
    return total + cur if seen else None


KN_ALIASES = {"tomato": ["ಟೊಮೆಟೊ", "ಟೊಮ್ಯಾಟೊ", "ಟೊಮೇಟೊ", "ಟಮೋಟ", "tamata", "tamatar"], "potato": ["ಆಲೂಗಡ್ಡೆ", "ಆಲೂ", "aloo"],
              "banana": ["ಬಾಳೆ", "ಬಾಳೆಹಣ್ಣು"], "mango": ["ಮಾವು", "ಮಾವಿನ"], "rice": ["ಭತ್ತ", "ಅಕ್ಕಿ", "paddy"], "maize": ["ಮೆಕ್ಕೆಜೋಳ", "ಜೋಳ"],
              "cabbage": ["ಎಲೆಕೋಸು"], "carrot": ["ಕ್ಯಾರೆಟ್", "ಗಜ್ಜರಿ"], "brinjal": ["ಬದನೆ", "ಬದನೇಕಾಯಿ"], "okra": ["ಬೆಂಡೆ", "ಬೆಂಡೆಕಾಯಿ", "bhindi"],
              "green_chilli": ["ಮೆಣಸಿನಕಾಯಿ", "ಹಸಿಮೆಣಸು"], "grapes": ["ದ್ರಾಕ್ಷಿ"], "papaya": ["ಪಪ್ಪಾಯಿ", "ಪರಂಗಿ"], "orange": ["ಕಿತ್ತಳೆ"],
              "pomegranate": ["ದಾಳಿಂಬೆ"], "wheat": ["ಗೋಧಿ"], "cauliflower": ["ಹೂಕೋಸು"]}


def _local_parse(text: str, crops: dict) -> dict:
    import re
    t = text.lower()
    com = next((cid for cid, names in crops.items() if any(n.lower() in t for n in list(names) + KN_ALIASES.get(cid, []) if n)), None)
    m = re.search(r"(\d+(?:\.\d+)?)\s*(t|ton|tonne|tonnes|quintal|quintals|kg|kgs|kilo|kilos|ಕೆಜಿ|ಟನ್|ಕ್ವಿಂಟಾಲ್)?", t)
    qty = None
    knv = None if m else kn_number(text)
    if m or knv is not None:
        v = float(m.group(1)) if m else knv
        u = (m.group(2) if m else None) or next((x for x in ("ಟನ್", "ಕ್ವಿಂಟಾಲ್", "quintal", "tonne", "ton") if x in t), "kg")
        qty = v * 1000 if u in ("t", "ton", "tonne", "tonnes", "ಟನ್") else v * 100 if u in ("quintal", "quintals", "ಕ್ವಿಂಟಾಲ್") else v
    return {"commodity": com, "quantity_kg": qty, "days_since_harvest": None, "heard": text}


@router.post("/parse-entry")
def parse_entry(body: ParseIn, request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    from app.db.models import Commodity
    crops = {c.id: [c.name, c.name_kn, c.id.replace("_", " ")] for c in db.scalars(select(Commodity)).all() if c.prediction_supported}
    local = _local_parse(body.text, crops)
    if local["commodity"] and local["quantity_kg"]:
        return {**local, "parser": "rules"}
    if not ai_limiter.check(f"ai:{request.client.host if request.client else '?'}"):
        err(429, "rate_limited", "Too many requests; wait a little")
    try:
        d = groq_ai.parse_entry(body.text, crops)
    except groq_ai.Unavailable as e:
        if local["commodity"] or local["quantity_kg"]:
            return {**local, "parser": "rules"}
        err(503, "ai_unavailable", f"Could not understand the entry: {e}")
    # the deterministic rules win where they found something; the AI only fills the gaps
    return {**d, "commodity": local["commodity"] or d["commodity"], "quantity_kg": local["quantity_kg"] or d["quantity_kg"], "parser": "rules+groq"}


# ---------------- Kannada voice (offline female TTS) ----------------
class TtsIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=600)


@router.post("/tts")
def tts(body: TtsIn, request: Request, p: Principal = Depends(current_principal)):
    from fastapi import Response
    from app.integrations import tts_kn
    if not ai_limiter.check(f"tts:{request.client.host if request.client else '?'}"):
        err(429, "rate_limited", "Too many voice requests; wait a little")
    try:
        wav = tts_kn.synthesize(body.text)
    except tts_kn.Unavailable as e:
        err(503, "voice_unavailable", str(e))
    return Response(content=wav, media_type="audio/wav", headers={"Cache-Control": "no-store"})


@router.get("/tts/status")
def tts_status(p: Principal = Depends(current_principal)):
    from app.integrations import tts_kn
    return {"kannada_voice": tts_kn.available(), "credit": tts_kn.CREDIT}


# ---------------- assistant ----------------
class ChatIn(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    lot_id: int | None = None
    language: str = Field("en", pattern="^(en|kn)$")
    history: list[dict] = Field(default_factory=list, max_length=20)


@router.post("/chat")
def chat(body: ChatIn, request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    if not ai_limiter.check(f"ai:{request.client.host if request.client else '?'}"):
        err(429, "rate_limited", "Too many questions in a minute; wait a little")
    lot = get_lot(db, body.lot_id, p) if body.lot_id else None
    try:
        return groq_ai.chat(body.message, flow.chat_context(db, lot), body.history, body.language)
    except groq_ai.Unavailable as e:
        err(503, "ai_unavailable", f"Assistant unavailable: {e}")
