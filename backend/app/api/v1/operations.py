"""Storage facilities, zones and allocation; produce inspection; trucks and routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import Principal, audit, current_principal, current_user, err
from app.db.models import (Inspection, InspectionResult, ProduceBatch, StorageAllocation, StorageFacility, StorageZone, TransportationRoute,
                           Truck)
from app.db.session import get_db
from app.integrations import routing
from app.ml import vision
from app.services import allocation

router = APIRouter(tags=["operations"])


# ---------------- storage ----------------
class FacilityIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    kind: str = Field(..., pattern="^(traditional|cold)$")
    location_name: str | None = None
    lat: float | None = Field(None, ge=-90, le=90)
    lng: float | None = Field(None, ge=-180, le=180)


class ZoneIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    temp_min: float = Field(..., ge=-5, le=30)
    temp_max: float = Field(..., ge=-5, le=30)
    setpoint: float = Field(..., ge=-5, le=30)
    rh_setpoint: float = Field(90, ge=40, le=100)
    capacity_kg: float = Field(..., gt=0, le=2_000_000)
    cooling_capacity_kw: float = Field(..., ge=0, le=500)
    ua_w_per_k: float = Field(..., gt=0, le=10000)
    volume_m3: float = Field(..., gt=1, le=50000)
    air_changes_per_hour: float = Field(0.2, ge=0, le=20)
    cost_per_kg_day: float = Field(0.5, ge=0, le=100)


def zone_dict(db: Session, z: StorageZone) -> dict:
    load = allocation.zone_load(db, z.id)
    return {"id": z.id, "facility_id": z.facility_id, "name": z.name, "temp_min": z.temp_min, "temp_max": z.temp_max, "setpoint": z.setpoint,
            "rh_setpoint": z.rh_setpoint, "capacity_kg": z.capacity_kg, "used_kg": round(load, 1), "free_kg": round(z.capacity_kg - load, 1),
            "cooling_capacity_kw": z.cooling_capacity_kw, "ua_w_per_k": z.ua_w_per_k, "volume_m3": z.volume_m3,
            "air_changes_per_hour": z.air_changes_per_hour, "cost_per_kg_day": z.cost_per_kg_day, "status": z.status}


@router.get("/storage/facilities")
def facilities(p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    return {"facilities": [{"id": f.id, "name": f.name, "kind": f.kind, "location_name": f.location_name, "lat": f.lat, "lng": f.lng,
                            "zones": [zone_dict(db, z) for z in f.zones]} for f in db.scalars(select(StorageFacility).order_by(StorageFacility.id)).all()]}


@router.post("/storage/facilities", status_code=201)
def create_facility(body: FacilityIn, request: Request, p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    f = StorageFacility(**body.model_dump(), owner_id=p.user.id)
    db.add(f)
    db.flush()
    audit(db, p, "create_facility", "facility", f.id, body.model_dump(), request)
    db.commit()
    return {"id": f.id}


@router.post("/storage/facilities/{fid}/zones", status_code=201)
def create_zone(fid: int, body: ZoneIn, request: Request, p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    f = db.get(StorageFacility, fid)
    if f is None:
        err(404, "not_found", "Facility not found")
    if not (body.temp_min <= body.setpoint <= body.temp_max):
        err(422, "invalid_input", "Setpoint must be inside the zone temperature range")
    z = StorageZone(facility_id=fid, **body.model_dump())
    db.add(z)
    db.flush()
    audit(db, p, "create_zone", "zone", z.id, body.model_dump(), request)
    db.commit()
    return zone_dict(db, z)


class AllocIn(BaseModel):
    batch_id: int
    planned_days: float = Field(7, gt=0, le=60)
    quantity_kg: float | None = Field(None, gt=0)
    zone_id: int | None = None


@router.post("/storage/allocations/recommend")
def recommend(body: AllocIn, p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    b = db.get(ProduceBatch, body.batch_id)
    if b is None:
        err(404, "not_found", "Batch not found")
    try:
        return allocation.recommend(db, b, body.planned_days, body.quantity_kg)
    except ValueError as e:
        err(422, "invalid_input", str(e))


@router.post("/storage/allocations", status_code=201)
def allocate(body: AllocIn, request: Request, p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    b = db.get(ProduceBatch, body.batch_id)
    if b is None:
        err(404, "not_found", "Batch not found")
    rec = allocation.recommend(db, b, body.planned_days, body.quantity_kg)
    choice = next((o for o in rec["options"] if body.zone_id is None or o["zone_id"] == body.zone_id), None)
    if choice is None:
        reason = next((r["reason"] for r in rec["rejected"] if r["zone_id"] == body.zone_id), rec.get("message") or "zone not feasible")
        err(409, "allocation_infeasible", f"Cannot allocate: {reason}", rejected=rec["rejected"])
    a = StorageAllocation(batch_id=b.id, zone_id=choice["zone_id"], quantity_kg=choice["allocation_kg"], setpoint=choice["setpoint_c"],
                          rh_setpoint=choice["rh_setpoint_pct"], expected_shelf_life_days=choice["expected_shelf_life_days"],
                          estimated_cost=choice["estimated_cost"], planned_days=body.planned_days, rationale=choice)
    db.add(a)
    b.status, b.storage_path = "in_storage", "advanced"
    db.flush()
    audit(db, p, "allocate_storage", "allocation", a.id, {"batch": b.id, "zone": a.zone_id, "kg": a.quantity_kg}, request)
    db.commit()
    return {"id": a.id, "allocation": choice}


@router.get("/storage/allocations")
def allocations(p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(StorageAllocation).order_by(StorageAllocation.id.desc())).all()
    return {"allocations": [{"id": a.id, "batch_id": a.batch_id, "zone_id": a.zone_id, "quantity_kg": a.quantity_kg, "setpoint": a.setpoint,
                             "rh_setpoint": a.rh_setpoint, "expected_shelf_life_days": a.expected_shelf_life_days, "estimated_cost": a.estimated_cost,
                             "planned_days": a.planned_days, "status": a.status, "created_at": a.created_at.isoformat(timespec="minutes")} for a in rows]}


# ---------------- inspection ----------------
@router.get("/inspections/model")
def model_status(p: Principal = Depends(current_principal)):
    return vision.model_status()


@router.post("/inspections", status_code=201)
async def inspect(request: Request, commodity_id: str = Form(...), batch_id: int | None = Form(None), sample_kg: float | None = Form(None),
                  files: list[UploadFile] = File(...), p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    if not files or len(files) > 20:
        err(422, "invalid_input", "Upload between 1 and 20 images")
    batch = db.get(ProduceBatch, batch_id) if batch_id else None
    if batch_id and batch is None:
        err(404, "not_found", "Batch not found")
    results, failed = [], []
    for f in files:
        data = await f.read()
        if len(data) > 10_000_000:
            failed.append({"image": f.filename, "error": "larger than 10 MB"})
            continue
        try:
            results.append(vision.inspect(data, f.filename or "image", commodity_id))
        except ValueError as e:
            failed.append({"image": f.filename, "error": str(e)})
    if not results:
        err(422, "invalid_image", "No image could be inspected", failed=failed)
    summary = vision.summarise(results, batch.quantity_kg if batch else None, sample_kg)
    summary["failed_images"] = failed
    summary["notes"] = [r["note"] for r in results if r["note"]]
    ins = Inspection(batch_id=batch.id if batch else None, commodity_id=commodity_id, method=results[0]["method"], model_version=results[0]["model_version"],
                     images_count=len(results), objects_detected=summary["objects_detected"], summary=summary, created_by=p.user.id)
    db.add(ins)
    db.flush()
    for r in results:
        for i, o in enumerate(r["objects"]):
            db.add(InspectionResult(inspection_id=ins.id, image_name=r["image_name"], object_index=i, bbox=o["bbox"], category=o["category"],
                                    confidence=o["confidence"], features=o["features"]))
    if batch and batch.status == "registered":
        batch.status = "inspected"
    audit(db, p, "inspection", "inspection", ins.id, {"images": len(results), "objects": summary["objects_detected"]}, request)
    db.commit()
    return {"id": ins.id, "summary": summary, "images": [{"image_name": r["image_name"], "width": r["width"], "height": r["height"],
                                                          "objects": r["objects"], "note": r["note"]} for r in results],
            "method": ins.method, "model_version": ins.model_version,
            "label": "Classical OpenCV analysis (thresholds are engineering assumptions; not validated against a labelled dataset)."}


@router.get("/inspections")
def inspections(p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    return {"inspections": [{"id": i.id, "batch_id": i.batch_id, "commodity_id": i.commodity_id, "method": i.method, "images_count": i.images_count,
                             "objects_detected": i.objects_detected, "summary": i.summary, "created_at": i.created_at.isoformat(timespec="minutes")}
                            for i in db.scalars(select(Inspection).order_by(Inspection.id.desc())).all()]}


# ---------------- trucks & routes ----------------
class TruckIn(BaseModel):
    code: str = Field(..., min_length=2, max_length=32)
    name: str = Field(..., min_length=2, max_length=120)
    cooling_capacity_kw: float = Field(..., gt=0, le=60)
    ua_w_per_k: float = Field(..., gt=0, le=1000)
    cargo_volume_m3: float = Field(..., gt=1, le=120)
    capacity_kg: float = Field(..., gt=0, le=40000)


@router.get("/trucks")
def trucks(p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    return {"trucks": [{"id": t.id, "code": t.code, "name": t.name, "cooling_capacity_kw": t.cooling_capacity_kw, "ua_w_per_k": t.ua_w_per_k,
                        "cargo_volume_m3": t.cargo_volume_m3, "capacity_kg": t.capacity_kg} for t in db.scalars(select(Truck).order_by(Truck.id)).all()]}


@router.post("/trucks", status_code=201)
def create_truck(body: TruckIn, request: Request, p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    if db.scalars(select(Truck).where(Truck.code == body.code)).first():
        err(409, "exists", "Truck code already used")
    t = Truck(**body.model_dump(), owner_id=p.user.id)
    db.add(t)
    db.flush()
    audit(db, p, "create_truck", "truck", t.id, body.model_dump(), request)
    db.commit()
    return {"id": t.id}


class RouteIn(BaseModel):
    origin_name: str
    origin_lat: float = Field(..., ge=-90, le=90)
    origin_lng: float = Field(..., ge=-180, le=180)
    dest_name: str
    dest_lat: float = Field(..., ge=-90, le=90)
    dest_lng: float = Field(..., ge=-180, le=180)


def route_dict(r: TransportationRoute) -> dict:
    return {"id": r.id, "origin_name": r.origin_name, "origin": [r.origin_lat, r.origin_lng], "dest_name": r.dest_name, "dest": [r.dest_lat, r.dest_lng],
            "distance_km": round(r.distance_m / 1000, 1), "duration_h": round(r.duration_s / 3600, 2), "geometry": r.geometry, "source": r.source,
            "retrieved_at": r.retrieved_at.isoformat(timespec="minutes")}


@router.post("/routes", status_code=201)
def create_route(body: RouteIn, p: Principal = Depends(current_user), db: Session = Depends(get_db)):
    try:
        r = routing.route((body.origin_lat, body.origin_lng), (body.dest_lat, body.dest_lng))
    except routing.Unavailable as e:
        err(503, "route_unavailable", f"Route information unavailable: {e}")
    row = TransportationRoute(**body.model_dump(), distance_m=r["distance_m"], duration_s=r["duration_s"], geometry=r["geometry"], source=r["source"])
    db.add(row)
    db.commit()
    return route_dict(row)


@router.get("/routes")
def routes(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return {"routes": [route_dict(r) for r in db.scalars(select(TransportationRoute).order_by(TransportationRoute.id.desc())).all()]}
