"""Plan evaluation: runs the one decay engine over several storage/transport plans at once and prices each.

Used by the decision engine, the Market Shift Planner, the reroute/rescue workflow and the ghost comparison.
Expected net value = batch value at sale (already includes grade, weight loss and rejection)
                     - transport - storage rent - handling - commission. Nothing is subtracted twice.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

import numpy as np

from .conditions import Segment, WeatherStore, build_series
from .decay import State, crossing_hours, make_params, simulate
from .registry import Produce
from .value import batch_value, grade_factor, price_at

# Demo default costs (engineering assumptions, configurable). Not quoted rates.
COSTS = {
    "commission_rate": 0.06,       # share of gross sale value
    "handling_per_kg": 0.40,       # loading/unloading per handling event
    "transport_min": 600.0,        # Rs per trip
    "transport_base_per_km": 14.0, # Rs per km
    "transport_per_tonne_km": 3.0, # Rs per tonne-km
    "reefer_multiplier": 1.4,
    "fallback_speed_kmh": 45.0,
    "road_factor": 1.3,
}


AUCTION_START_H, AUCTION_END_H = 4, 10  # demo assumption: APMC auctions run in the morning


def auction_wait_hours(start: datetime, hours_to_arrival: float) -> int:
    """Hours a load waits after arriving until the next morning auction (0 if it arrives during the auction window)."""
    from datetime import timedelta
    arr = start + timedelta(hours=hours_to_arrival)
    if AUCTION_START_H <= arr.hour < AUCTION_END_H:
        return 0
    nxt = arr.replace(hour=6, minute=0, second=0, microsecond=0)
    if nxt <= arr:
        nxt += timedelta(days=1)
    return max(0, round((nxt - arr).total_seconds() / 3600))


def transport_cost(km: float, mass_kg: float, reefer: bool = False) -> float:
    c = max(COSTS["transport_min"], km * (COSTS["transport_base_per_km"] + COSTS["transport_per_tonne_km"] * mass_kg / 1000.0))
    return c * (COSTS["reefer_multiplier"] if reefer else 1.0)


@dataclass
class Plan:
    key: str
    kind: str              # SELL | STORE | SHIP | CONTINUE | REROUTE | PERIOD
    label: str
    segments: list[Segment]
    sale_hour: int
    market_id: str
    market_name: str
    transport_cost: float = 0.0
    rent: float = 0.0
    handling: float = 0.0
    hold_point: str | None = None  # weather point used after the sale hour (for shelf-life feasibility)
    meta: dict = field(default_factory=dict)


def evaluate_plans(p: Produce, maturity: str | None, state: State, mass_kg: float, start: datetime,
                   plans: list[Plan], weather: WeatherStore, prices: dict, extra_hold_h: int = 168):
    if not plans:
        return []
    series = []
    for pl in plans:
        segs = list(pl.segments) + [Segment("weather", extra_hold_h, point=pl.hold_point or pl.market_id)]
        series.append(build_series(segs, start, weather))
    L = max(len(t) for t, _ in series)
    T = np.vstack([np.pad(t, (0, L - len(t)), mode="edge") for t, _ in series])
    RH = np.vstack([np.pad(h, (0, L - len(h)), mode="edge") for _, h in series])
    prm = make_params(p, maturity)
    Q, W, R, E = simulate(prm, state, T, RH)
    sl = crossing_hours(Q, prm.q_min)
    out = []
    for i, pl in enumerate(plans):
        h = min(pl.sale_hour, L)
        q, w, r = float(Q[i, h]), float(W[i, h]), float(R[i, h])
        scen = prices.get(pl.market_id)
        res = {"key": pl.key, "kind": pl.kind, "label": pl.label, "market_id": pl.market_id, "market_name": pl.market_name,
               "sale_hour": pl.sale_hour, "sale_day": round(pl.sale_hour / 24.0, 2), "quality_at_sale": round(q, 1),
               "weight_loss_pct": round(w * 100, 2), "rejected_pct": round(r * 100, 2),
               "saleable_kg": round(mass_kg * (1 - w) * (1 - r), 1), "grade_factor": round(float(grade_factor(q)), 3),
               "shelf_life_hours": None if np.isnan(sl[i]) else round(float(sl[i]), 1),
               "transport_cost": round(pl.transport_cost), "rent": round(pl.rent), "handling": round(pl.handling),
               "meta": pl.meta, "temps": T[i, : max(h, 1)], "q_path": Q[i, : h + 1]}
        for which in ("base", "low", "high"):
            if scen is None:
                res[which] = None
                continue
            price = price_at(scen, which, pl.sale_hour / 24.0)
            gross = float(batch_value(mass_kg, w, r, price, q))
            commission = COSTS["commission_rate"] * gross
            net = gross - pl.transport_cost - pl.rent - pl.handling - commission
            res[which] = {"price_per_kg": round(price, 2), "gross": round(gross), "commission": round(commission), "net": round(net)}
        res["net"] = res["base"]["net"] if res["base"] else None
        out.append(res)
    return out


def strip_internal(r: dict) -> dict:
    return {k: v for k, v in r.items() if k not in ("temps", "q_path")}
