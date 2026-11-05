"""Farmer-centric endpoints: one call returns the farm (shed, cold store, mandi truck) with the three answers
(quality, days left, value) and one recommended action per batch. Same engine as every other screen."""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import domain
from app.db.models import Batch, Farmer, GhostComparison, StorageRecord, Trip
from app.db.session import SessionLocal, get_db
from app.engine import geo
from app.engine.registry import get_produce
from app.simulation.loop import truck_payload, world_lock
from app.simulation.transport import lane_route
from app.workflows import rescue
from app.ws.hub import hub

router = APIRouter()
MANDI_TRUCK = "Mandi company reefer truck (demo)"
HANDOVER_DEST = "m_hubballi"
_cache: dict = {"t": 0.0, "key": None, "data": None}


def err(status, code, message):
    raise HTTPException(status, detail={"error": code, "message": message})


def photo_stage(q: float) -> str:
    return "fresh" if q >= 75 else "aging" if q >= 55 else "spoiling"


def place_of(b: Batch) -> str:
    if b.status == "in_transit" or b.lane_id == "S2":
        return "truck"
    if b.storage_type == "cold_storage":
        return "cold"
    return "shed"


def card(db: Session, b: Batch) -> dict:
    p = get_produce(b.produce)
    tw = domain.twin(db, b, horizon_days=14)
    dec = domain.decision_for(db, b, tw)
    rec = dec.get("recommended") or {}
    traj = tw["trajectory"]
    return {
        "id": b.id, "produce": b.produce, "produce_name": p.display_name, "produce_kn": p.kannada, "variety": b.variety,
        "quantity_kg": b.quantity_kg, "status": b.status, "place": place_of(b),
        "quality": tw["current"]["quality"], "category": tw["current"]["category"], "photo_stage": photo_stage(tw["current"]["quality"]),
        "days_left": tw["shelf_life"]["days"], "days_p10": tw["shelf_life"]["p10_days"], "days_p90": tw["shelf_life"]["p90_days"],
        "beyond_horizon": tw["shelf_life"]["beyond_horizon"], "risk": tw["shelf_life"]["risk"],
        "value_now": tw["current"]["value"], "price_per_kg": tw["current"]["price_per_kg"], "value_drop_48h_pct": tw["value_drop_48h_pct"],
        "weather_based": tw["conditions"]["weather_based"], "confidence": {k: tw["confidence"][k] for k in ("score", "category", "reasons", "label")},
        "future": [{"day": x["day"], "quality": x["quality"], "value": x.get("value"), "days_left": x["shelf_life_days"],
                    "photo_stage": photo_stage(x["quality"])} for x in traj],
        "action": {"kind": dec["action"], "key": rec.get("key"), "label": rec.get("label"), "market_id": rec.get("market_id"),
                   "market_name": rec.get("market_name"), "net": rec.get("net"), "quality_at_sale": rec.get("quality_at_sale"),
                   "sale_day": rec.get("sale_day"), "storage_name": (rec.get("meta") or {}).get("storage_name"),
                   "store_days": (rec.get("meta") or {}).get("days"), "urgent": dec.get("urgent", False),
                   "explanation": dec.get("explanation") or dec.get("message"), "depends_on_market": dec.get("depends_on_market", False)},
        "origin": b.origin,
    }


def truck_state(db: Session, b: Batch | None) -> dict:
    if b is None:
        return {"state": "empty"}
    trip = db.scalars(select(Trip).where(Trip.batch_id == b.id).order_by(Trip.created_at.desc())).first()
    if trip is None:
        return {"state": "parked", "operator": MANDI_TRUCK, "dest_name": geo.points()[HANDOVER_DEST]["name"]}
    g = db.scalars(select(GhostComparison).where(GhostComparison.trip_id == trip.id).order_by(GhostComparison.id.desc())).first()
    return {"state": "on_road" if trip.status == "in_transit" else "arrived", "operator": MANDI_TRUCK, "trip_id": trip.id,
            "truck": truck_payload(trip, b), "dest_name": trip.dest_name, "origin_name": "Kolar farm", "reefer_status": trip.reefer_status,
            "cargo_temp": trip.cargo_temp, "progress": round(trip.progress_s / trip.duration_s, 3) if trip.duration_s else 1,
            "distance_km": round(trip.distance_m / 1000), "duration_h": round(trip.duration_s / 3600, 1),
            "pending_reroute": trip.pending_reroute, "rerouted": trip.rerouted,
            "ghost": rescue.ghost_dict(g) if g else None}


