"""Simulation loop: one asyncio task, one tick per SIM_TICK_SECONDS.

Each tick advances the simulated clock, moves trucks along cached road routes, generates the SIMULATED
cold-chain feed (setpoint + noise + injected faults), integrates the same decay engine for every active
batch, checks thresholds and broadcasts updates over WebSocket."""
from __future__ import annotations

import asyncio
import logging
import math
import threading
from datetime import datetime, timedelta

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import Batch, GhostComparison, Reading, StorageRecord, Trip
from app.db.session import SessionLocal
from app import domain
from app.engine.conditions import REEFER_TAU_H, build_series
from app.engine.decay import crossing_hours, make_params, quality_category, simulate, step
from app.engine.registry import get_produce
from app.engine.value import batch_value, price_at
from app.notify import notify
from app.simulation.transport import position
from app.ws.hub import hub

log = logging.getLogger("zerorot.sim")
world_lock = threading.RLock()
READING_MINUTES = 15
STATUS_EVERY = 8
_params_cache: dict = {}
_alerted: set = set()
_stats: dict = {}
_rng = np.random.default_rng(7)
ACTIVE = ("stored", "in_transit", "delivered")


def reset_runtime():
    _alerted.clear()
    _stats.clear()
    global _rng
    _rng = np.random.default_rng(7)


def central(produce: str, maturity: str | None):
    key = (produce, maturity)
    if key not in _params_cache:
        _params_cache[key] = make_params(get_produce(produce), maturity)
    return _params_cache[key]


def risk_of(q: float, shelf_days: float | None) -> str:
    r = "healthy"
    if shelf_days is not None and shelf_days <= 5 or q < 55:
        r = "warning"
    if shelf_days is not None and shelf_days <= 2 or q < 40:
        r = "critical"
    return r


def refresh_status(db: Session):
    """Recompute shelf life, risk and value for every active batch with the decay engine (10-day look-ahead)."""
    now = domain.sim_now(db)
    ws = domain.weather(db)
    batches = db.scalars(select(Batch).where(Batch.status.in_(ACTIVE))).all()
    trips = {t.batch_id: t for t in db.scalars(select(Trip).where(Trip.status == "in_transit")).all()}
    counts = {"healthy": 0, "warning": 0, "critical": 0}
    value_total = value_at_risk = kg = 0.0
    for b in batches:
        segs, _, sale = domain.batch_segments(db, b, now, trips.get(b.id))
        T, RH = build_series(segs, now, ws)
        T, RH = T[: 240], RH[: 240]
        prm = central(b.produce, b.maturity)
        Q, W, R, E = simulate(prm, domain.state_of(b), T, RH)
        sl = crossing_hours(Q, prm.q_min)[0]
        b.shelf_life_days = None if math.isnan(sl) else round(float(sl) / 24, 2)
        b.risk = risk_of(b.q, b.shelf_life_days if b.shelf_life_days is not None else 99)
        scen = domain.scenario_for(db, b.produce, sale, horizon=10)
        b.value_inr = round(float(batch_value(b.quantity_kg, b.w, b.r, price_at(scen, "base", 0), b.q))) if scen else None
        counts[b.risk] += 1
        value_total += b.value_inr or 0
        kg += b.quantity_kg
        if b.risk != "healthy":
            value_at_risk += b.value_inr or 0
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    protected = db.scalar(select(func.coalesce(func.sum(GhostComparison.value_protected), 0.0))
                          .where(GhostComparison.value_protected > 0, GhostComparison.ts >= today)) or 0.0
    _stats.update({"active_batches": len(batches), "tonnes_monitored": round(kg / 1000, 1), "value_monitored": round(value_total),
                   "value_at_risk": round(value_at_risk), "value_protected_today": round(protected), **counts,
                   "sim_now": now.isoformat(timespec="minutes")})
    return _stats


def stats(db: Session | None = None) -> dict:
    if not _stats and db is not None:
        refresh_status(db)
    return dict(_stats)


def truck_payload(t: Trip, b: Batch) -> dict:
    frac = t.progress_s / t.duration_s if t.duration_s else 1.0
    out = {"id": t.id, "batch_id": t.batch_id, "produce": b.produce, "lat": t.lat, "lng": t.lng, "frac": round(frac, 4),
           "progress_s": round(t.progress_s), "duration_s": round(t.duration_s), "quality": round(b.q, 1), "risk": b.risk,
           "reefer": t.reefer, "reefer_status": t.reefer_status, "cargo_temp": None if t.cargo_temp is None else round(t.cargo_temp, 1),
           "dest_name": t.dest_name, "rerouted": t.rerouted, "is_scenario": t.is_scenario, "is_judge": b.is_judge,
           "pending_reroute": t.pending_reroute is not None, "ghost": None}
    if t.ghost_route and t.ghost_duration_s:
        gf = min(1.0, (t.ghost_progress_s or 0) / t.ghost_duration_s)
        glng, glat, _ = position(t.ghost_route, gf)
        out["ghost"] = {"lat": glat, "lng": glng, "frac": round(gf, 4)}
    return out


