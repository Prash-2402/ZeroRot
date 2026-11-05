"""OSRM routing (public demo server by default). No hardcoded distances or times."""
from __future__ import annotations

from datetime import datetime, timezone

import httpx

from app.core.config import settings


class Unavailable(Exception):
    pass


def route(origin: tuple[float, float], dest: tuple[float, float]) -> dict:
    """origin/dest = (lat, lng). Returns distance (m), duration (s), simplified geometry [[lng, lat], ...]."""
    url = f"{settings.osrm_url}/route/v1/driving/{origin[1]},{origin[0]};{dest[1]},{dest[0]}"
    try:
        r = httpx.get(url, params={"overview": "full", "geometries": "geojson"}, timeout=12)
        r.raise_for_status()
        j = r.json()
    except httpx.HTTPError as e:
        raise Unavailable(f"Routing service unreachable ({type(e).__name__})")
    if j.get("code") != "Ok" or not j.get("routes"):
        raise Unavailable(f"No route found ({j.get('code')})")
    rt = j["routes"][0]
    coords = rt["geometry"]["coordinates"]
    step = max(1, len(coords) // 400)
    geom = coords[::step]
    if geom[-1] != coords[-1]:
        geom.append(coords[-1])
    return {"distance_m": rt["distance"], "duration_s": rt["duration"], "geometry": [[round(x, 5), round(y, 5)] for x, y in geom],
            "source": "osrm_live", "provider": settings.osrm_url, "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def points_along(geometry: list, n: int = 3) -> list[tuple[float, float]]:
    """Evenly spaced (lat, lng) points along the route for weather sampling."""
    if len(geometry) < 2:
        return [(geometry[0][1], geometry[0][0])] * n
    idx = [round(i * (len(geometry) - 1) / (n - 1)) for i in range(n)]
    return [(geometry[i][1], geometry[i][0]) for i in idx]
