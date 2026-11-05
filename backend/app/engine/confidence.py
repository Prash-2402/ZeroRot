"""Confidence: a data-quality index from 0 to 100. It is NOT a calibrated probability.

Confidence = 100 x (0.20C + 0.10D + 0.10F + 0.15S + 0.15B + 0.20P + 0.10A)
Weights are design choices (configurable here), documented in the README.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

WEIGHTS = {"C": 0.20, "D": 0.10, "F": 0.10, "S": 0.15, "B": 0.15, "P": 0.20, "A": 0.10}
SOURCE_SCORE = {"manual": 1.0, "sensor": 1.0, "simulated": 0.6, "weather": 0.5, "none": 0.0}
SIMULATED_CAP = 74.0
FACTOR_TEXT = {
    "C": "readings cover only part of the time since harvest",
    "D": "large gaps between readings",
    "F": "latest reading is old",
    "S": {"weather": "storage conditions estimated from regional weather", "simulated": "based on simulated readings",
          "none": "no condition data", "manual": "few measured readings", "sensor": "few measured readings"},
    "B": "batch details incomplete",
    "P": "model parameters are partly engineering assumptions",
    "A": "conditions outside the parameters' tested range",
}
MISSING_TEXT = {"maturity": "maturity unknown", "initial_quality": "initial quality unknown", "variety": "variety unknown", "harvest_time": "harvest time unknown"}


@dataclass
class Reading:
    ts: datetime
    temp_c: float | None
    rh: float | None
    origin: str  # manual | simulated | sensor


def clean_readings(readings: list[Reading], harvest: datetime, now: datetime):
    """Sort, de-duplicate by timestamp, drop impossible values and readings outside [harvest, now]."""
    excluded = 0
    seen = {}
    for r in readings:
        bad = (r.ts < harvest or r.ts > now or r.temp_c is None or not (-10 <= r.temp_c <= 60)
               or (r.rh is not None and not (0 <= r.rh <= 100)))
        if bad:
            excluded += 1
            continue
        if r.ts in seen:
            excluded += 1  # duplicate timestamp: keep the first
            continue
        seen[r.ts] = r
    return [seen[k] for k in sorted(seen)], excluded


def category(score: float) -> str:
    if score >= 75:
        return "HIGH"
    if score >= 50:
        return "MEDIUM"
    if score >= 30:
        return "LOW"
    return "INSUFFICIENT"


def compute_confidence(readings: list[Reading], harvest: datetime, now: datetime, *, weather_available: bool,
                       known: dict, parameter_quality: float, applicability: float):
    if harvest is None:
        raise ValueError("harvest time is required")
    hours_since = (now - harvest).total_seconds() / 3600.0
    if hours_since <= 0:
        raise ValueError("harvest time cannot be in the future")
    clean, excluded = clean_readings(readings, harvest, now)
    n = len(clean)
    if n == 0:
        C = D = F = 0.0
    else:
        span = (clean[-1].ts - clean[0].ts).total_seconds() / 3600.0
        if span <= 0:
            C = D = 0.0
        else:
            C = min(1.0, span / hours_since)
            gaps = [(b.ts - a.ts).total_seconds() / 3600.0 for a, b in zip(clean[:-1], clean[1:])]
            D = max(0.0, 1.0 - max(gaps) / span)
        age = (now - clean[-1].ts).total_seconds() / 3600.0
        F = 1.0 if age < 1 else max(0.0, 1.0 - (age - 1) / 23.0)
    if n:
        src = clean[-1].origin if clean[-1].origin in SOURCE_SCORE else "simulated"
    else:
        src = "weather" if weather_available else "none"
    S = SOURCE_SCORE[src]
    if n:
        # readings without humidity: humidity is unknown, never invented -> lower measurement-source score
        with_rh = sum(1 for r in clean if r.rh is not None) / n
        S *= max(0.5, with_rh)
    keys = ["maturity", "initial_quality", "variety", "harvest_time"]
    B = sum(1 for k in keys if known.get(k)) / len(keys)
    factors = {"C": C, "D": D, "F": F, "S": S, "B": B, "P": parameter_quality, "A": applicability}
    score = 100.0 * sum(WEIGHTS[k] * v for k, v in factors.items())
    all_sim = n > 0 and all(r.origin == "simulated" for r in clean)
    capped = False
    if all_sim and score > SIMULATED_CAP:
        score, capped = SIMULATED_CAP, True
    # two lowest-scoring factors (weighted shortfall) as the plain-language reason
    shortfall = sorted(((WEIGHTS[k] * (1 - v), k) for k, v in factors.items()), reverse=True)
    reasons = []
    if n == 0:
        # no readings at all: coverage/density/freshness are zero because of the source, so name the source
        reasons.append(FACTOR_TEXT["S"][src])
        shortfall = [x for x in shortfall if x[1] not in ("C", "D", "F", "S")]
    for _, k in shortfall:
        if len(reasons) == 2:
            break
        if factors[k] >= 0.999:
            continue
        if k == "S":
            reasons.append(FACTOR_TEXT["S"][src])
        elif k == "B":
            missing = [MISSING_TEXT[x] for x in keys if not known.get(x)]
            reasons.append("; ".join(missing) if missing else FACTOR_TEXT["B"])
        else:
            reasons.append(FACTOR_TEXT[k])
    if capped:
        reasons = ["based on simulated readings (capped at MEDIUM)"] + [r for r in reasons if "simulated" not in r][:1]
    cat = category(score)
    return {"score": round(score, 1), "category": cat, "factors": {k: round(v, 3) for k, v in factors.items()},
            "weights": WEIGHTS, "reasons": reasons, "source": src, "n_readings": n, "excluded_readings": excluded,
            "capped_simulated": capped, "label": "Data-quality index (0-100), not a calibrated probability",
            "text": f"{cat} ({score:.0f})" + (": " + "; ".join(reasons) if reasons else "")}


def applicability_score(p, temps) -> float:
    """1 inside the source data's temperature range, 0.5 if mildly outside (<= 5 degC), 0 if far outside."""
    import numpy as np
    temps = np.asarray(temps, dtype=float)
    if temps.size == 0:
        return 1.0
    lo, hi = p.v("t_app_low"), p.v("t_app_high")
    excess = float(max(0.0, lo - temps.min(), temps.max() - hi))
    if excess <= 0:
        return 1.0
    return 0.5 if excess <= 5 else 0.0
