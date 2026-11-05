"""Numerical price forecasting from stored, verified market observations (no LLM involved).

Model: scikit-learn GradientBoostingRegressor predicting the next-day log price change from lags (1, 2, 3, 7, 14 days),
7-day rolling mean/volatility, day-of-year seasonality, weekday and an optional festival flag; forecasts are recursive.
Evaluation: walk-forward backtest on the last 20% of the series, compared with a naive persistence baseline.
Uncertainty: empirical 10th-90th percentile of backtest errors per horizon (not a guaranteed range).
Requires at least MIN_POINTS daily observations; otherwise returns status 'insufficient_data'."""
from __future__ import annotations

import json
import math
import pathlib
from datetime import date, timedelta

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor

MIN_POINTS = 60
MAX_GAP_FILL = 3
FESTIVALS = pathlib.Path(__file__).resolve().parents[3] / "data" / "market" / "festivals.json"
MODEL_NAME = "GradientBoostingRegressor (scikit-learn), lag features, recursive"


def festival_days() -> set[date]:
    if not FESTIVALS.exists():
        return set()
    try:
        return {date.fromisoformat(d) for d in json.loads(FESTIVALS.read_text()).get("dates", [])}
    except (ValueError, KeyError):
        return set()


def daily_series(rows: list[tuple[date, float]]) -> pd.Series:
    """rows: (observation date, Rs/kg). Averages same-day records; interpolates only short gaps (<= 3 days)."""
    if not rows:
        return pd.Series(dtype=float)
    df = pd.DataFrame(rows, columns=["d", "p"]).groupby("d")["p"].mean()
    df.index = pd.to_datetime(df.index)
    full = df.asfreq("D")
    full = full.interpolate(limit=MAX_GAP_FILL, limit_area="inside")
    # keep the most recent unbroken stretch
    breaks = full.isna()
    if breaks.any():
        last_break = breaks[breaks].index.max()
        full = full[full.index > last_break]
    return full.dropna()


def _features(s: pd.Series, fest: set[date]) -> pd.DataFrame:
    lp = np.log(s)
    df = pd.DataFrame({"lp": lp})
    for k in (1, 2, 3, 7, 14):
        df[f"lag{k}"] = lp.shift(k)
    df["ret1"] = lp.shift(1) - lp.shift(2)
    df["roll7"] = lp.shift(1).rolling(7).mean()
    df["vol7"] = lp.diff().shift(1).rolling(7).std()
    doy = df.index.dayofyear
    df["doy_s"], df["doy_c"] = np.sin(2 * np.pi * doy / 365.25), np.cos(2 * np.pi * doy / 365.25)
    df["dow"] = df.index.dayofweek
    df["fest"] = [1.0 if d.date() in fest else 0.0 for d in df.index]
    df["target"] = lp - lp.shift(1)
    return df


FEATS = ["lag1", "lag2", "lag3", "lag7", "lag14", "ret1", "roll7", "vol7", "doy_s", "doy_c", "dow", "fest"]


def _fit(df: pd.DataFrame) -> GradientBoostingRegressor:
    d = df.dropna()
    m = GradientBoostingRegressor(n_estimators=250, max_depth=3, learning_rate=0.05, subsample=0.9, random_state=0)
    m.fit(d[FEATS].values, d["target"].values)
    return m


def _recursive(model, history: pd.Series, horizon: int, fest: set[date]) -> list[float]:
    s = history.copy()
    out = []
    for _ in range(horizon):
        nxt = s.index[-1] + pd.Timedelta(days=1)
        ext = pd.concat([s, pd.Series([s.iloc[-1]], index=[nxt])])
        f = _features(ext, fest).iloc[-1]
        x = f[FEATS].values.astype(float)
        if np.isnan(x).any():
            step = 0.0
        else:
            step = float(model.predict(x.reshape(1, -1))[0])
        step = max(-0.25, min(0.25, step))
        val = float(s.iloc[-1] * math.exp(step))
        s = pd.concat([s, pd.Series([val], index=[nxt])])
        out.append(val)
    return out


def forecast(rows: list[tuple[date, float]], horizon: int = 14) -> dict:
    s = daily_series(rows)
    n = len(s)
    if n < MIN_POINTS:
        return {"status": "insufficient_data", "points_available": n, "points_required": MIN_POINTS,
                "message": f"Forecasting needs at least {MIN_POINTS} consecutive daily observations; {n} available."}
    fest = festival_days()
    df = _features(s, fest)
    split = max(n - max(14, n // 5), 30)
    model_bt = _fit(df.iloc[:split])
    errs = {h: [] for h in range(1, horizon + 1)}
    base = {h: [] for h in range(1, horizon + 1)}
    for origin in range(split, n - 1, 3):
        hist = s.iloc[: origin + 1]
        fc = _recursive(model_bt, hist, min(horizon, n - 1 - origin), fest)
        for h, v in enumerate(fc, start=1):
            actual = s.iloc[origin + h]
            errs[h].append(math.log(actual / v))
            base[h].append(math.log(actual / hist.iloc[-1]))
    def mape(e):
        return float(np.mean([abs(1 - math.exp(-x)) for x in e]) * 100) if e else None
    metrics = {}
    for h in (1, 7, horizon):
        if errs.get(h):
            metrics[f"h{h}"] = {"model_mape_pct": round(mape(errs[h]), 2), "naive_mape_pct": round(mape(base[h]), 2), "samples": len(errs[h])}
    model = _fit(df)
    fc = _recursive(model, s, horizon, fest)
    pts = []
    last_day = s.index[-1].date()
    for h, v in enumerate(fc, start=1):
        e = errs.get(h) or errs[max(k for k in errs if errs[k])] if any(errs.values()) else []
        lo_q, hi_q = (np.percentile(e, 10), np.percentile(e, 90)) if len(e) >= 5 else (-0.15, 0.15)
        pts.append({"date": (last_day + timedelta(days=h)).isoformat(), "price": round(v, 2),
                    "low": round(v * math.exp(lo_q), 2), "high": round(v * math.exp(hi_q), 2)})
    beats = None
    if metrics.get("h7"):
        beats = metrics["h7"]["model_mape_pct"] < metrics["h7"]["naive_mape_pct"]
    return {"status": "ok", "model": MODEL_NAME, "trained_points": n, "last_observation": last_day.isoformat(),
            "last_price": round(float(s.iloc[-1]), 2), "horizon_days": horizon, "points": pts, "metrics": metrics,
            "beats_naive_baseline_7d": beats, "festival_calendar_used": bool(fest),
            "label": "Statistical forecast with empirical uncertainty band. Not a guarantee."}
