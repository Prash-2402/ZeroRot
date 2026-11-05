"""Commodities (sourced registry), farmers and produce batches, plus weather lookups."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import Principal, audit, current_principal, current_user, err
from app.db.models import Commodity, FarmerProfile, ProduceBatch
from app.db.session import get_db
from app.engine.validation import validate_batch
from app.integrations import weather

router = APIRouter(tags=["catalog"])


# ---------------- commodities ----------------
@router.get("/commodities")
def commodities(db: Session = Depends(get_db)):
    out = []
    for c in db.scalars(select(Commodity).order_by(Commodity.id)).all():
        params = {x.key: x for x in c.parameters}
        g = lambda k: params[k].value if k in params else None
        out.append({"id": c.id, "name": c.name, "name_kn": c.name_kn, "prediction_supported": c.prediction_supported, "prediction_note": c.prediction_note,
                    "ethylene": c.ethylene, "ethylene_sensitive": c.ethylene_sensitive, "registry_version": c.registry_version,
                    "storage": {"temperature_c": g("t_ref"), "rh_low": g("rh_low"), "rh_high": g("rh_high"), "chilling_threshold_c": g("t_chill"),
                                "storage_life_days": g("storage_life")}})
    return {"commodities": out}


@router.get("/commodities/{cid}")
def commodity(cid: str, db: Session = Depends(get_db)):
    c = db.get(Commodity, cid)
    if c is None:
        err(404, "not_found", "Unknown commodity")
    return {"id": c.id, "name": c.name, "prediction_supported": c.prediction_supported, "prediction_note": c.prediction_note,
            "parameters": [{"key": p.key, "name": p.name, "value": p.value, "unit": p.unit, "range": [p.range_low, p.range_high] if p.range_low is not None else None,
                            "classification": p.classification, "source": p.source, "derivation": p.derivation, "limitations": p.limitations}
                           for p in sorted(c.parameters, key=lambda x: x.key)]}


# ---------------- farmers ----------------
class FarmerIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    phone: str | None = Field(None, max_length=32)
    village: str | None = None
    location_name: str | None = None
    lat: float | None = Field(None, ge=-90, le=90)
    lng: float | None = Field(None, ge=-180, le=180)
    language: str = Field("kn", pattern="^(kn|en)$")


def farmer_dict(f: FarmerProfile) -> dict:
    return {"id": f.id, "name": f.name, "phone": f.phone, "village": f.village, "location_name": f.location_name, "lat": f.lat, "lng": f.lng,
            "language": f.language, "created_at": f.created_at.isoformat()}


@router.get("/farmers")
def farmers(p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    return {"farmers": [farmer_dict(f) for f in db.scalars(select(FarmerProfile).order_by(FarmerProfile.id.desc())).all()]}


@router.post("/farmers", status_code=201)
def create_farmer(body: FarmerIn, request: Request, p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    f = FarmerProfile(**body.model_dump(), managed_by=p.user.id)
    db.add(f)
    db.flush()
    audit(db, p, "create_farmer", "farmer", f.id, request=request)
    db.commit()
    return farmer_dict(f)


# ---------------- batches ----------------
class BatchIn(BaseModel):
    farmer_id: int | None = None
    commodity_id: str
    variety: str | None = Field(None, max_length=64)
    quantity_kg: float = Field(..., gt=0, le=100000)
    harvest_time: datetime
    initial_quality: float = Field(..., ge=0, le=100)
    maturity: str | None = Field(None, pattern="^(mature_green|turning|ripe)$")
    location_name: str | None = None
    lat: float | None = Field(None, ge=-90, le=90)
    lng: float | None = Field(None, ge=-180, le=180)
    storage_path: str | None = Field(None, pattern="^(traditional|advanced)$")


def batch_dict(b: ProduceBatch) -> dict:
    return {"id": b.id, "code": b.code, "farmer_id": b.farmer_id, "commodity_id": b.commodity_id, "variety": b.variety, "quantity_kg": b.quantity_kg,
            "harvest_time": b.harvest_time.isoformat(timespec="minutes"), "initial_quality": b.initial_quality, "maturity": b.maturity,
            "location_name": b.location_name, "lat": b.lat, "lng": b.lng, "storage_path": b.storage_path, "status": b.status,
            "created_at": b.created_at.isoformat(timespec="minutes")}


@router.get("/batches")
def batches(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    q = select(ProduceBatch).order_by(ProduceBatch.id.desc())
    rows = db.scalars(q).all()
    if p.kind == "qr":
        rows = [b for b in rows if p.can_access("batch", b.id)]
    return {"batches": [batch_dict(b) for b in rows]}


@router.post("/batches", status_code=201)
def create_batch(body: BatchIn, request: Request, p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    now = datetime.utcnow()
    harvest = body.harvest_time.replace(tzinfo=None)
    errors = validate_batch(produce=body.commodity_id, quantity_kg=body.quantity_kg, harvest_time=harvest, now=now,
                            maturity=body.maturity, initial_quality=body.initial_quality)
    if body.farmer_id is not None and db.get(FarmerProfile, body.farmer_id) is None:
        errors.append("Unknown farmer")
    if errors:
        err(422, "invalid_input", "; ".join(errors), errors=errors)
    seq = (db.scalar(select(ProduceBatch.id).order_by(ProduceBatch.id.desc())) or 0) + 1
    b = ProduceBatch(code=f"ZR-{body.commodity_id[:3].upper()}-{seq:05d}", **{**body.model_dump(), "harvest_time": harvest}, created_by=p.user.id)
    db.add(b)
    db.flush()
    audit(db, p, "create_batch", "batch", b.id, {"commodity": b.commodity_id, "kg": b.quantity_kg}, request)
    db.commit()
    return batch_dict(b)


@router.get("/batches/{bid}")
def batch(bid: int, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    b = db.get(ProduceBatch, bid)
    if b is None or not (p.kind == "user" or p.can_access("batch", bid)):
        err(404, "not_found", "Batch not found")
    return batch_dict(b)


class BatchStatusIn(BaseModel):
    status: str = Field(..., pattern="^(registered|inspected|in_storage|in_transit|sold|discarded)$")


@router.patch("/batches/{bid}")
def update_batch(bid: int, body: BatchStatusIn, request: Request, p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    b = db.get(ProduceBatch, bid)
    if b is None:
        err(404, "not_found", "Batch not found")
    old = b.status
    b.status = body.status
    audit(db, p, "update_batch_status", "batch", bid, {"from": old, "to": body.status}, request)
    db.commit()
    return batch_dict(b)


# ---------------- weather ----------------
@router.get("/weather/geocode")
def geocode(q: str, p: Principal = Depends(current_principal)):
    try:
        return {"results": weather.geocode(q), "source": "Open-Meteo geocoding", "status": "live"}
    except weather.Unavailable as e:
        err(503, "weather_unavailable", str(e))


@router.get("/weather/forecast")
def forecast(lat: float, lng: float, p: Principal = Depends(current_principal)):
    try:
        fc = weather.forecast(lat, lng)
    except weather.Unavailable as e:
        err(503, "weather_unavailable", str(e))
    # hourly series trimmed to 72 h for display
    return {"status": "live", "source": fc["source"], "retrieved_at": fc["retrieved_at"], "current": fc["current"],
            "hourly": [{"t": t, "temperature_c": a, "rh_pct": b, "pressure_pa": c} for t, a, b, c in list(zip(fc["times"], fc["t"], fc["rh"], fc["p"]))[24:96]]}
