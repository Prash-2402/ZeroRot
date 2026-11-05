"""PROVE endpoints: harvest passport, impact, district exposure, parameter registry, validation, group shipping, image ripeness."""
from __future__ import annotations

import math

import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import domain
from app.db.models import (Batch, Decision, GhostComparison, GroupShipment, ImpactEvent, Notification, Prediction, Reading,
                           ShipmentMember, StorageRecord, ValidationRecord)
from app.db.session import get_db
from app.engine import geo
from app.engine.plans import transport_cost
from app.engine.registry import load_registry

router = APIRouter()
CO2_FACTOR = 0.5  # kg CO2e per kg of produce kept out of waste: engineering assumption, not crop-specific measured data


def err(status, code, message):
    raise HTTPException(status, detail={"error": code, "message": message})


@router.get("/passport/{token}")
def passport(token: str, db: Session = Depends(get_db)):
    b = db.scalars(select(Batch).where(Batch.passport_token == token)).first()
    if b is None:
        err(404, "not_found", "Passport not found")
    rd = db.scalars(select(Reading).where(Reading.batch_id == b.id).order_by(Reading.ts)).all()
    step = max(1, len(rd) // 200)
    preds = db.scalars(select(Prediction).where(Prediction.batch_id == b.id).order_by(Prediction.ts)).all()
    recs = db.scalars(select(StorageRecord).where(StorageRecord.batch_id == b.id).order_by(StorageRecord.start)).all()
    p = load_registry()[b.produce]
    return {"batch_id": b.id, "produce": p.display_name, "produce_kn": p.kannada, "variety": b.variety, "quantity_kg": b.quantity_kg,
            "harvest_date": b.harvest_time.date().isoformat(), "harvest_time": domain.iso(b.harvest_time),
            "district": geo.points().get(b.district, {}).get("name", b.district), "maturity": b.maturity, "initial_quality": b.initial_quality,
            "current_quality": round(b.q, 1), "status": b.status,
            "storage_history": [{"type": s.storage_type, "label": s.label, "start": domain.iso(s.start), "end": domain.iso(s.end)} for s in recs],
            "readings": [{"ts": domain.iso(r.ts), "temp_c": r.temp_c, "rh": r.rh, "origin": r.origin} for r in rd[::step]],
            "predictions": [{"ts": domain.iso(x.ts), "quality": x.quality, "shelf_life_days": x.shelf_life_days, "confidence": x.confidence_category,
                             "model_version": x.model_version, "origins": x.data_origins} for x in preds],
            "data_origins": sorted({r.origin for r in rd} | {"model_prediction"}), "origin": b.origin,
            "disclaimer": "Traceability record, not a food-safety certificate. Readings marked 'simulated' come from the demo cold-chain feed."}


@router.get("/impact")
def impact(db: Session = Depends(get_db)):
    vp = db.scalar(select(func.coalesce(func.sum(ImpactEvent.value_inr), 0.0)).where(ImpactEvent.kind == "value_protected")) or 0
    kg = db.scalar(select(func.coalesce(func.sum(ImpactEvent.kg), 0.0)).where(ImpactEvent.kind == "value_protected")) or 0
    handled = db.scalar(select(func.count(ImpactEvent.id)).where(ImpactEvent.kind == "alert_handled")) or 0
    choices = db.scalar(select(func.count(Decision.id)).where(Decision.farmer_choice.is_not(None))) or 0
    raised = db.scalar(select(func.count(Notification.id)).where(Notification.channel == "in_app", Notification.severity.in_(["warning", "critical"]))) or 0
    batches = db.scalars(select(Batch)).all()
    by_produce = {}
    for b in batches:
        d = by_produce.setdefault(b.produce, {"produce": b.produce, "batches": 0, "kg": 0.0, "value": 0.0, "value_at_risk": 0.0, "critical": 0})
        d["batches"] += 1
        d["kg"] += b.quantity_kg
        d["value"] += b.value_inr or 0
        if b.risk != "healthy":
            d["value_at_risk"] += b.value_inr or 0
        d["critical"] += b.risk == "critical"
    events = db.scalars(select(ImpactEvent).where(ImpactEvent.kind == "value_protected").order_by(ImpactEvent.ts)).all()
    ghosts = db.scalars(select(GhostComparison).order_by(GhostComparison.id.desc())).all()
    sim_count = sum(1 for e in events if e.origin == "simulated")
    return {"value_protected": round(vp), "food_protected_kg": round(kg, 1), "co2_avoided_kg": round(kg * CO2_FACTOR, 1),
            "co2_method": f"Food protected (kg) x {CO2_FACTOR} kg CO2e/kg. The factor is an engineering assumption, not crop-specific measured data.",
            "batches_monitored": len(batches), "alerts_raised": raised, "alerts_handled": handled + choices,
            "loss_exposure": sorted(by_produce.values(), key=lambda x: -x["value_at_risk"]),
            "events": [{"ts": domain.iso(e.ts), "batch_id": e.batch_id, "trip_id": e.trip_id, "value": e.value_inr, "kg": e.kg, "origin": e.origin} for e in events],
            "ghost_comparisons": [{"trip_id": g.trip_id, "batch_id": g.batch_id, "value_protected": g.value_protected,
                                   "ghost_net": g.ghost.get("net"), "reroute_net": g.reroute.get("net"), "label": g.label} for g in ghosts[:10]],
            "simulated": sim_count == len(events) and len(events) > 0 or all(b.origin == "simulated" for b in batches),
            "label": "Computed from backend records. Records from the demo simulation are SIMULATED."}


@router.get("/impact/districts")
def districts(produce: str | None = None, db: Session = Depends(get_db)):
    pts = geo.points()
    agg = {}
    for b in db.scalars(select(Batch)).all():
        if produce and b.produce != produce:
            continue
        d = agg.setdefault(b.district, {"district": b.district, "name": pts.get(b.district, {}).get("name", b.district),
                                        "lat": pts.get(b.district, {}).get("lat", b.lat), "lng": pts.get(b.district, {}).get("lng", b.lng),
                                        "batches": 0, "kg": 0.0, "value": 0.0, "value_at_risk": 0.0, "quality_sum": 0.0})
        d["batches"] += 1
        d["kg"] += b.quantity_kg
        d["value"] += b.value_inr or 0
        d["quality_sum"] += b.q
        if b.risk != "healthy":
            d["value_at_risk"] += b.value_inr or 0
    out = []
    for d in agg.values():
        d["mean_quality"] = round(d.pop("quality_sum") / d["batches"], 1)
        d["exposure_pct"] = round(100 * d["value_at_risk"] / d["value"], 1) if d["value"] else 0
        out.append(d)
    return {"districts": sorted(out, key=lambda x: -x["value_at_risk"]), "label": "SIMULATED batch records (demo mode). Points are district centroids."}


@router.get("/parameters")
def parameters():
    reg = load_registry()
    return {"produce": [{"produce": p.produce, "display_name": p.display_name, "kannada": p.kannada, "version": p.version,
                         "last_reviewed": p.meta.get("last_reviewed"), "parameter_quality": round(p.parameter_quality(), 3),
                         "params": list(p.params.values())} for p in reg.values()],
            "calibration_note": "k_ref is calibrated so quality reaches the minimum sellable score at the published storage life. "
                                "This guarantees the end point by construction; it does not validate the curve shape.",
            "audit": "docs/parameter_audit.md"}


class ValidationIn(BaseModel):
    batch_id: str
    observed_quality: float | None = Field(None, ge=0, le=100)
    observed_shelf_life: float | None = Field(None, ge=0, le=60)
    note: str | None = None


def _metrics(rows):
    out = {}
    for prod in sorted({r.produce for r in rows}):
        rs = [r for r in rows if r.produce == prod]
        for key, pk, ok in (("quality", "predicted_quality", "observed_quality"), ("shelf_life_days", "predicted_shelf_life", "observed_shelf_life")):
            pairs = [(getattr(r, pk), getattr(r, ok)) for r in rs if getattr(r, pk) is not None and getattr(r, ok) is not None]
            if not pairs:
                continue
            e = np.array([p - o for p, o in pairs])
            out.setdefault(prod, {})[key] = {"n": len(pairs), "mae": round(float(np.abs(e).mean()), 2),
                                             "rmse": round(float(np.sqrt((e ** 2).mean())), 2), "bias": round(float(e.mean()), 2)}
    return out


@router.get("/validation")
def validation(db: Session = Depends(get_db)):
    rows = db.scalars(select(ValidationRecord).order_by(ValidationRecord.id.desc())).all()
    if not rows:
        return {"records": [], "metrics": {}, "message": "Validation data not yet available."}
    return {"records": [{"id": r.id, "batch_id": r.batch_id, "produce": r.produce, "predicted_quality": r.predicted_quality,
                         "observed_quality": r.observed_quality, "predicted_shelf_life": r.predicted_shelf_life,
                         "observed_shelf_life": r.observed_shelf_life, "observed_at": domain.iso(r.observed_at), "note": r.note} for r in rows],
            "metrics": _metrics(rows), "message": None}


@router.post("/validation", status_code=201)
def add_validation(body: ValidationIn, db: Session = Depends(get_db)):
    b = db.get(Batch, body.batch_id)
    if b is None:
        err(404, "not_found", "batch not found")
    if body.observed_quality is None and body.observed_shelf_life is None:
        err(422, "invalid_input", "Enter an observed quality or shelf life")
    pred = db.scalars(select(Prediction).where(Prediction.batch_id == b.id).order_by(Prediction.ts.desc())).first()
    if pred is None:
        err(409, "no_prediction", "Open the batch's digital twin first so a prediction is stored")
    r = ValidationRecord(batch_id=b.id, produce=b.produce, prediction_id=pred.id, predicted_quality=pred.quality,
                         predicted_shelf_life=pred.shelf_life_days, observed_quality=body.observed_quality,
                         observed_shelf_life=body.observed_shelf_life, observed_at=domain.sim_now(db), note=body.note, origin="manual")
    db.add(r)
    db.commit()
    return {"id": r.id}


# ---------------- group shipping ----------------
@router.get("/group-shipping")
def group_candidates(batch_id: str, dest_id: str = "m_bengaluru", db: Session = Depends(get_db)):
    b = db.get(Batch, batch_id)
    if b is None:
        err(404, "not_found", "batch not found")
    if dest_id not in geo.points():
        err(422, "invalid_input", "unknown destination")
    reg = load_registry()
    members = [b]
    warnings = []
    for o in db.scalars(select(Batch).where(Batch.status == "stored", Batch.id != b.id)).all():
        if geo.haversine_km((b.lat, b.lng), (o.lat, o.lng)) > 80:
            continue
        if o.produce != b.produce:
            producer = o if reg[o.produce].meta.get("ethylene") == "producer_high" else b if reg[b.produce].meta.get("ethylene") == "producer_high" else None
            if producer is not None:
                other = b if producer is o else o
                warnings.append({"batch_id": o.id, "message": f"Incompatible handling: {reg[producer.produce].display_name.lower()} gives off a lot of ethylene, "
                                                              f"which speeds ripening of {reg[other.produce].display_name.lower()}. Not grouped."})
                continue
        members.append(o)
    total = sum(m.quantity_kg for m in members)
    legs = {m.id: geo.travel(m.district, dest_id) for m in members}
    km = max(l["km"] for l in legs.values()) + 15 * (len(members) - 1)  # pickup detours: engineering assumption
    shared = transport_cost(km, total)
    rows = []
    for m in members:
        solo = transport_cost(legs[m.id]["km"], m.quantity_kg)
        share = shared * m.quantity_kg / total
        rows.append({"batch_id": m.id, "produce": m.produce, "quantity_kg": m.quantity_kg, "district": m.district,
                     "solo_cost": round(solo), "shared_cost": round(share), "savings": round(solo - share)})
    return {"destination": geo.points()[dest_id]["name"], "dest_id": dest_id, "members": rows, "total_kg": total, "shared_truck_cost": round(shared),
            "warnings": warnings, "label": "Other farmers' batches are SIMULATED in demo mode. Costs are demo defaults."}


class GroupIn(BaseModel):
    batch_id: str
    dest_id: str


@router.post("/group-shipping", status_code=201)
def group_create(body: GroupIn, db: Session = Depends(get_db)):
    plan = group_candidates(body.batch_id, body.dest_id, db)
    if len(plan["members"]) < 2:
        err(409, "conflict", "No compatible nearby batches to group")
    g = GroupShipment(dest_id=body.dest_id, created=domain.sim_now(db), total_cost=plan["shared_truck_cost"], data=plan)
    db.add(g)
    db.flush()
    for m in plan["members"]:
        db.add(ShipmentMember(shipment_id=g.id, batch_id=m["batch_id"], share_inr=m["shared_cost"], savings_inr=m["savings"]))
    db.commit()
    return {"id": g.id, **plan}


# ---------------- image ripeness (P2) ----------------
@router.post("/image/ripeness")
async def ripeness(produce: str = "tomato", file: UploadFile = File(...)):
    import cv2
    if produce not in load_registry():
        err(422, "invalid_input", "unsupported produce")
    data = await file.read()
    if len(data) > 8_000_000:
        err(413, "too_large", "Image larger than 8 MB")
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        err(422, "invalid_input", "Could not read image")
    img = cv2.resize(img, (320, int(320 * img.shape[0] / img.shape[1])))
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0].astype(int), hsv[..., 1].astype(int), hsv[..., 2].astype(int)
    fruit = (s > 60) & (v > 40)
    n = int(fruit.sum())
    if n < 500:
        err(422, "invalid_input", "Could not find produce in the photo (try a closer, well-lit photo)")
    red = (((h <= 10) | (h >= 170)) & fruit).sum() / n
    orange = ((h > 10) & (h <= 22) & fruit).sum() / n
    yellow = ((h > 22) & (h <= 35) & fruit).sum() / n
    green = ((h > 35) & (h <= 85) & fruit).sum() / n
    dark = ((v < 70) & (s > 40)).sum() / max(1, ((s > 40)).sum())
    ripe_share = red + orange if produce == "tomato" else yellow + orange
    maturity = "ripe" if ripe_share > 0.55 else ("mature_green" if green > 0.6 else "turning")
    q = float(np.clip(96 - dark * 120, 40, 96))
    return {"produce": produce, "maturity_estimate": maturity, "starting_quality_estimate": round(q),
            "hue_shares": {"red": round(red, 3), "orange": round(orange, 3), "yellow": round(yellow, 3), "green": round(green, 3)},
            "dark_spot_share": round(dark, 3), "origin": "image_derived",
            "label": "Image-derived estimate from colour only. It does not measure firmness, sugar content, internal spoilage or safety."}
