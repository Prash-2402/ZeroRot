"""Domain services: connects the database to the one prediction/decision engine.
Every screen (twin, what-if, decision, planner, transport, ghost) goes through these functions."""
from __future__ import annotations

import math
from datetime import datetime, timedelta
from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import DEMO_EPOCH
from app.db.models import AppState, Batch, Facility, MarketPrice, Prediction, Reading, Trip
from app.engine import geo
from app.engine.conditions import Segment, WeatherStore, cached_weather
from app.engine.confidence import Reading as EReading
from app.engine.decay import State
from app.engine.decision import DecisionInput, decide
from app.engine.predict import PredictionInput, predict
from app.engine.registry import get_produce
from app.engine.value import comparable_series, price_scenarios

MANUAL_BIAS_HOURS = 48
_live_weather: WeatherStore | None = None
_price_cache: dict = {}


# ---------- app state ----------
def get_state(db: Session, key: str, default=None):
    row = db.get(AppState, key)
    return row.value if row else default


def set_state(db: Session, key: str, value):
    row = db.get(AppState, key)
    if row:
        row.value = value
    else:
        db.add(AppState(key=key, value=value))


def sim_now(db: Session) -> datetime:
    v = get_state(db, "sim_now")
    return datetime.fromisoformat(v["t"]) if v else DEMO_EPOCH


def mode(db: Session) -> str:
    return (get_state(db, "mode") or {"mode": "demo"})["mode"]


def market_condition(db: Session) -> dict:
    return get_state(db, "market_condition") or {"condition": "normal", "mandi_id": None}


# ---------- weather ----------
def set_live_weather(ws: WeatherStore | None):
    global _live_weather
    _live_weather = ws


def weather(db: Session | None = None) -> WeatherStore:
    if _live_weather is not None and db is not None and mode(db) == "real":
        return _live_weather
    return cached_weather()


def weather_point(batch_or_latlng) -> str:
    ws = cached_weather()
    if isinstance(batch_or_latlng, tuple):
        return ws.nearest(*batch_or_latlng)
    b = batch_or_latlng
    return b.district if b.district in ws.points else ws.nearest(b.lat, b.lng)


# ---------- facilities & prices ----------
def mandis(db: Session) -> list[dict]:
    return [fac_dict(f) for f in db.scalars(select(Facility).where(Facility.type == "mandi")).all()]


def storages(db: Session) -> list[dict]:
    return [fac_dict(f) for f in db.scalars(select(Facility).where(Facility.type == "cold_storage")).all()]


def fac_dict(f: Facility) -> dict:
    return {"id": f.id, "type": f.type, "name": f.name, "district": f.district, "lat": f.lat, "lng": f.lng,
            "accepts": f.accepts, "capacity_t": f.capacity_t, "used_t": f.used_t, "rent_per_kg_day": f.rent_per_kg_day, "origin": f.origin}


def clear_price_cache():
    _price_cache.clear()


def price_records(db: Session, commodity: str) -> list[dict]:
    if commodity not in _price_cache:
        rows = db.scalars(select(MarketPrice).where(MarketPrice.commodity == commodity)).all()
        _price_cache[commodity] = [{"commodity": r.commodity, "mandi_id": r.mandi_id, "variety": r.variety, "date": r.date.date(),
                                    "modal_price": r.modal_price, "unit": r.unit, "origin": r.origin, "source": r.source} for r in rows]
    return _price_cache[commodity]


def price_series(db: Session, commodity: str, mandi_id: str):
    recs = price_records(db, commodity)
    series = comparable_series(recs, commodity, mandi_id)
    meta = next((r for r in recs if r["mandi_id"] == mandi_id), None)
    return series, (meta["source"] if meta else ""), (meta["origin"] if meta else "none")


def scenario_for(db: Session, commodity: str, mandi_id: str, horizon: int = 30, condition: str | None = None):
    series, src, origin = price_series(db, commodity, mandi_id)
    if condition is None:
        mc = market_condition(db)
        condition = mc["condition"] if (mc.get("mandi_id") in (None, mandi_id)) else "normal"
    return price_scenarios(series, horizon, condition, src, origin) if series else None


def all_scenarios(db: Session, commodity: str, horizon: int = 30) -> dict:
    out = {}
    for m in mandis(db):
        s = scenario_for(db, commodity, m["id"], horizon)
        if s:
            out[m["id"]] = s
    return out


def local_mandi(origin) -> str:
    ms = geo.locations()["mandis"]
    return min(ms, key=lambda m: geo.travel(origin, m["id"])["km"])["id"]


