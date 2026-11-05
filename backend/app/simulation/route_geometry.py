"""Distance-accurate helpers for road geometry ([[lng, lat], ...] as returned by OSRM)."""
from __future__ import annotations

import math
from bisect import bisect_right

R_EARTH = 6371008.8


def haversine_m(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lng - a_lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_EARTH * math.asin(min(1.0, math.sqrt(h)))


def cumulative_m(geom: list) -> list[float]:
    out = [0.0]
    for (x0, y0), (x1, y1) in zip(geom, geom[1:]):
        out.append(out[-1] + haversine_m(y0, x0, y1, x1))
    return out


def point_at(geom: list, cum: list[float], dist_m: float) -> tuple[float, float, float]:
    """(lat, lng, heading_deg) at a distance along the polyline. The polyline length is scaled to the OSRM road distance
    by the caller, so `dist_m` is in polyline metres."""
    if not geom:
        raise ValueError("empty geometry")
    if len(geom) == 1:
        return geom[0][1], geom[0][0], 0.0
    d = max(0.0, min(cum[-1], dist_m))
    i = max(1, min(len(cum) - 1, bisect_right(cum, d)))
    seg = cum[i] - cum[i - 1]
    f = 0.0 if seg <= 0 else (d - cum[i - 1]) / seg
    (x0, y0), (x1, y1) = geom[i - 1], geom[i]
    lat, lng = y0 + (y1 - y0) * f, x0 + (x1 - x0) * f
    heading = math.degrees(math.atan2((x1 - x0) * math.cos(math.radians(lat)), y1 - y0)) % 360
    return lat, lng, heading


def nearest_distance_along(geom: list, cum: list[float], lat: float, lng: float) -> float:
    """Distance along the polyline of the vertex closest to (lat, lng)."""
    best, best_d = 0, float("inf")
    for i, (x, y) in enumerate(geom):
        d = haversine_m(lat, lng, y, x)
        if d < best_d:
            best, best_d = i, d
    return cum[best]


def slice_from(geom: list, cum: list[float], dist_m: float) -> list:
    """Remaining polyline starting at `dist_m`."""
    lat, lng, _ = point_at(geom, cum, dist_m)
    i = bisect_right(cum, dist_m)
    return [[round(lng, 6), round(lat, 6)]] + [list(p) for p in geom[i:]]
