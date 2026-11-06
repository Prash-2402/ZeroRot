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


_FC_CACHE: dict = {}
FORECAST_TTL_S = 600


def forecast(lat: float, lng: float, days: int = 16, name: str | None = None) -> dict:
    """Hourly forecast, cached for 10 minutes per place so starting a lot or a truck never waits on the network twice."""
    import time as _t
    key = (round(lat, 3), round(lng, 3), min(16, days))
    hit = _FC_CACHE.get(key)
    if hit and _t.time() - hit[0] < FORECAST_TTL_S:
        return {**hit[1], "name": name}
    out = _forecast(lat, lng, days, name)
    _FC_CACHE[key] = (_t.time(), out)
    return out


def _forecast(lat: float, lng: float, days: int = 16, name: str | None = None) -> dict:
    """Hourly temperature (degC), relative humidity (%) and surface pressure (Pa) from now through `days` days."""
    try:
        r = httpx.get(settings.open_meteo_url, params={"latitude": lat, "longitude": lng, "hourly": "temperature_2m,relative_humidity_2m,surface_pressure,precipitation,cloud_cover",
                                                       "current": "temperature_2m,relative_humidity_2m,surface_pressure", "forecast_days": min(16, days),
                                                       "past_days": 1, "timezone": "UTC"}, timeout=10)
        r.raise_for_status()
        j = r.json()
    except httpx.HTTPError as e:
        raise Unavailable(f"Open-Meteo unreachable ({type(e).__name__})")
    h = j.get("hourly") or {}
    times, t, rh, p, pr, cc = [], [], [], [], [], []
    n = len(h.get("time", []))
    precip, cloud = h.get("precipitation") or [None] * n, h.get("cloud_cover") or [None] * n
    for ts, a, b, c, d, e in zip(h.get("time", []), h.get("temperature_2m", []), h.get("relative_humidity_2m", []), h.get("surface_pressure", []), precip, cloud):
        if a is None or b is None or c is None:
            continue   # never fill gaps with invented values
        times.append(datetime.fromisoformat(ts).replace(tzinfo=timezone.utc).timestamp())
        t.append(float(a)); rh.append(float(b)); p.append(float(c) * 100.0)
        pr.append(None if d is None else float(d)); cc.append(None if e is None else float(e))
    if not times:
        raise Unavailable("Open-Meteo returned no usable hourly data")
    cur = j.get("current") or {}
    return {"source": "Open-Meteo forecast API", "status": "live", "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "lat": lat, "lng": lng, "name": name, "elevation": j.get("elevation"),
            "current": {"temperature_c": cur.get("temperature_2m"), "rh_pct": cur.get("relative_humidity_2m"),
                        "pressure_pa": cur.get("surface_pressure") * 100 if cur.get("surface_pressure") else None, "time": cur.get("time")},
            "times": times, "t": t, "rh": rh, "p": p, "precip_mm": pr, "cloud_pct": cc}


def series_point(fc: dict) -> dict:
    return {"name": fc.get("name"), "lat": fc["lat"], "lng": fc["lng"], "times": fc["times"], "t": fc["t"], "rh": fc["rh"], "p": fc["p"],
            "precip_mm": fc.get("precip_mm"), "cloud_pct": fc.get("cloud_pct")}


ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"


def history(lat: float, lng: float, days: int) -> dict:
    """Hourly observed/reanalysis temperature and RH for the last `days` days (up to ~1 year).
    Recent 90 days come from the forecast API's past_days; older hours from the Open-Meteo historical archive."""
    from datetime import date, timedelta
    days = max(1, min(366, int(days)))
    times, t, rh = [], [], []

    def take(j):
        h = j.get("hourly") or {}
        for ts, a, b in zip(h.get("time", []), h.get("temperature_2m", []), h.get("relative_humidity_2m", [])):
            if a is None or b is None:
                continue
            times.append(datetime.fromisoformat(ts).replace(tzinfo=timezone.utc).timestamp()); t.append(float(a)); rh.append(float(b))
    try:
        if days > 90:
            end = date.today() - timedelta(days=91)
            start = date.today() - timedelta(days=days)
            r = httpx.get(ARCHIVE_URL, params={"latitude": lat, "longitude": lng, "start_date": start.isoformat(), "end_date": end.isoformat(),
                                               "hourly": "temperature_2m,relative_humidity_2m", "timezone": "UTC"}, timeout=20)
            r.raise_for_status()
            take(r.json())
        r = httpx.get(settings.open_meteo_url, params={"latitude": lat, "longitude": lng, "hourly": "temperature_2m,relative_humidity_2m",
                                                       "past_days": min(days, 90) + 1, "forecast_days": 1, "timezone": "UTC"}, timeout=15)
        r.raise_for_status()
        take(r.json())
    except httpx.HTTPError as e:
        raise Unavailable(f"Weather history unreachable ({type(e).__name__})")
    now = datetime.now(timezone.utc).timestamp()
    rows = sorted({ts: (a, b) for ts, a, b in zip(times, t, rh) if now - days * 86400 <= ts <= now}.items())
    if len(rows) < days * 12:
        raise Unavailable("Not enough weather history for that period")
    return {"source": "Open-Meteo (forecast past_days + historical archive)", "times": [x[0] for x in rows],
            "t": [x[1][0] for x in rows], "rh": [x[1][1] for x in rows]}


def daily(lat: float, lng: float, days_back: int = 400, days_ahead: int = 16) -> dict:
    """Daily rainfall (mm) and maximum temperature (degC), observed for the past `days_back` days (Open-Meteo historical
    archive, which lags about 5 days, plus the forecast API's recent past) and forecast for the next `days_ahead` days.
    Returns {"source", "days": {date: (rain_mm, tmax_c)}} using Indian local dates."""
    from datetime import date, timedelta
    out: dict = {}

    def take(j):
        d = j.get("daily") or {}
        for ts, rain, tmax in zip(d.get("time", []), d.get("precipitation_sum", []), d.get("temperature_2m_max", [])):
            if rain is None or tmax is None:
                continue
            out[date.fromisoformat(ts)] = (float(rain), float(tmax))
    try:
        today = date.today()
        r = httpx.get(ARCHIVE_URL, params={"latitude": lat, "longitude": lng, "start_date": (today - timedelta(days=days_back)).isoformat(),
                                           "end_date": (today - timedelta(days=6)).isoformat(), "daily": "precipitation_sum,temperature_2m_max",
                                           "timezone": "Asia/Kolkata"}, timeout=25)
        r.raise_for_status()
        take(r.json())
        r = httpx.get(settings.open_meteo_url, params={"latitude": lat, "longitude": lng, "daily": "precipitation_sum,temperature_2m_max",
                                                       "past_days": 10, "forecast_days": min(16, days_ahead), "timezone": "Asia/Kolkata"}, timeout=15)
        r.raise_for_status()
        take(r.json())
    except httpx.HTTPError as e:
        raise Unavailable(f"Weather history unreachable ({type(e).__name__})")
    if len(out) < 30:
        raise Unavailable("Not enough daily weather data")
    return {"source": "Open-Meteo (historical archive + 16-day forecast)", "days": out}