def batch_origin(b: Batch):
    return b.district if b.district in geo.points() else (b.lat, b.lng)


# ---------- conditions plan ----------
def active_trip(db: Session, b: Batch) -> Trip | None:
    if b.status != "in_transit":
        return None
    return db.scalars(select(Trip).where(Trip.batch_id == b.id, Trip.status == "in_transit")).first()


def batch_segments(db: Session, b: Batch, now: datetime, trip: Trip | None = None) -> tuple[list[Segment], bool, str]:
    """Future conditions for a batch. Returns (segments, weather_based, sale_market_id)."""
    p = get_produce(b.produce)
    rh_mid = (p.v("rh_low") + p.v("rh_high")) / 2
    long = 40 * 24
    if b.status == "in_transit":
        trip = trip or active_trip(db, b)
    if trip is not None:
        remaining_h = max(1, round((trip.duration_s - trip.progress_s) / 3600))
        pt = weather_point((trip.lat or b.lat, trip.lng or b.lng))
        if trip.reefer and trip.reefer_status == "ok":
            seg = Segment("setpoint", remaining_h, t=p.v("t_ref"), rh=rh_mid)
            wb = False
        elif trip.reefer_status == "failed":
            seg = Segment("reefer_failed", remaining_h, point=pt, t0=trip.cargo_temp or p.v("t_ref"))
            wb = False
        else:
            seg = Segment("weather", remaining_h, point=pt)
            wb = True
        dest_point = trip.dest_id if trip.dest_id in cached_weather().points else pt
        if trip.dest_id.startswith("cs_"):
            after = Segment("setpoint", long, t=p.v("t_ref"), rh=rh_mid)
            sale = local_mandi(trip.dest_id)
        else:
            after = Segment("weather", long, point=dest_point)
            sale = trip.dest_id
        return [seg, after], wb, sale
    if b.status == "delivered" and b.facility_id and b.facility_id.startswith("m_"):
        pt = b.facility_id if b.facility_id in cached_weather().points else weather_point(b)
        return [Segment("weather", long, point=pt)], True, b.facility_id
    if b.storage_type in ("cold_storage", "reefer"):
        origin = b.facility_id if b.facility_id and b.facility_id in geo.points() else batch_origin(b)
        return [Segment("setpoint", long, t=p.v("t_ref"), rh=rh_mid)], False, local_mandi(origin)
    bias_t = bias_rh = 0.0
    if b.manual_bias_at and (now - b.manual_bias_at) <= timedelta(hours=MANUAL_BIAS_HOURS):
        bias_t, bias_rh = b.manual_bias_t, b.manual_bias_rh
    return [Segment("weather", long, point=weather_point(b), bias_t=bias_t, bias_rh=bias_rh)], True, local_mandi(batch_origin(b))


def readings_for(db: Session, b: Batch) -> list[EReading]:
    rows = db.scalars(select(Reading).where(Reading.batch_id == b.id).order_by(Reading.ts)).all()
    return [EReading(r.ts, r.temp_c, r.rh, "manual" if r.origin == "manual" else ("sensor" if r.origin == "sensor" else "simulated")) for r in rows]


def known_fields(b: Batch) -> dict:
    return {"maturity": b.maturity is not None, "initial_quality": b.initial_quality is not None,
            "variety": bool(b.variety), "harvest_time": b.harvest_time is not None}


def state_of(b: Batch) -> State:
    return State(q=b.q, w=b.w, r=b.r, e=b.e)


def prediction_input(db: Session, b: Batch, now: datetime | None = None, *, segments=None, market=None,
                     state: State | None = None, maturity=None, mass=None) -> PredictionInput:
    now = now or sim_now(db)
    segs, wb, sale = batch_segments(db, b, now)
    if segments is not None:
        segs = segments
        wb = any(s.kind == "weather" for s in segments[:1])
    sale = market or sale
    return PredictionInput(produce=b.produce, maturity=maturity if maturity is not None else b.maturity,
                           mass_kg=mass or b.quantity_kg, state=state or state_of(b), start=now, segments=segs,
                           price=scenario_for(db, b.produce, sale), harvest=b.harvest_time, readings=readings_for(db, b),
                           known=known_fields(b), weather_based=wb, seed_key=b.id)