@router.get("/farm")
def farm(fresh: bool = False, db: Session = Depends(get_db)):
    now = domain.sim_now(db)
    key = (now.isoformat(timespec="minutes"), db.query(Trip).count(), db.query(GhostComparison).count(), db.query(Batch).count(),
           str(domain.market_condition(db)))
    if not fresh and _cache["key"] == key and time.time() - _cache["t"] < 8:
        return _cache["data"]
    batches = db.scalars(select(Batch).where(Batch.status.in_(("stored", "in_transit", "delivered")))).all()
    farmer = db.get(Farmer, "F01")
    cards = [card(db, b) for b in batches]
    by_place = {}
    for c in cards:
        by_place.setdefault(c["place"], []).append(c)
    truck_batch = next((b for b in batches if place_of(b) == "truck"), None)
    data = {"sim_now": domain.iso(now), "mode": domain.mode(db),
            "farmer": {"name": farmer.name if farmer else "Farmer", "district": "Kolar", "district_kn": "ಕೋಲಾರ"},
            "places": {"shed": by_place.get("shed", []), "cold": by_place.get("cold", []), "truck": by_place.get("truck", [])},
            "cold_store": {"id": "cs_malur", "name": geo.points()["cs_malur"]["name"]},
            "truck": truck_state(db, truck_batch), "market_condition": domain.market_condition(db),
            "labels": {"prices": "Mandi prices are SIMULATED until a data.gov.in key is configured.",
                       "feed": "Truck and cold-store temperatures are a SIMULATED feed.",
                       "photos": "Photos show the freshness stage, not the actual batch."}}
    _cache.update({"t": time.time(), "key": key, "data": data})
    return data


def handover(db: Session, batch_id: str) -> Trip:
    """Farmer hands the batch to the mandi company's reefer truck; the truck leaves for the mandi."""
    b = db.get(Batch, batch_id)
    if b is None:
        err(404, "not_found", "batch not found")
    if b.status == "in_transit":
        err(409, "conflict", "already on the truck")
    coords, dist_m, dur_s, src = lane_route("kolar", HANDOVER_DEST)
    now = domain.sim_now(db)
    old = db.get(Trip, "TRIP-S2")
    if old is not None:
        db.delete(old)
        db.flush()
    t = Trip(id="TRIP-S2", batch_id=b.id, lane_id="S2", origin_id="kolar", dest_id=HANDOVER_DEST, dest_name=geo.points()[HANDOVER_DEST]["name"],
             route=coords, route_source=src, distance_m=dist_m, duration_s=dur_s, progress_s=0, reefer=True, reefer_status="ok",
             cargo_temp=get_produce(b.produce).v("t_ref"), lat=coords[0][1], lng=coords[0][0], started_at=now, is_scenario=True, loop=False,
             origin="simulated")
    db.add(t)
    b.status, b.storage_type, b.lane_id = "in_transit", "reefer", "S2"
    db.add(StorageRecord(batch_id=b.id, storage_type="reefer", label=f"{MANDI_TRUCK} to {t.dest_name}", start=now))
    db.commit()
    _cache["key"] = None
    return t


@router.post("/farm/handover/{batch_id}")
def post_handover(batch_id: str):
    with world_lock:
        with SessionLocal() as db:
            t = handover(db, batch_id)
            b = db.get(Batch, batch_id)
            out = rescue.trip_dict(t, b)
    hub.publish({"type": "trip.update", "data": {"trip": out}})
    return out
