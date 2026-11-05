"""Route geometry helpers: position along a route, cumulative distances, rerouting legs."""
from __future__ import annotations

import json
import math
import pathlib
from functools import lru_cache

from app.engine.geo import haversine_km, points, routes

SEED_DIR = pathlib.Path(__file__).resolve().parents[3] / "data" / "seed"


def cumulative_km(coords: list) -> list[float]:
    out = [0.0]
    for a, b in zip(coords[:-1], coords[1:]):
        out.append(out[-1] + haversine_km((a[1], a[0]), (b[1], b[0])))
    return out


_cum_cache: dict = {}


def position(route: list, frac: float):
    """(lng, lat, heading_deg) at a fraction of the route length."""
    key = (id(route), len(route))
    if key not in _cum_cache:
        _cum_cache.clear() if len(_cum_cache) > 500 else None
        _cum_cache[key] = cumulative_km(route)
    cum = _cum_cache[key]
    total = cum[-1]
    if total <= 0 or len(route) < 2:
        return route[0][0], route[0][1], 0.0
    target = max(0.0, min(1.0, frac)) * total
    lo, hi = 0, len(cum) - 1
    while lo < hi - 1:
        mid = (lo + hi) // 2
        if cum[mid] <= target:
            lo = mid
        else:
            hi = mid
    seg = cum[hi] - cum[lo]
    f = (target - cum[lo]) / seg if seg > 0 else 0.0
    a, b = route[lo], route[hi]
    lng = a[0] + (b[0] - a[0]) * f
    lat = a[1] + (b[1] - a[1]) * f
    heading = math.degrees(math.atan2(b[0] - a[0], b[1] - a[1]))
    return lng, lat, heading


def lane_route(src: str, dst: str):
    r = routes().get(f"{src}__{dst}")
    if r:
        return r["coords"], r["distance_m"], r["duration_s"], "osrm_cached"
    a, b = points()[src], points()[dst]
    km = haversine_km((a["lat"], a["lng"]), (b["lat"], b["lng"])) * 1.3
    return [[a["lng"], a["lat"]], [b["lng"], b["lat"]]], km * 1000, km / 45 * 3600, "straight_line_estimate"


@lru_cache(maxsize=1)
def reroute_cache():
    f = SEED_DIR / "reroutes_cache.json"
    return json.loads(f.read_text()) if f.exists() else {"waypoints": []}


def cached_leg(lat: float, lng: float, target: str, max_snap_km: float = 12.0):
    """Nearest pre-fetched road route from a point on the Scenario 2 route to a rescue target."""
    best, bd = None, 1e9
    for wp in reroute_cache().get("waypoints", []):
        d = haversine_km((lat, lng), (wp["lat"], wp["lng"]))
        if d < bd and target in wp["routes"]:
            best, bd = wp, d
    if best is None or bd > max_snap_km:
        return None
    r = best["routes"][target]
    coords = [[lng, lat]] + r["coords"]
    return {"coords": coords, "distance_m": r["distance_m"] + bd * 1000, "duration_s": r["duration_s"] + bd / 40 * 3600, "source": "osrm_cached"}


def straight_leg(lat: float, lng: float, target: str):
    t = points()[target]
    km = haversine_km((lat, lng), (t["lat"], t["lng"])) * 1.3
    return {"coords": [[lng, lat], [t["lng"], t["lat"]]], "distance_m": km * 1000, "duration_s": km / 45 * 3600,
            "source": "straight_line_estimate"}


def remaining_route(route: list, frac: float) -> list:
    lng, lat, _ = position(route, frac)
    cum = _cum_cache.get((id(route), len(route))) or cumulative_km(route)
    target = frac * cum[-1]
    rest = [c for c, d in zip(route, cum) if d > target]
    return [[lng, lat]] + rest
