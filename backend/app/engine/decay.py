"""ZERO ROT Decay Engine.

The single source of deterioration maths for every feature (twin, what-if, decision, market shift,
transport, ghost, scenarios). Vectorised over N parameter draws so the same code produces the
central prediction (N=1) and the Monte Carlo uncertainty band (N=200).

State variables (no double counting):
  Q  visual/market quality 0-100 -> grade and price per kg only
  W  weight-loss fraction (transpiration) -> mass only
  R  rejected fraction (rot) -> units removed from sale only
  E  cumulative chilling exposure (degC.h below threshold) -> feeds Q through c(T)
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .registry import Produce

MODEL_VERSION = "decay-1.0.0"
W_CAP = 0.35


@dataclass
class DecayParams:
    k_ref: np.ndarray
    q10: np.ndarray
    h_low: np.ndarray
    h_high: np.ndarray
    gamma: np.ndarray
    m: float
    t_ref: float
    rh_low: float
    rh_high: float
    t_chill: float
    e_crit: float
    kw: float
    r0: float
    q_rot: float
    r_heat: float
    q_min: float

    @property
    def n(self) -> int:
        return int(self.k_ref.shape[0])


@dataclass
class State:
    q: float = 100.0
    w: float = 0.0
    r: float = 0.0
    e: float = 0.0

    def as_dict(self):
        return {"q": self.q, "w": self.w, "r": self.r, "e": self.e}


def make_params(p: Produce, maturity: str | None, draws: int = 0, seed: int = 0) -> DecayParams:
    """Central parameters (draws=0 -> N=1) or Monte Carlo draws over registry ranges."""
    def central(key):
        return np.array([p.v(key)])

    if draws <= 0:
        k_ref, q10, hl, hh, g = (central(k) for k in ("k_ref", "q10", "h_low_slope", "h_high_slope", "chill_gamma"))
    else:
        rng = np.random.default_rng(seed)
        def u(key):
            lo, hi = p.rng(key)
            return rng.uniform(lo, hi, draws)
        k_ref, q10, hl, hh, g = u("k_ref"), u("q10"), u("h_low_slope"), u("h_high_slope"), u("chill_gamma")
    return DecayParams(k_ref=k_ref, q10=q10, h_low=hl, h_high=hh, gamma=g, m=p.maturity_multiplier(maturity),
                       t_ref=p.v("t_ref"), rh_low=p.v("rh_low"), rh_high=p.v("rh_high"), t_chill=p.v("t_chill"),
                       e_crit=p.v("e_crit"), kw=p.v("kw"), r0=p.v("r0"), q_rot=p.v("q_rot"), r_heat=p.v("r_heat"),
                       q_min=p.v("q_min"))


def vpd_kpa(t, rh):
    es = 0.6108 * np.exp(17.27 * t / (t + 237.3))
    return es * (1.0 - np.clip(rh, 0, 100) / 100.0)


def humidity_factor(prm: DecayParams, rh):
    low = 1.0 + prm.h_low * np.maximum(0.0, prm.rh_low - rh)
    high = 1.0 + prm.h_high * np.maximum(0.0, rh - prm.rh_high)
    return np.where(rh < prm.rh_low, low, np.where(rh > prm.rh_high, high, 1.0))


def chill_factor(prm: DecayParams, e):
    return 1.0 + prm.gamma * np.minimum(e / prm.e_crit, 3.0)


def rate_per_day(prm: DecayParams, t, rh, e):
    """k(T, RH) = k_ref * m * Q10^((T - T_ref)/10) * h(RH) * c(E)."""
    return prm.k_ref * prm.m * prm.q10 ** ((t - prm.t_ref) / 10.0) * humidity_factor(prm, rh) * chill_factor(prm, e)


def step(prm: DecayParams, q, w, r, e, t, rh, dt_h):
    """Advance all state variables by dt_h hours at temperature t and humidity rh (scalars or arrays)."""
    dt_d = dt_h / 24.0
    e = e + np.maximum(0.0, prm.t_chill - t) * dt_h
    k = rate_per_day(prm, t, rh, e)
    q = q * np.exp(-k * dt_d)
    w = np.minimum(W_CAP, w + prm.kw * vpd_kpa(t, rh) * (1.0 - w) * dt_d)
    dr = (prm.r0 * np.maximum(0.0, (prm.q_rot - q) / prm.q_rot) * (1.0 + 0.1 * np.maximum(0.0, rh - prm.rh_high))
          + prm.r_heat * np.maximum(0.0, t - (prm.t_ref + 12.0))
          + 0.02 * np.maximum(0.0, e / prm.e_crit - 1.0))
    r = np.minimum(1.0, r + dr * (1.0 - r) * dt_d)
    return q, w, r, e


def simulate(prm: DecayParams, s0: State, temps, rhs, dt_h: float = 1.0):
    """Integrate step by step over a temperature/humidity history.
    temps/rhs: shape (steps,) shared by all rows, or (M, steps) one series per row (e.g. one per decision option).
    Returns Q, W, R, E arrays shaped (N, steps+1)."""
    temps = np.asarray(temps, dtype=float)
    rhs = np.asarray(rhs, dtype=float)
    per_row = temps.ndim == 2
    steps = temps.shape[-1]
    n = max(prm.n, temps.shape[0] if per_row else 1)
    Q = np.empty((n, steps + 1)); W = np.empty_like(Q); R = np.empty_like(Q); E = np.empty_like(Q)
    q = np.full(n, s0.q, dtype=float); w = np.full(n, s0.w, dtype=float); r = np.full(n, s0.r, dtype=float); e = np.full(n, s0.e, dtype=float)
    Q[:, 0], W[:, 0], R[:, 0], E[:, 0] = q, w, r, e
    for i in range(steps):
        t = temps[:, i] if per_row else temps[i]
        h = rhs[:, i] if per_row else rhs[i]
        q, w, r, e = step(prm, q, w, r, e, t, h, dt_h)
        Q[:, i + 1], W[:, i + 1], R[:, i + 1], E[:, i + 1] = q, w, r, e
    return Q, W, R, E


def crossing_hours(Q: np.ndarray, q_min: float, dt_h: float = 1.0) -> np.ndarray:
    """Hours until Q first drops below q_min, linearly interpolated; NaN if never within the series."""
    out = np.full(Q.shape[0], np.nan)
    below = Q < q_min
    for i in range(Q.shape[0]):
        idx = np.argmax(below[i])
        if not below[i, idx]:
            continue
        if idx == 0:
            out[i] = 0.0
            continue
        q1, q2 = Q[i, idx - 1], Q[i, idx]
        frac = (q1 - q_min) / (q1 - q2) if q1 != q2 else 0.0
        out[i] = (idx - 1 + frac) * dt_h
    return out


def quality_category(q: float) -> str:
    if q >= 85:
        return "Excellent"
    if q >= 70:
        return "Good"
    if q >= 55:
        return "Fair"
    if q >= 40:
        return "Poor"
    return "Unsellable"
