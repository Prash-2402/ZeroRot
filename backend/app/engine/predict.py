"""Prediction Engine: quality trajectory, remaining shelf life with P10-P90 interval, value curve and confidence."""
from __future__ import annotations

import zlib
from dataclasses import dataclass, field
from datetime import datetime, timedelta

import numpy as np

from .conditions import Segment, WeatherStore, build_series
from .confidence import Reading, applicability_score, compute_confidence
from .decay import MODEL_VERSION, State, crossing_hours, make_params, quality_category, simulate
from .registry import get_produce
from .value import batch_value, grade_factor, price_at, value_breakdown

MC_DRAWS = 200
SHELF_HORIZON_DAYS = 30
WEATHER_BANNER = ("Storage conditions estimated from regional weather. Actual shed temperature and humidity may differ. "
                  "Enter a measured reading to improve this prediction.")


@dataclass
class PredictionInput:
    produce: str
    maturity: str | None
    mass_kg: float
    state: State
    start: datetime
    segments: list[Segment]
    price: dict | None
    harvest: datetime
    readings: list[Reading] = field(default_factory=list)
    known: dict = field(default_factory=dict)
    weather_based: bool = False
    seed_key: str = "batch"


def validate(inp: PredictionInput):
    if inp.mass_kg is None or inp.mass_kg <= 0:
        raise ValueError("quantity must be positive")
    if inp.harvest > inp.start:
        raise ValueError("harvest time cannot be in the future")
    if not (0 <= inp.state.q <= 100):
        raise ValueError("quality must be between 0 and 100")
    get_produce(inp.produce)


def risk_level(shelf_days: float | None) -> str:
    if shelf_days is None:
        return "healthy"
    if shelf_days <= 2:
        return "critical"
    if shelf_days <= 5:
        return "warning"
    return "healthy"