def _ambient(ws, lat, lng, now):
    pt = ws.nearest(lat, lng)
    t, rh, _ = ws.at(pt, now)
    return t, rh


def tick(db: Session) -> dict:
    speed = domain.get_state(db, "sim_speed") or {"minutes_per_tick": settings.sim_minutes_per_tick, "paused": False}
    if speed.get("paused"):
        return {}
    dt_min = float(speed["minutes_per_tick"])
    dt_h = dt_min / 60.0
    prev = domain.sim_now(db)
    now = prev + timedelta(minutes=dt_min)
    domain.set_state(db, "sim_now", {"t": now.isoformat()})
    ws = domain.weather(db)
    write_reading = (now.minute // READING_MINUTES) != (prev.minute // READING_MINUTES) or dt_min >= READING_MINUTES
    readings = []
    trips = db.scalars(select(Trip).where(Trip.status == "in_transit")).all()
    trip_by_batch = {t.batch_id: t for t in trips}
    batches = {b.id: b for b in db.scalars(select(Batch).where(Batch.status.in_(ACTIVE))).all()}
    arrived = []

    # ---- trucks and cargo conditions ----
    for t in trips:
        b = batches.get(t.batch_id)
        if b is None:
            continue
        p = get_produce(b.produce)
        t.progress_s = min(t.duration_s, t.progress_s + dt_min * 60)
        if t.ghost_route and t.ghost_duration_s:
            t.ghost_progress_s = min(t.ghost_duration_s, (t.ghost_progress_s or 0) + dt_min * 60)
        lng, lat, _ = position(t.route, t.progress_s / t.duration_s if t.duration_s else 1.0)
        t.lat, t.lng = lat, lng
        amb_t, amb_rh = _ambient(ws, lat, lng, now)
        rh_mid = (p.v("rh_low") + p.v("rh_high")) / 2
        if t.reefer and t.reefer_status == "ok":
            t.cargo_temp = p.v("t_ref") + float(_rng.normal(0, 0.3))
            t.cargo_rh = rh_mid + float(_rng.normal(0, 1.0))
        elif t.reefer_status == "failed":
            target = amb_t + 2.0
            cur = t.cargo_temp if t.cargo_temp is not None else p.v("t_ref")
            t.cargo_temp = target + (cur - target) * math.exp(-dt_h / REEFER_TAU_H) + float(_rng.normal(0, 0.15))
            t.cargo_rh = min(100.0, max(amb_rh, 92.0) + float(_rng.normal(0, 0.8)))
        else:
            t.cargo_temp = amb_t + float(_rng.normal(0, 0.3))
            t.cargo_rh = amb_rh
        if t.progress_s >= t.duration_s:
            arrived.append(t)

    # ---- decay for every active batch (same engine) ----
    for b in batches.values():
        t = trip_by_batch.get(b.id)
        p = get_produce(b.produce)
        rh_mid = (p.v("rh_low") + p.v("rh_high")) / 2
        sensor = False
        if t is not None:
            temp, rh = t.cargo_temp, t.cargo_rh
            sensor = t.reefer
        elif b.status == "stored" and b.storage_type in ("cold_storage", "reefer"):
            temp, rh = p.v("t_ref") + float(_rng.normal(0, 0.35)), rh_mid + float(_rng.normal(0, 1.2))
            sensor = True
        else:
            pt = b.facility_id if (b.status == "delivered" and b.facility_id in ws.points) else domain.weather_point(b)
            temp, rh, _ = ws.at(pt, now)
            if b.status == "stored" and b.manual_bias_at and (now - b.manual_bias_at) <= timedelta(hours=domain.MANUAL_BIAS_HOURS):
                temp, rh = temp + b.manual_bias_t, min(100.0, max(5.0, rh + b.manual_bias_rh))
        prm = central(b.produce, b.maturity)
        q, w, r, e = step(prm, np.array([b.q]), np.array([b.w]), np.array([b.r]), np.array([b.e]), float(temp), float(rh), dt_h)
        b.q, b.w, b.r, b.e = float(q[0]), float(w[0]), float(r[0]), float(e[0])
        b.state_at = now
        if sensor and write_reading:
            readings.append({"batch_id": b.id, "trip_id": t.id if t else None, "ts": now, "temp_c": round(float(temp), 2),
                             "rh": round(float(rh), 1), "origin": "simulated"})
        # threshold: reefer temperature excursion
        if t is not None and t.reefer and t.cargo_temp is not None and t.cargo_temp > p.v("t_ref") + 4 and (b.id, "excursion") not in _alerted:
            _alerted.add((b.id, "excursion"))
            notify(db, now=now, kind="temp_excursion", severity="critical", batch=b, trip_id=t.id,
                   title=f"Temperature excursion: {b.id}", external=not t.loop,
                   body=f"Cargo at {t.cargo_temp:.1f} °C, {t.cargo_temp - p.v('t_ref'):.1f} °C above the {p.v('t_ref'):.1f} °C setpoint (simulated feed).")
    if readings:
        db.bulk_insert_mappings(Reading, readings)

    # ---- arrivals ----
    for t in arrived:
        b = batches.get(t.batch_id)
        if b is None:
            continue
        if t.loop and not t.rerouted:
            # background lane: a fresh simulated consignment starts the same lane
            b.q = b.initial_quality or 92.0
            b.w = b.r = b.e = 0.0
            b.harvest_time = now - timedelta(hours=12)
            t.progress_s = 0
            t.started_at = now
            continue
        t.status = "arrived"
        dest = t.dest_id
        if dest.startswith("cs_"):
            b.status, b.storage_type, b.facility_id = "stored", "cold_storage", dest
            label = f"Cold storage: {t.dest_name}"
        else:
            b.status, b.facility_id = "delivered", dest
            label = f"Delivered to {t.dest_name}"
        db.add(StorageRecord(batch_id=b.id, facility_id=dest, storage_type="cold_storage" if dest.startswith("cs_") else "mandi",
                             label=label, start=now))
        notify(db, now=now, kind="arrival", severity="success", batch=b, trip_id=t.id, title=f"{b.id} arrived",
               body=f"{label}. Quality {b.q:.0f}%, saleable {b.quantity_kg * (1 - b.w) * (1 - b.r):,.0f} kg.")

    tick_n = (domain.get_state(db, "tick") or {"n": 0})["n"] + 1
    domain.set_state(db, "tick", {"n": tick_n})
    events = {"trucks": [truck_payload(t, batches[t.batch_id]) for t in trips if t.batch_id in batches and t.status == "in_transit"]}
    if tick_n % STATUS_EVERY == 0 or arrived:
        before = {bid: b.risk for bid, b in batches.items()}
        refresh_status(db)
        for bid, b in batches.items():
            if b.risk != before.get(bid) and b.risk in ("warning", "critical") and (bid, b.risk) not in _alerted:
                _alerted.add((bid, b.risk))
                user_batch = b.origin != "simulated" or b.is_judge or b.lane_id == "S2" or b.status == "stored"
                if b.risk == "critical" or user_batch:
                    days = b.shelf_life_days
                    notify(db, now=now, kind="shelf_life", severity=b.risk, batch=b, trip_id=trip_by_batch.get(bid).id if bid in trip_by_batch else None,
                           title=f"{b.id}: shelf life {'about ' + format(days, '.1f') + ' days' if days is not None else 'low'}",
                           body=f"Quality {b.q:.0f}% ({quality_category(b.q)}). Predicted shelf life {days if days is not None else '-'} days.",
                           external=user_batch and b.origin != "simulated", kn_args={"days": f"{days:.1f}" if days else "-", "quality": f"{b.q:.0f}"})
        events["batches"] = [{"id": b.id, "quality": round(b.q, 1), "risk": b.risk, "shelf_life_days": b.shelf_life_days,
                              "value_inr": b.value_inr, "status": b.status} for b in batches.values()]
    events["stats"] = stats(db)
    events["sim_now"] = now.isoformat(timespec="minutes")
    events["tick"] = tick_n
    events["minutes_per_tick"] = dt_min
    return events


class Simulator:
    def __init__(self):
        self.task: asyncio.Task | None = None
        self.last_error: str | None = None

    async def run(self):
        while True:
            await asyncio.sleep(settings.sim_tick_seconds)
            try:
                ev = await asyncio.to_thread(self._tick_once)
                if ev:
                    await hub.broadcast({"type": "tick", "data": ev})
                    if "batches" in ev:
                        await hub.broadcast({"type": "batch.update", "data": ev["batches"]})
                self.last_error = None
            except Exception as exc:  # never let the demo loop die
                self.last_error = repr(exc)
                log.exception("tick failed")

    def _tick_once(self):
        with world_lock:
            db = SessionLocal()
            try:
                ev = tick(db)
                db.commit()
                return ev
            except Exception:
                db.rollback()
                raise
            finally:
                db.close()

    def start(self):
        if self.task is None:
            self.task = asyncio.create_task(self.run())


simulator = Simulator()
