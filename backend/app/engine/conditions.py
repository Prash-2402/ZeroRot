"""Builds hourly temperature / humidity series for the decay engine from a storage or transport plan.

Storage environment rule: refrigerated storage and reefers use the setpoint (or the simulated feed);
open sheds use regional weather, which is an ESTIMATE of shed conditions, never a measured reading.
"""
from __future__ import annotations

import json
import math
import pathlib
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache

import numpy as np

SEED_DIR = pathlib.Path(__file__).resolve().parents[3] / "data" / "seed"
REEFER_TAU_H = 1.5  # engineering assumption: cargo air approaches ambient with ~1.5 h time constant after unit failure


class WeatherStore:
    """Hourly weather keyed by point id. Values come from the cached Open-Meteo file (or a live refresh)."""

    def __init__(self, payload: dict, origin: str = "cached"):
        self.origin = origin
        self.retrieved_at = payload.get("retrieved_at")
        self.points: dict[str, dict] = {}
        for pid, d in payload.get("points", {}).items():
            times = [datetime.fromisoformat(t) for t in d["time"]]
            t = np.array([np.nan if v is None else v for v in d["temp_c"]], dtype=float)
            rh = np.array([np.nan if v is None else v for v in d["rh"]], dtype=float)
            idx = {tm: i for i, tm in enumerate(times)}
            hours = np.array([tm.hour for tm in times])
            prof_t = np.array([np.nanmean(t[hours == h]) for h in range(24)])
            prof_rh = np.array([np.nanmean(rh[hours == h]) for h in range(24)])
            self.points[pid] = {"idx": idx, "t": t, "rh": rh, "prof_t": prof_t, "prof_rh": prof_rh}
        self.coords: dict[str, tuple[float, float]] = {}

    def set_coords(self, coords: dict[str, tuple[float, float]]):
        self.coords = {k: v for k, v in coords.items() if k in self.points}

    def nearest(self, lat: float, lng: float) -> str:
        best, bd = None, 1e18
        for pid, (a, b) in self.coords.items():
            d = (a - lat) ** 2 + ((b - lng) * math.cos(math.radians(lat))) ** 2
            if d < bd:
                best, bd = pid, d
        return best or next(iter(self.points))

    def at(self, pid: str, when: datetime) -> tuple[float, float, bool]:
        """(temp, rh, from_cache). Falls back to the mean diurnal profile outside the cached window."""
        p = self.points.get(pid) or next(iter(self.points.values()))
        key = when.replace(minute=0, second=0, microsecond=0)
        i = p["idx"].get(key)
        if i is not None and not math.isnan(p["t"][i]) and not math.isnan(p["rh"][i]):
            # linear interpolation inside the hour for smooth ticks
            j = p["idx"].get(key + timedelta(hours=1))
            f = when.minute / 60.0
            if j is not None and not math.isnan(p["t"][j]):
                return (p["t"][i] * (1 - f) + p["t"][j] * f, p["rh"][i] * (1 - f) + p["rh"][j] * f, True)
            return float(p["t"][i]), float(p["rh"][i]), True
        h = key.hour
        return float(p["prof_t"][h]), float(p["prof_rh"][h]), False

    def series(self, pid: str, start: datetime, hours: int):
        t = np.empty(hours); rh = np.empty(hours)
        for k in range(hours):
            t[k], rh[k], _ = self.at(pid, start + timedelta(hours=k))
        return t, rh


@lru_cache(maxsize=1)
def cached_weather() -> WeatherStore:
    f = SEED_DIR / "weather_cache.json"
    payload = json.loads(f.read_text()) if f.exists() else {"points": {}}
    ws = WeatherStore(payload, "cached")
    loc = json.loads((SEED_DIR / "locations.json").read_text())
    coords = {d["id"]: (d["lat"], d["lng"]) for d in loc["districts"] + loc["mandis"]}
    ws.set_coords(coords)
    return ws


@dataclass
class Segment:
    """One piece of a storage/transport plan.
    kind: 'setpoint' (cold storage / working reefer), 'weather' (open shed / ambient truck / mandi yard),
          'reefer_failed' (temperature relaxes from t0 toward ambient), 'constant' (what-if override).
    """
    kind: str
    hours: int
    t: float | None = None
    rh: float | None = None
    point: str | None = None
    bias_t: float = 0.0
    bias_rh: float = 0.0
    t0: float | None = None


def build_series(segments: list[Segment], start: datetime, weather: WeatherStore):
    ts, rhs = [], []
    cursor = start
    for s in segments:
        if s.hours <= 0:
            continue
        if s.kind in ("setpoint", "constant"):
            ts.append(np.full(s.hours, float(s.t))); rhs.append(np.full(s.hours, float(s.rh)))
        elif s.kind == "weather":
            t, rh = weather.series(s.point, cursor, s.hours)
            ts.append(t + s.bias_t); rhs.append(np.clip(rh + s.bias_rh, 5, 100))
        elif s.kind == "reefer_failed":
            amb_t, amb_rh = weather.series(s.point, cursor, s.hours)
            k = np.arange(s.hours) + 0.5
            frac = np.exp(-k / REEFER_TAU_H)
            # closed box with a dead unit: approaches ambient (+2 degC solar/cargo heat), humidity stays high
            t = (amb_t + 2.0) + (float(s.t0) - (amb_t + 2.0)) * frac
            ts.append(t); rhs.append(np.clip(np.maximum(amb_rh, 92.0), 0, 100))
        else:
            raise ValueError(f"unknown segment kind {s.kind}")
        cursor = cursor + timedelta(hours=s.hours)
    if not ts:
        return np.array([]), np.array([])
    return np.concatenate(ts), np.concatenate(rhs)
