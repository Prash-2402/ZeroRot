"""Market Value Engine: grade factor, price scenarios, batch value and value-loss breakdown.

Physical decay and market price are separate variables:
  Saleable mass(t) = M x (1 - W) x (1 - R)
  Price per kg(t)  = Price scenario(t) x Grade factor(Q)
  Batch value(t)   = Saleable mass(t) x Price per kg(t)
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import numpy as np

ASSUMED_BAND = 0.15
MIN_POINTS = 14
TREND_MIN_DAYS = 30

MARKET_CONDITIONS = {
    "normal": {"label": "Normal market", "banner": "No market shift detected. Prices held at the latest observed level.", "transit_delay": 1.0, "rh_shift": 0.0},
    "price_crash": {"label": "Price crash", "banner": "Arrivals at the mandi up 40%: prices expected to fall over the next 3 days (demo scenario).", "transit_delay": 1.0, "rh_shift": 0.0},
    "festival": {"label": "Festival demand", "banner": "Festival demand expected to lift prices, peaking around Day 4 (demo scenario).", "transit_delay": 1.0, "rh_shift": 0.0},
    "heavy_rain": {"label": "Heavy rain", "banner": "Heavy rain: supply disruption lifts prices ~12%, roads slower and sheds more humid (demo scenario).", "transit_delay": 1.3, "rh_shift": 10.0},
}


def condition_multiplier(condition: str, day: float) -> float:
    """Explicit, labelled scenario shift of the base price path (not a forecast)."""
    if condition == "price_crash":
        return 1.0 - 0.30 * min(1.0, day / 3.0)
    if condition == "festival":
        if day <= 4:
            return 1.0 + 0.40 * (day / 4.0)
        return 1.0 + max(0.10, 0.40 - 0.10 * (day - 4))
    if condition == "heavy_rain":
        return 1.12
    return 1.0


def grade_factor(q, full=85.0, floor_q=40.0, floor_g=0.5):
    q = np.asarray(q, dtype=float)
    g = floor_g + (1.0 - floor_g) * (q - floor_q) / (full - floor_q)
    return np.where(q >= full, 1.0, np.where(q < floor_q, 0.0, g))


@dataclass
class PricePoint:
    day: date
    price_per_kg: float


def comparable_series(records: list[dict], commodity: str, mandi: str, variety: str | None = None):
    """Same commodity, same mandi, same variety (or all varieties), unit normalised to Rs/kg, sorted, de-duplicated."""
    rows = [r for r in records if r["commodity"] == commodity and r["mandi_id"] == mandi
            and (variety is None or r.get("variety") in (variety, None, "All varieties"))]
    by_day = {}
    for r in rows:
        unit = r.get("unit", "Rs/quintal")
        price = r["modal_price"] / 100.0 if unit == "Rs/quintal" else r["modal_price"]
        by_day[r["date"]] = price
    return [PricePoint(d, p) for d, p in sorted(by_day.items())]


def price_scenarios(series: list[PricePoint], horizon_days: int, condition: str = "normal", source: str = "", origin: str = "simulated"):
    """Low / base / high price paths for days 0..horizon. Never a guaranteed forecast."""
    if not series:
        return None
    observed = series[-1]
    # usable day-over-day changes: consecutive reported dates, gaps <= 7 days
    changes = []
    for a, b in zip(series[:-1], series[1:]):
        gap = (b.day - a.day).days
        if 0 < gap <= 7 and a.price_per_kg > 0 and b.price_per_kg > 0:
            changes.append(np.log(b.price_per_kg / a.price_per_kg) / gap)
    changes = np.array(changes)
    dropped = 0
    if len(changes) > 3:
        mu, sd = changes.mean(), changes.std()
        keep = np.abs(changes - mu) <= 5 * sd if sd > 0 else np.ones_like(changes, bool)
        dropped = int((~keep).sum())
        changes = changes[keep]
    days = np.arange(horizon_days + 1, dtype=float)
    p0 = observed.price_per_kg
    n_points = int(len(changes))
    if n_points < MIN_POINTS:
        base = np.full_like(days, p0)
        low, high = base * (1 - ASSUMED_BAND), base * (1 + ASSUMED_BAND)
        method = "assumed_band"
        label = "Assumed price range: engineering assumption, not statistically derived (insufficient history)."
        trend = 0.0
    else:
        span = (series[-1].day - series[0].day).days
        trend = float(np.clip(changes[-30:].mean(), -0.01, 0.01)) if span >= TREND_MIN_DAYS else 0.0
        base = p0 * np.exp(trend * days)
        q10, q90 = np.percentile(changes, 10), np.percentile(changes, 90)
        sd = changes.std()
        # spread of cumulative change grows with sqrt(horizon) (random-walk assumption on observed changes)
        low = base * np.exp((q10 - changes.mean()) * np.sqrt(days)) if sd > 0 else base
        high = base * np.exp((q90 - changes.mean()) * np.sqrt(days)) if sd > 0 else base
        method = "historical_percentiles"
        label = f"Scenario range from the 10th-90th percentile of {n_points} observed day-over-day changes. Not a guaranteed forecast."
    mult = np.array([condition_multiplier(condition, d) for d in days])
    return {
        "observed": {"price_per_kg": round(p0, 2), "date": observed.day.isoformat(), "source": source, "origin": origin},
        "days": days.tolist(),
        "low": (low * mult).tolist(), "base": (base * mult).tolist(), "high": (high * mult).tolist(),
        "method": method, "label": label, "n_points": n_points, "outliers_dropped": dropped,
        "trend_per_day": trend, "condition": condition,
    }


def price_at(scen: dict, which: str, day: float) -> float:
    d = np.array(scen["days"]); v = np.array(scen[which])
    if day >= d[-1]:
        return float(v[-1])
    return float(np.interp(day, d, v))


def batch_value(mass_kg, w, r, price_per_kg, q):
    return mass_kg * (1 - w) * (1 - r) * price_per_kg * grade_factor(q)


def value_breakdown(mass_kg, p0, q0, w0, r0, pt, qt, wt, rt):
    """Exact attribution of value change into four causes; the parts sum to total loss.
    Starting point may already carry W/R (e.g. a batch mid-life): losses are measured from that state."""
    g0, gt = float(grade_factor(q0)), float(grade_factor(qt))
    m0 = mass_kg * (1 - w0) * (1 - r0)
    v0 = m0 * p0 * g0
    # remaining W/R growth expressed relative to the starting saleable mass
    w_rel = 1 - (1 - wt) / (1 - w0) if w0 < 1 else 0.0
    r_rel = 1 - (1 - rt) / (1 - r0) if r0 < 1 else 0.0
    market = m0 * (p0 - pt) * g0
    grade = m0 * pt * (g0 - gt)
    weight = m0 * w_rel * pt * gt
    reject = m0 * (1 - w_rel) * r_rel * pt * gt
    vt = m0 * (1 - w_rel) * (1 - r_rel) * pt * gt
    return {"start_value": v0, "end_value": vt, "total_loss": v0 - vt, "quality_grade": grade,
            "weight_loss": weight, "rejected_units": reject, "market_price": market}
