"""Produce deterioration: the sourced Q10 decay engine (app.engine.decay) plus a gas-injury factor,
and periodic shelf-life / spoilage-probability predictions with Monte Carlo over registry parameter ranges."""
from __future__ import annotations

import math
import zlib

import numpy as np

from app.engine.decay import crossing_hours, make_params, quality_category, rate_per_day, simulate, step
from app.engine.decay import State as DecayState
from app.engine.registry import get_produce
from .state import COMMODITY_PHYSICS, ProduceState

GAS_INJURY_FACTOR = 1.5   # decay multiplier while O2/CO2 are beyond injury limits (engineering assumption)
_params: dict = {}


def central_params(commodity: str, maturity: str | None):
    key = (commodity, maturity)
    if key not in _params:
        _params[key] = make_params(get_produce(commodity), maturity)
    return _params[key]


def gas_injury(commodity: str, x_o2: float, x_co2: float) -> bool:
    ph = COMMODITY_PHYSICS[commodity]
    return x_o2 * 100 < ph["o2_critical"] or x_co2 * 100 > ph["co2_critical"]


def step_produce(p: ProduceState, t: float, rh: float, x_o2: float, x_co2: float, dt_s: float) -> tuple[float, float]:
    """Advance quality/weight/rejection/chilling. Returns (transpiration kg/s, decay rate 1/day)."""
    prm = central_params(p.commodity, p.maturity)
    dt_h = dt_s / 3600.0
    w_before = p.w
    q, w, r, e = step(prm, np.array([p.q]), np.array([p.w]), np.array([p.r]), np.array([p.e]), float(t), float(rh), dt_h)
    k = float(rate_per_day(prm, t, rh, float(e[0]))[0])
    q_new = float(q[0])
    if gas_injury(p.commodity, x_o2, x_co2):
        q_new *= math.exp(-(GAS_INJURY_FACTOR - 1.0) * k * dt_h / 24.0)
        k *= GAS_INJURY_FACTOR
    _attribute(prm, p, q_new, t, rh, float(e[0]), gas_injury(p.commodity, x_o2, x_co2), dt_h)
    p.q, p.w, p.r, p.e = q_new, float(w[0]), float(r[0]), float(e[0])
    transp = max(0.0, (p.w - w_before)) * p.mass_kg / max(dt_s, 1e-6)
    return transp, k


def _attribute(prm, p: ProduceState, q_new: float, t: float, rh: float, e: float, gas: bool, dt_h: float):
    """Split this step's quality loss by cause. Loss that would happen at the ideal conditions is 'ageing'; the extra
    (or the saving, if conditions are better than reference) is shared between factors by their log-multiplier."""
    from app.engine.decay import chill_factor, humidity_factor
    lost = p.q - q_new
    if lost <= 0:
        return
    sc = lambda x: float(np.ravel(x)[0])
    base = p.q * (1 - math.exp(-sc(prm.k_ref) * dt_h / 24.0))
    f = {"temperature": sc(prm.q10 ** ((t - prm.t_ref) / 10.0)), "humidity": sc(humidity_factor(prm, rh)),
         "chilling": sc(chill_factor(prm, e)), "ripeness": sc(prm.m), "gas": GAS_INJURY_FACTOR if gas else 1.0}
    logs = {k: math.log(v) for k, v in f.items() if v > 0 and abs(math.log(v)) > 1e-9}
    total = sum(logs.values())
    acc = p.loss
    acc["ageing"] = acc.get("ageing", 0.0) + base
    extra = lost - base
    if total and abs(extra) > 0:
        for k, v in logs.items():
            acc[k] = acc.get(k, 0.0) + extra * v / total


def reference_rate(commodity: str, maturity: str | None) -> float:
    """Decay rate at the commodity's recommended conditions (for 'abnormal deterioration' detection)."""
    pp = get_produce(commodity)
    prm = central_params(commodity, maturity)
    return float(rate_per_day(prm, pp.v("t_ref"), (pp.v("rh_low") + pp.v("rh_high")) / 2, 0.0)[0])


def predict(p: ProduceState, t: float, rh: float, remaining_planned_h: float, seed_key: str, draws: int = 200, horizon_h: int = 720) -> dict:
    """Shelf life if current conditions persist; P10-P90 band and spoilage probability over the planned remaining time."""
    pp = get_produce(p.commodity)
    # look far enough ahead for long-keeping crops (grains, pomegranate): 1.3 x published life, 30 days to ~13 months
    horizon_h = int(min(9600, max(horizon_h, pp.v("storage_life") * 24 * 1.3)))
    if horizon_h > 1500:   # keep the Monte Carlo cost roughly constant for long horizons
        draws = max(40, int(draws * 1500 / horizon_h))
    temps = np.full(horizon_h, float(t))
    rhs = np.full(horizon_h, float(rh))
    s0 = DecayState(q=p.q, w=p.w, r=p.r, e=p.e)
    Q, *_ = simulate(make_params(pp, p.maturity), s0, temps, rhs)
    central = crossing_hours(Q, pp.v("q_min"))[0]
    mc = make_params(pp, p.maturity, draws=draws, seed=zlib.crc32(seed_key.encode()))
    Qm, *_ = simulate(mc, s0, temps, rhs)
    sl = crossing_hours(Qm, pp.v("q_min"))
    sl_f = np.where(np.isnan(sl), horizon_h, sl)
    spoil = float(np.mean(sl_f < max(0.0, remaining_planned_h))) if remaining_planned_h > 0 else 0.0
    return {"quality": round(p.q, 2), "category": quality_category(p.q),
            "shelf_life_days": None if math.isnan(central) else round(float(central) / 24, 2),
            "shelf_life_p10": round(float(np.percentile(sl_f, 10)) / 24, 2), "shelf_life_p90": round(float(np.percentile(sl_f, 90)) / 24, 2),
            "beyond_horizon": bool(math.isnan(central)), "spoilage_probability": round(spoil, 3),
            "saleable_fraction": round((1 - p.w) * (1 - p.r), 4), "assumes": "current conditions persist",
            "model": "Q10 decay engine (calibrated to published storage life; curve shape not validated)"}
