"""PREDICT + DECIDE endpoints: batches, digital twin, what-if, Sell/Store/Ship, Market Shift Planner."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import domain
from app.db.models import (Batch, Decision, Farmer, ImpactEvent, MarketShiftPlan, Notification, Prediction, Reading,
                           StorageRecord, Trip)
from app.db.session import get_db
from app.engine import geo
from app.engine.conditions import Segment, build_series
from app.engine.decay import make_params, simulate, State
from app.engine.market_shift import choice_difference, plan_market_shift
from app.engine.predict import predict
from app.engine.registry import get_produce
from app.engine.validation import validate_batch
from app.engine.value import MARKET_CONDITIONS
from app.notify import notification_dict
from app.simulation.loop import world_lock

router = APIRouter()
CODE = {"tomato": "TOM", "mango": "MAN", "banana": "BAN"}
DEFAULT_Q0 = 95.0


def err(status: int, code: str, message: str, **extra):
    raise HTTPException(status, detail={"error": code, "message": message, **extra})


def get_batch(db: Session, batch_id: str) -> Batch:
    b = db.get(Batch, batch_id)
    if b is None:
        err(404, "not_found", f"Batch {batch_id} not found")
    return b


class BatchCreate(BaseModel):
    produce: str
    variety: str | None = None
    quantity_kg: float
    harvest_time: datetime | None = None
    harvest_hours_ago: float | None = Field(None, ge=0, le=720)
    maturity: str | None = None
    initial_quality: float | None = None
    district: str = "kolar"
    storage_type: str = "open_shed"
    facility_id: str | None = None
    farmer_name: str | None = None
    farmer_id: str | None = None
    is_judge: bool = False


class BatchPatch(BaseModel):
    quantity_kg: float | None = None
    maturity: str | None = None
    variety: str | None = None
    storage_type: str | None = None
    facility_id: str | None = None


class ReadingIn(BaseModel):
    temperature: float = Field(..., ge=-10, le=60)
    humidity: float | None = Field(None, ge=0, le=100)
    ts: datetime | None = None
    origin: str = "manual"


def next_batch_id(db: Session, produce: str) -> str:
    prefix = f"ZR-{CODE[produce]}-"
    ids = [r for (r,) in db.execute(select(Batch.id).where(Batch.id.like(prefix + "%"))).all()]
    nums = [int(x.split("-")[-1]) for x in ids if x.split("-")[-1].isdigit()]
    return f"{prefix}{max([200] + nums) + 1:03d}"


def create_batch(db: Session, body: BatchCreate) -> Batch:
    now = domain.sim_now(db)
    if body.harvest_time is not None:
        harvest = body.harvest_time
    else:
        harvest = now - timedelta(hours=body.harvest_hours_ago if body.harvest_hours_ago is not None else 6)
    errors = validate_batch(produce=body.produce, quantity_kg=body.quantity_kg, harvest_time=harvest, now=now, maturity=body.maturity,
                            initial_quality=body.initial_quality, storage_type=body.storage_type)
    pts = geo.points()
    if body.district not in pts:
        errors.append(f"Unknown district '{body.district}'")
    if body.storage_type == "cold_storage":
        fac = body.facility_id or next((s["id"] for s in domain.storages(db) if body.produce in s["accepts"]), None)
        st = next((s for s in domain.storages(db) if s["id"] == fac), None)
        if st is None:
            errors.append("Choose a cold storage facility")
        elif body.produce not in st["accepts"]:
            errors.append(f"{st['name']} does not accept {body.produce}")
    else:
        fac = None
    if errors:
        err(422, "invalid_input", "; ".join(errors), errors=errors)
    p = get_produce(body.produce)
    q0 = body.initial_quality if body.initial_quality is not None else DEFAULT_Q0
    hours = max(0, round((now - harvest).total_seconds() / 3600))
    rh_mid = (p.v("rh_low") + p.v("rh_high")) / 2
    segs = [Segment("setpoint", hours, t=p.v("t_ref"), rh=rh_mid)] if body.storage_type == "cold_storage" else [Segment("weather", hours, point=body.district)]
    state = State(q=q0)
    if hours > 0:
        T, RH = build_series(segs, harvest, domain.weather(db))
        Q, W, R, E = simulate(make_params(p, body.maturity), state, T, RH)
        state = State(q=float(Q[0, -1]), w=float(W[0, -1]), r=float(R[0, -1]), e=float(E[0, -1]))
    farmer_id = body.farmer_id
    if not farmer_id:
        farmer_id = "JUDGE" if body.is_judge else None
        if body.farmer_name and not body.is_judge:
            farmer_id = f"U{secrets.token_hex(3).upper()}"
            db.add(Farmer(id=farmer_id, name=body.farmer_name, district=body.district, origin="manual"))
    bid = next_batch_id(db, body.produce)
    d = pts[body.district]
    b = Batch(id=bid, farmer_id=farmer_id, produce=body.produce, variety=body.variety, quantity_kg=body.quantity_kg, harvest_time=harvest,
              maturity=body.maturity, initial_quality=body.initial_quality, district=body.district, lat=d["lat"], lng=d["lng"],
              storage_type=body.storage_type, facility_id=fac, status="stored", q=state.q, w=state.w, r=state.r, e=state.e, state_at=now,
              passport_token=secrets.token_urlsafe(12), is_judge=body.is_judge, origin="manual", mode=domain.mode(db))
    db.add(b)
    label = pts[fac]["name"] if fac else f"Farm shed, {d['name']} (conditions estimated from regional weather)"
    db.add(StorageRecord(batch_id=bid, facility_id=fac, storage_type=body.storage_type, label=label, start=harvest, origin="manual"))
    db.add(ImpactEvent(ts=now, kind="batch_monitored", batch_id=bid, produce=body.produce, district=body.district, kg=body.quantity_kg, origin="manual"))
    db.commit()
    return b


@router.get("/batches")
def list_batches(status: str | None = None, db: Session = Depends(get_db)):
    q = select(Batch).order_by(Batch.created_at.desc())
    if status:
        q = q.where(Batch.status == status)
    farmers = {f.id: f.name for f in db.scalars(select(Farmer)).all()}
    trips = {t.batch_id: t for t in db.scalars(select(Trip).where(Trip.status == "in_transit")).all()}
    out = []
    for b in db.scalars(q).all():
        d = domain.fmt_batch(db, b, trips.get(b.id))
        d["farmer_name"] = farmers.get(b.farmer_id)
        out.append(d)
    order = {"manual": 0, "simulated": 1}
    out.sort(key=lambda x: (order.get(x["origin"], 2), x["id"]))
    return {"batches": out, "sim_now": domain.iso(domain.sim_now(db))}


@router.post("/batches", status_code=201)
def post_batch(body: BatchCreate, db: Session = Depends(get_db)):
    with world_lock:
        b = create_batch(db, body)
    return domain.fmt_batch(db, b)


@router.get("/batches/{batch_id}")
def get_one(batch_id: str, db: Session = Depends(get_db)):
    b = get_batch(db, batch_id)
    d = domain.fmt_batch(db, b)
    f = db.get(Farmer, b.farmer_id) if b.farmer_id else None
    d["farmer_name"] = f.name if f else None
    return d


@router.patch("/batches/{batch_id}")
def patch_batch(batch_id: str, body: BatchPatch, db: Session = Depends(get_db)):
    with world_lock:
        b = get_batch(db, batch_id)
        errors = validate_batch(produce=b.produce, quantity_kg=body.quantity_kg or b.quantity_kg, harvest_time=b.harvest_time,
                                now=domain.sim_now(db), maturity=body.maturity, storage_type=body.storage_type)
        if errors:
            err(422, "invalid_input", "; ".join(errors), errors=errors)
        for k, v in body.model_dump(exclude_none=True).items():
            setattr(b, k, v)
        db.commit()
    return domain.fmt_batch(db, b)


@router.post("/batches/{batch_id}/readings")
def add_reading(batch_id: str, body: ReadingIn, db: Session = Depends(get_db)):
    """Measured reading (manual or future sensor). For open sheds it bias-corrects the regional weather estimate."""
    with world_lock:
        b = get_batch(db, batch_id)
        now = domain.sim_now(db)
        ts = body.ts or now
        if ts > now or ts < b.harvest_time:
            err(422, "invalid_input", "Reading time must be between harvest and now")
        origin = body.origin if body.origin in ("manual", "sensor") else "manual"
        db.add(Reading(batch_id=b.id, ts=ts, temp_c=body.temperature, rh=body.humidity, origin=origin))
        if b.storage_type == "open_shed" and b.status == "stored":
            wt, wrh, _ = domain.weather(db).at(domain.weather_point(b), ts)
            b.manual_bias_t = body.temperature - wt
            b.manual_bias_rh = (body.humidity - wrh) if body.humidity is not None else 0.0
            b.manual_bias_at = ts
        db.commit()
    return domain.twin(db, b)


@router.get("/batches/{batch_id}/twin")
def get_twin(batch_id: str, horizon_days: int = 14, db: Session = Depends(get_db)):
    if not 1 <= horizon_days <= 30:
        err(422, "invalid_input", "horizon_days must be 1-30")
    b = get_batch(db, batch_id)
    res = domain.twin(db, b, horizon_days)
    res["batch"] = domain.fmt_batch(db, b)
    return res


@router.get("/batches/{batch_id}/history")
def history(batch_id: str, db: Session = Depends(get_db)):
    b = get_batch(db, batch_id)
    rd = db.scalars(select(Reading).where(Reading.batch_id == b.id).order_by(Reading.ts)).all()
    step = max(1, len(rd) // 300)
    preds = db.scalars(select(Prediction).where(Prediction.batch_id == b.id).order_by(Prediction.ts)).all()
    recs = db.scalars(select(StorageRecord).where(StorageRecord.batch_id == b.id).order_by(StorageRecord.start)).all()
    notes = db.scalars(select(Notification).where(Notification.batch_id == b.id).order_by(Notification.ts.desc()).limit(30)).all()
    decs = db.scalars(select(Decision).where(Decision.batch_id == b.id).order_by(Decision.ts.desc()).limit(10)).all()
    return {"readings": [{"ts": domain.iso(r.ts), "temp_c": r.temp_c, "rh": r.rh, "origin": r.origin} for r in rd[::step]],
            "n_readings": len(rd),
            "predictions": [{"ts": domain.iso(p.ts), "quality": p.quality, "shelf_life_days": p.shelf_life_days, "p10": p.shelf_p10, "p90": p.shelf_p90,
                             "value": p.value_inr, "confidence": p.confidence_category, "score": p.confidence_score, "model_version": p.model_version,
                             "parameter_version": p.parameter_version, "origins": p.data_origins, "mode": p.mode} for p in preds],
            "storage": [{"type": s.storage_type, "label": s.label, "start": domain.iso(s.start), "end": domain.iso(s.end)} for s in recs],
            "notifications": [notification_dict(n) for n in notes],
            "decisions": [{"ts": domain.iso(d.ts), "action": d.action, "explanation": d.explanation, "farmer_choice": d.farmer_choice} for d in decs]}


# ---------------- what-if ----------------
class WhatIf(BaseModel):
    batch_id: str
    temperature: float | None = Field(None, ge=-5, le=50)
    humidity: float | None = Field(None, ge=5, le=100)
    storage_days: float | None = Field(None, ge=0, le=30)
    transport_hours: float | None = Field(None, ge=0, le=72)
    transport_temp: float | None = Field(None, ge=-5, le=50)
    maturity: str | None = None
    initial_quality: float | None = Field(None, ge=0, le=100)
    quantity_kg: float | None = Field(None, gt=0, le=100000)
    destination_market: str | None = None
    sell_day: float | None = Field(None, ge=0, le=14)
    request_id: int | None = None


def summary(pred: dict, dec: dict, sell_day: float | None):
    at_h = int(round((sell_day if sell_day is not None else 3) * 24 / 6)) * 6
    pt = next((x for x in pred["trajectory"] if x["hour"] >= at_h), pred["trajectory"][-1])
    rec = dec.get("recommended") or {}
    return {"quality_now": pred["current"]["quality"], "quality_at": pt["quality"], "at_day": pt["day"],
            "shelf_life_days": pred["shelf_life"]["days"], "shelf_p10": pred["shelf_life"]["p10_days"], "shelf_p90": pred["shelf_life"]["p90_days"],
            "beyond_horizon": pred["shelf_life"]["beyond_horizon"], "value_now": pred["current"]["value"], "value_at": pt.get("value"),
            "saleable_kg": pt["saleable_kg"], "net_profit": rec.get("net"), "action": dec.get("action"), "action_label": rec.get("label"),
            "explanation": dec.get("explanation") or dec.get("message"), "confidence": pred["confidence"]["text"],
            "confidence_category": pred["confidence"]["category"]}


@router.post("/simulations/recalculate")
def recalculate(body: WhatIf, db: Session = Depends(get_db)):
    """What-if: runs the SAME decay, value and decision engines with overridden inputs. Never modifies batch history."""
    b = get_batch(db, body.batch_id)
    if body.maturity and body.maturity not in ("mature_green", "turning", "ripe"):
        err(422, "invalid_input", "Unknown maturity")
    if body.destination_market and body.destination_market not in geo.points():
        err(422, "invalid_input", "Unknown destination market")
    now = domain.sim_now(db)
    base_pred = domain.twin(db, b, store=False)
    base_dec = domain.decision_for(db, b, base_pred)
    segs = None
    p = get_produce(b.produce)
    if any(v is not None for v in (body.temperature, body.humidity, body.storage_days, body.transport_hours, body.transport_temp)):
        base_segs, _, sale = domain.batch_segments(db, b, now)
        T0, RH0 = build_series(base_segs, now, domain.weather(db))
        t = body.temperature if body.temperature is not None else float(T0[:24].mean())
        rh = body.humidity if body.humidity is not None else float(RH0[:24].mean())
        sd = body.storage_days if body.storage_days is not None else 40
        segs = [Segment("constant", round(sd * 24), t=t, rh=rh)]
        if body.transport_hours:
            tt = body.transport_temp if body.transport_temp is not None else t
            segs.append(Segment("constant", round(body.transport_hours), t=tt, rh=min(100, rh)))
        dest = body.destination_market or sale
        segs.append(Segment("weather", 40 * 24, point=dest if dest in domain.cached_weather().points else domain.weather_point(b)))
    state = State(q=body.initial_quality, w=b.w, r=b.r, e=b.e) if body.initial_quality is not None else None
    inp = domain.prediction_input(db, b, now, segments=segs, market=body.destination_market, state=state,
                                  maturity=body.maturity, mass=body.quantity_kg)
    if segs is not None and body.temperature is not None:
        inp.weather_based = False
    pred = predict(inp, horizon_days=14)
    dec = domain.decision_for(db, b, pred, maturity=body.maturity or b.maturity, mass_kg=body.quantity_kg, state=state,
                              transit_temp=body.transport_temp, storage_temp=body.temperature if body.temperature is not None else None,
                              only_market=body.destination_market, sell_day=body.sell_day,
                              hold_temp=body.temperature, hold_rh=body.humidity)
    return {"request_id": body.request_id, "computed_at": domain.iso(now), "engine": "Same decay, value and decision engines as the twin",
            "baseline": summary(base_pred, base_dec, body.sell_day), "whatif": summary(pred, dec, body.sell_day),
            "whatif_trajectory": pred["trajectory"], "baseline_trajectory": base_pred["trajectory"],
            "whatif_decision": dec, "inputs": body.model_dump(exclude_none=True)}


# ---------------- decide ----------------
@router.get("/decide/{batch_id}")
def get_decision(batch_id: str, db: Session = Depends(get_db)):
    b = get_batch(db, batch_id)
    pred = domain.twin(db, b, store=False)
    dec = domain.decision_for(db, b, pred)
    row = Decision(batch_id=b.id, ts=domain.sim_now(db), action=dec["action"], explanation=dec.get("explanation") or dec.get("message"),
                   recommended=dec.get("recommended"), alternatives=dec.get("alternatives", []), rejected=dec.get("rejected", []), mode=domain.mode(db))
    db.add(row)
    db.commit()
    dec["decision_id"] = row.id
    dec["prediction"] = {"quality": pred["current"]["quality"], "shelf_life": pred["shelf_life"], "value": pred["current"]["value"],
                         "confidence": pred["confidence"], "conditions": pred["conditions"], "price": pred["price"]}
    dec["batch"] = domain.fmt_batch(db, b)
    return dec


def _storage_segments(db, b: Batch):
    p = get_produce(b.produce)
    rh_mid = (p.v("rh_low") + p.v("rh_high")) / 2
    cold = b.storage_type in ("cold_storage", "reefer") and b.status == "stored"
    now = domain.sim_now(db)

    def segs(hours, rh_shift):
        if cold:
            return [Segment("setpoint", hours, t=p.v("t_ref"), rh=rh_mid)]
        base, _, _ = domain.batch_segments(db, b, now)
        s = base[0]
        return [Segment("weather", hours, point=s.point or domain.weather_point(b), bias_t=s.bias_t, bias_rh=s.bias_rh + rh_shift)]
    rent = 0.0
    if cold and b.facility_id:
        st = next((x for x in domain.storages(db) if x["id"] == b.facility_id), None)
        rent = st["rent_per_kg_day"] if st else 0.45
    return segs, rent


@router.get("/decide/{batch_id}/market-shift")
def market_shift(batch_id: str, condition: str | None = None, db: Session = Depends(get_db)):
    b = get_batch(db, batch_id)
    mc = domain.market_condition(db)
    origin = b.facility_id if (b.facility_id and b.facility_id in geo.points()) else domain.batch_origin(b)
    market_id = domain.local_mandi(origin)
    cond = condition or (mc["condition"] if mc.get("mandi_id") in (None, market_id) else "normal")
    if cond not in MARKET_CONDITIONS:
        err(422, "invalid_input", f"condition must be one of {', '.join(MARKET_CONDITIONS)}")
    series, src, origin_label = domain.price_series(db, b.produce, market_id)
    if not series:
        err(409, "insufficient_data", "INSUFFICIENT DATA FOR A RELIABLE RECOMMENDATION.")
    segs, rent = _storage_segments(db, b)
    market = next(m for m in domain.mandis(db) if m["id"] == market_id)
    plan = plan_market_shift(produce=b.produce, maturity=b.maturity, mass_kg=b.quantity_kg, state=domain.state_of(b), start=domain.sim_now(db),
                             storage_segments=segs, rent_per_kg_day=rent, origin=origin, origin_weather_point=domain.weather_point(b),
                             market=market, series=series, condition=cond, weather=domain.weather(db), price_source=src, price_origin=origin_label)
    row = MarketShiftPlan(batch_id=b.id, ts=domain.sim_now(db), condition=cond, periods=plan["periods"], recommended=plan["recommended"], mode=domain.mode(db))
    db.add(row)
    db.commit()
    plan["plan_id"] = row.id
    plan["storage"] = {"type": b.storage_type, "rent_per_kg_day": rent, "label": "Cold storage" if rent else "Current storage (open shed, regional weather estimate)"}
    plan["batch"] = domain.fmt_batch(db, b)
    plan["shift_detected"] = cond != "normal"
    return plan


class Choice(BaseModel):
    kind: str = "market_shift"  # market_shift | decision
    plan_id: int | None = None
    decision_id: int | None = None
    chosen_key: str


@router.post("/decide/{batch_id}/choice")
def record_choice(batch_id: str, body: Choice, db: Session = Depends(get_db)):
    """The farmer can pick any option. A non-recommended choice is recorded with its rupee difference, never blocked."""
    b = get_batch(db, batch_id)
    if body.kind == "market_shift":
        row = db.get(MarketShiftPlan, body.plan_id) if body.plan_id else None
        if row is None or row.batch_id != b.id:
            err(404, "not_found", "Plan not found")
        if body.chosen_key not in [p["key"] for p in row.periods]:
            err(422, "invalid_input", "Unknown period")
        res = choice_difference({"periods": row.periods}, body.chosen_key)
        row.chosen, row.difference = body.chosen_key, res["difference"]
        db.commit()
        return res
    row = db.get(Decision, body.decision_id) if body.decision_id else None
    if row is None or row.batch_id != b.id:
        err(404, "not_found", "Decision not found")
    alt = next((a for a in row.alternatives if a["key"] == body.chosen_key), None)
    if alt is None:
        err(422, "invalid_input", "Option is not feasible")
    best = row.recommended["net"] if row.recommended else alt["net"]
    diff = alt["net"] - best
    row.farmer_choice, row.choice_difference = body.chosen_key, diff
    db.commit()
    from app.engine.format import inr
    msg = "You chose the recommended option." if body.chosen_key == (row.recommended or {}).get("key") else f"{inr(abs(diff))} {'less' if diff < 0 else 'more'} than recommended, your call."
    return {"chosen": body.chosen_key, "difference": diff, "message": msg}