def twin(db: Session, b: Batch, horizon_days: int = 14, store: bool = True):
    now = sim_now(db)
    inp = prediction_input(db, b, now)
    res = predict(inp, horizon_days=horizon_days)
    _, _, sale = batch_segments(db, b, now)
    res["sale_market"] = {"id": sale, "name": geo.points()[sale]["name"] if sale in geo.points() else sale}
    res["parameters_used"] = [{k: x[k] for k in ("id", "name", "value", "unit", "classification", "classification_label", "source", "derivation", "range")}
                              for x in get_produce(b.produce).used_params()]
    res["data_origins"] = sorted({r.origin for r in inp.readings} | ({"cached_weather"} if inp.weather_based else set()) | {"model_prediction"})
    if store:
        last = db.scalars(select(Prediction).where(Prediction.batch_id == b.id).order_by(Prediction.ts.desc())).first()
        if last is None or (now - last.ts) >= timedelta(hours=1):
            db.add(Prediction(batch_id=b.id, ts=now, quality=res["current"]["quality"], shelf_life_days=res["shelf_life"]["days"],
                              shelf_p10=res["shelf_life"]["p10_days"], shelf_p90=res["shelf_life"]["p90_days"],
                              value_inr=res["current"]["value"], confidence_score=res["confidence"]["score"],
                              confidence_category=res["confidence"]["category"], model_version=res["model_version"],
                              parameter_version=res["parameter_version"],
                              input_snapshot={"state": state_of(b).as_dict(), "maturity": b.maturity, "mass_kg": b.quantity_kg,
                                              "storage_type": b.storage_type, "status": b.status, "weather_based": inp.weather_based,
                                              "sale_market": sale},
                              data_origins=res["data_origins"], mode=mode(db)))
            db.commit()
    return res


def decision_for(db: Session, b: Batch, pred: dict | None = None, **over):
    now = sim_now(db)
    pred = pred or twin(db, b, store=False)
    origin = batch_origin(b)
    trip = active_trip(db, b)
    if trip is not None:
        origin = (trip.lat, trip.lng)
    sts = storages(db)
    inp = DecisionInput(produce=b.produce, maturity=over.get("maturity", b.maturity), mass_kg=over.get("mass_kg") or b.quantity_kg,
                        state=over.get("state") or state_of(b), start=now, origin=origin,
                        origin_weather_point=weather_point(b) if trip is None else weather_point((trip.lat, trip.lng)),
                        prices=all_scenarios(db, b.produce), mandis=mandis(db), storages=sts, confidence=pred["confidence"],
                        value_drop_48h_pct=pred.get("value_drop_48h_pct", 0), shelf_life_days=pred["shelf_life"]["days"],
                        transit_reefer=bool(over.get("transit_reefer", False)), transit_temp=over.get("transit_temp"),
                        storage_temp=over.get("storage_temp"), only_market=over.get("only_market"), sell_day=over.get("sell_day"),
                        hold_temp=over.get("hold_temp"), hold_rh=over.get("hold_rh"))
    if over.get("transit_hours_factor"):
        inp.speed_factor = over["transit_hours_factor"]
    return decide(inp, weather(db))


def fmt_batch(db: Session, b: Batch, trip: Trip | None = None) -> dict:
    p = get_produce(b.produce)
    trip = trip if trip is not None else active_trip(db, b)
    return {"id": b.id, "produce": b.produce, "produce_name": p.display_name, "produce_kn": p.kannada, "variety": b.variety,
            "quantity_kg": b.quantity_kg, "harvest_time": b.harvest_time.isoformat(timespec="minutes"), "maturity": b.maturity,
            "initial_quality": b.initial_quality, "district": b.district,
            "district_name": geo.points().get(b.district, {}).get("name", b.district.title()), "lat": b.lat, "lng": b.lng,
            "storage_type": b.storage_type, "facility_id": b.facility_id,
            "facility_name": geo.points().get(b.facility_id, {}).get("name") if b.facility_id else None,
            "status": b.status, "quality": round(b.q, 1), "weight_loss_pct": round(b.w * 100, 2), "rejected_pct": round(b.r * 100, 2),
            "risk": b.risk, "shelf_life_days": b.shelf_life_days, "value_inr": b.value_inr, "farmer_id": b.farmer_id,
            "trip_id": trip.id if trip else None, "is_judge": b.is_judge, "origin": b.origin, "mode": b.mode,
            "passport_token": b.passport_token, "state_at": b.state_at.isoformat(timespec="minutes")}


def iso(dt: datetime | None):
    return dt.isoformat(timespec="minutes") if dt else None


def safe(x):
    if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
        return None
    return x
