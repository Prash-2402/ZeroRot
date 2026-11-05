"""Open-Meteo weather + geocoding (no key). Returns LIVE data with retrieval time, or raises Unavailable."""
from __future__ import annotations

from datetime import datetime, timezone

import httpx

from app.core.config import settings


class Unavailable(Exception):
    pass


def geocode(query: str, count: int = 6) -> list[dict]:
    try:
        r = httpx.get(settings.geocoding_url, params={"name": query, "count": count, "language": "en", "format": "json"}, timeout=8)
        r.raise_for_status()
    except httpx.HTTPError as e:
        raise Unavailable(f"Geocoding service unreachable ({type(e).__name__})")
    return [{"name": x["name"], "admin1": x.get("admin1"), "country": x.get("country"), "lat": x["latitude"], "lng": x["longitude"],
             "elevation": x.get("elevation")} for x in r.json().get("results", [])]


def forecast(lat: float, lng: float, days: int = 16, name: str | None = None) -> dict:
    """Hourly temperature (degC), relative humidity (%) and surface pressure (Pa) from now through `days` days."""
    try:
        r = httpx.get(settings.open_meteo_url, params={"latitude": lat, "longitude": lng, "hourly": "temperature_2m,relative_humidity_2m,surface_pressure",
                                                       "current": "temperature_2m,relative_humidity_2m,surface_pressure", "forecast_days": min(16, days),
                                                       "past_days": 1, "timezone": "UTC"}, timeout=10)
        r.raise_for_status()
        j = r.json()
    except httpx.HTTPError as e:
        raise Unavailable(f"Open-Meteo unreachable ({type(e).__name__})")
    h = j.get("hourly") or {}
    times, t, rh, p = [], [], [], []
    for ts, a, b, c in zip(h.get("time", []), h.get("temperature_2m", []), h.get("relative_humidity_2m", []), h.get("surface_pressure", [])):
        if a is None or b is None or c is None:
            continue   # never fill gaps with invented values
        times.append(datetime.fromisoformat(ts).replace(tzinfo=timezone.utc).timestamp())
        t.append(float(a)); rh.append(float(b)); p.append(float(c) * 100.0)
    if not times:
        raise Unavailable("Open-Meteo returned no usable hourly data")
    cur = j.get("current") or {}
    return {"source": "Open-Meteo forecast API", "status": "live", "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "lat": lat, "lng": lng, "name": name, "elevation": j.get("elevation"),
            "current": {"temperature_c": cur.get("temperature_2m"), "rh_pct": cur.get("relative_humidity_2m"),
                        "pressure_pa": cur.get("surface_pressure") * 100 if cur.get("surface_pressure") else None, "time": cur.get("time")},
            "times": times, "t": t, "rh": rh, "p": p}


def series_point(fc: dict) -> dict:
    return {"name": fc.get("name"), "lat": fc["lat"], "lng": fc["lng"], "times": fc["times"], "t": fc["t"], "rh": fc["rh"], "p": fc["p"]}