def predict(inp: PredictionInput, horizon_days: int = 14, step_h: int = 6, mc_draws: int = MC_DRAWS):
    validate(inp)
    p = get_produce(inp.produce)
    total_h = max(horizon_days, SHELF_HORIZON_DAYS) * 24
    T, RH = build_series(inp.segments, inp.start, _weather_from(inp))
    if len(T) < total_h:
        pad = total_h - len(T)
        T = np.pad(T, (0, pad), mode="edge") if len(T) else np.full(total_h, p.v("t_ref"))
        RH = np.pad(RH, (0, pad), mode="edge") if len(RH) else np.full(total_h, p.v("rh_low"))
    T, RH = T[:total_h], RH[:total_h]

    central = make_params(p, inp.maturity)
    Q, W, R, E = simulate(central, inp.state, T, RH)
    seed = zlib.crc32(inp.seed_key.encode())
    mc = make_params(p, inp.maturity, draws=mc_draws, seed=seed)
    Qm, Wm, Rm, _ = simulate(mc, inp.state, T, RH)

    sl_c = crossing_hours(Q, central.q_min)[0]
    sl_mc = crossing_hours(Qm, central.q_min)
    sl_mc_f = np.where(np.isnan(sl_mc), total_h, sl_mc)
    beyond = bool(np.isnan(sl_c))
    shelf = {
        "days": None if beyond else round(sl_c / 24, 2),
        "p10_days": round(float(np.percentile(sl_mc_f, 10)) / 24, 2),
        "p90_days": round(float(np.percentile(sl_mc_f, 90)) / 24, 2),
        "beyond_horizon": beyond, "horizon_days": SHELF_HORIZON_DAYS,
        "threshold_quality": central.q_min,
        "threshold_date": None if beyond else (inp.start + timedelta(hours=float(sl_c))).isoformat(timespec="minutes"),
    }
    shelf["risk"] = risk_level(shelf["days"])

    conf = compute_confidence(inp.readings, inp.harvest, inp.start, weather_available=inp.weather_based,
                              known=inp.known, parameter_quality=p.parameter_quality(),
                              applicability=applicability_score(p, T[: 7 * 24]))

    # trajectory points for the time slider and synchronized charts
    H = horizon_days * 24
    idxs = list(range(0, H + 1, step_h))
    q10b = np.percentile(Qm, 10, axis=0); q90b = np.percentile(Qm, 90, axis=0)
    w0, r0, q0 = float(W[0, 0]), float(R[0, 0]), float(Q[0, 0])
    p_obs = price_at(inp.price, "base", 0) if inp.price else None
    traj = []
    for h in idxs:
        day = h / 24.0
        q, w, r = float(Q[0, h]), float(W[0, h]), float(R[0, h])
        point = {"hour": h, "day": round(day, 2), "ts": (inp.start + timedelta(hours=h)).isoformat(timespec="minutes"),
                 "quality": round(q, 2), "quality_p10": round(float(q10b[h]), 2), "quality_p90": round(float(q90b[h]), 2),
                 "category": quality_category(q), "weight_loss_pct": round(w * 100, 2), "rejected_pct": round(r * 100, 2),
                 "saleable_kg": round(inp.mass_kg * (1 - w) * (1 - r), 1),
                 "temp_c": round(float(T[min(h, len(T) - 1)]), 1), "rh": round(float(RH[min(h, len(RH) - 1)]), 1)}
        # shelf life remaining from this point (central run)
        rem = None if beyond else max(0.0, (sl_c - h) / 24)
        point["shelf_life_days"] = None if rem is None else round(rem, 2)
        if inp.price:
            pb, pl_, ph = (price_at(inp.price, k, day) for k in ("base", "low", "high"))
            point["price_per_kg"] = round(pb, 2)
            point["value"] = round(float(batch_value(inp.mass_kg, w, r, pb, q)))
            point["value_low"] = round(float(batch_value(inp.mass_kg, w, r, pl_, q)))
            point["value_high"] = round(float(batch_value(inp.mass_kg, w, r, ph, q)))
            bd = value_breakdown(inp.mass_kg, p_obs, q0, w0, r0, pb, q, w, r)
            point["breakdown"] = {k: round(v) for k, v in bd.items()}
        traj.append(point)

    def at_h(h):
        pt = next(x for x in traj if x["hour"] == h)
        return {k: pt.get(k) for k in ("quality", "quality_p10", "quality_p90", "category", "value", "saleable_kg", "shelf_life_days")}

    current = traj[0]
    v_now = current.get("value")
    v48 = next(x for x in traj if x["hour"] == 48).get("value")
    drop48 = (1 - v48 / v_now) if v_now else 0.0
    res = {
        "model_version": MODEL_VERSION, "parameter_version": p.version, "produce": inp.produce,
        "computed_at": inp.start.isoformat(timespec="minutes"),
        "current": {"quality": round(q0, 1), "category": quality_category(q0), "value": v_now,
                    "saleable_kg": current["saleable_kg"], "price_per_kg": current.get("price_per_kg"),
                    "weight_loss_pct": current["weight_loss_pct"], "rejected_pct": current["rejected_pct"],
                    "chill_exposure_degh": round(float(E[0, 0]), 1)},
        "future": {"24h": at_h(24), "48h": at_h(48), "72h": at_h(72)},
        "value_drop_48h_pct": round(drop48 * 100, 1),
        "shelf_life": shelf, "confidence": conf, "trajectory": traj,
        "conditions": {"weather_based": inp.weather_based, "banner": WEATHER_BANNER if inp.weather_based else None,
                       "mean_temp_72h": round(float(T[:72].mean()), 1), "mean_rh_72h": round(float(RH[:72].mean()), 1)},
        "price": {k: v for k, v in (inp.price or {}).items() if k in ("observed", "method", "label", "n_points", "condition")},
        "insufficient": conf["category"] == "INSUFFICIENT",
    }
    if traj[-1].get("breakdown"):
        res["value_loss_breakdown"] = traj[-1]["breakdown"]
    return res


_WEATHER: WeatherStore | None = None


def set_weather(ws: WeatherStore):
    global _WEATHER
    _WEATHER = ws


def _weather_from(_inp) -> WeatherStore:
    from .conditions import cached_weather
    return _WEATHER or cached_weather()
