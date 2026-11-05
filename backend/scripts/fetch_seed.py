"""Fetch real external data once and cache it as dated seed JSON for DEMO MODE.

Run:  python backend/scripts/fetch_seed.py
Sources: Open-Meteo (weather), OSRM public server (routes, distance table),
Nominatim/OpenStreetMap (Karnataka state outline). Each file records retrieved_at.
Mandi prices need a data.gov.in key; without one, see seed.py (SIMULATED prices).
"""
import json
import pathlib
import sys
import time
from datetime import datetime, timezone

import httpx

ROOT = pathlib.Path(__file__).resolve().parents[2]
SEED = ROOT / "data" / "seed"
UA = {"User-Agent": "ZeroRot-hackathon-demo/0.1"}
OSRM = "https://router.project-osrm.org"


def now():
    return datetime.now(timezone.utc).isoformat()


def all_points(loc):
    pts = {}
    for d in loc["districts"]:
        pts[d["id"]] = d
    for m in loc["mandis"]:
        pts[m["id"]] = m
    for c in loc["cold_storages"]:
        pts[c["id"]] = c
    return pts


def fetch_weather(client, loc):
    out = {"source": "Open-Meteo forecast API", "url": "https://api.open-meteo.com/v1/forecast",
           "retrieved_at": now(), "origin": "cached", "points": {}}
    pts = {d["id"]: d for d in loc["districts"]}
    for m in loc["mandis"]:
        pts[m["id"]] = m
    for pid, p in pts.items():
        r = client.get("https://api.open-meteo.com/v1/forecast", params={
            "latitude": p["lat"], "longitude": p["lng"], "hourly": "temperature_2m,relative_humidity_2m",
            "past_days": 7, "forecast_days": 7, "timezone": "Asia/Kolkata"}, timeout=20)
        r.raise_for_status()
        h = r.json()["hourly"]
        out["points"][pid] = {"time": h["time"], "temp_c": h["temperature_2m"], "rh": h["relative_humidity_2m"]}
        print("weather", pid, len(h["time"]))
    (SEED / "weather_cache.json").write_text(json.dumps(out))


def fetch_table(client, loc):
    pts = all_points(loc)
    ids = list(pts)
    coords = ";".join(f"{pts[i]['lng']},{pts[i]['lat']}" for i in ids)
    r = client.get(f"{OSRM}/table/v1/driving/{coords}", params={"annotations": "duration,distance"}, timeout=40)
    r.raise_for_status()
    j = r.json()
    out = {"source": "OSRM public server table service", "retrieved_at": now(), "origin": "cached",
           "ids": ids, "duration_s": j["durations"], "distance_m": j["distances"]}
    (SEED / "distance_table.json").write_text(json.dumps(out))
    print("table", len(ids))


def route(client, a, b):
    r = client.get(f"{OSRM}/route/v1/driving/{a['lng']},{a['lat']};{b['lng']},{b['lat']}",
                   params={"overview": "full", "geometries": "geojson"}, timeout=30)
    r.raise_for_status()
    rt = r.json()["routes"][0]
    coords = rt["geometry"]["coordinates"]
    # thin to at most ~400 points to keep the payload light
    step = max(1, len(coords) // 400)
    coords = coords[::step] + ([coords[-1]] if coords[-1] != coords[::step][-1] else [])
    return {"distance_m": rt["distance"], "duration_s": rt["duration"], "coords": [[round(x, 5), round(y, 5)] for x, y in coords]}


def fetch_routes(client, loc):
    pts = all_points(loc)
    out = {"source": "OSRM public server route service", "retrieved_at": now(), "origin": "cached", "routes": {}}
    pairs = set()
    for lane in loc["lanes"]:
        pairs.add((lane["from"], lane["to"]))
    # scenario 2 reroute candidates and common district -> mandi/storage legs
    for d in ["kolar", "chikkaballapur", "tumakuru", "chitradurga", "davanagere"]:
        for t in ["cs_tumakuru", "cs_chitradurga", "cs_davanagere", "m_tumakuru", "m_chitradurga", "m_davanagere", "m_bengaluru"]:
            pairs.add((d, t))
    for a, b in sorted(pairs):
        if a == b:
            continue
        key = f"{a}__{b}"
        try:
            out["routes"][key] = route(client, pts[a], pts[b])
            print("route", key, round(out["routes"][key]["distance_m"] / 1000), "km")
        except Exception as e:  # keep going; missing routes fall back to straight-line estimates
            print("route failed", key, e)
        time.sleep(0.3)
    (SEED / "routes_cache.json").write_text(json.dumps(out))


def fetch_outline(client):
    r = client.get("https://nominatim.openstreetmap.org/search", headers=UA, params={
        "state": "Karnataka", "country": "India", "format": "geojson", "polygon_geojson": 1,
        "polygon_threshold": 0.01, "limit": 1}, timeout=40)
    r.raise_for_status()
    gj = r.json()
    gj["_meta"] = {"source": "OpenStreetMap via Nominatim (ODbL)", "retrieved_at": now(), "simplified": "polygon_threshold=0.01"}
    (SEED / "karnataka_outline.geojson").write_text(json.dumps(gj))
    print("outline features", len(gj.get("features", [])))


def main():
    loc = json.loads((SEED / "locations.json").read_text())
    with httpx.Client(headers=UA) as client:
        for name, fn in [("weather", lambda: fetch_weather(client, loc)), ("table", lambda: fetch_table(client, loc)),
                         ("routes", lambda: fetch_routes(client, loc)), ("outline", lambda: fetch_outline(client))]:
            if len(sys.argv) > 1 and name not in sys.argv[1:]:
                continue
            try:
                fn()
            except Exception as e:
                print(f"{name} FAILED: {e}")


if __name__ == "__main__":
    main()
