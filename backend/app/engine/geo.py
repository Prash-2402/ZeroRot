"""Road distance/time lookups from the cached OSRM table, with a labelled straight-line fallback."""
from __future__ import annotations

import json
import math
import pathlib
from functools import lru_cache

SEED_DIR = pathlib.Path(__file__).resolve().parents[3] / "data" / "seed"


def haversine_km(a, b):
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


@lru_cache(maxsize=1)
def locations() -> dict:
    return json.loads((SEED_DIR / "locations.json").read_text())


@lru_cache(maxsize=1)
def points() -> dict:
    loc = locations()
    out = {}
    for kind, key in (("district", "districts"), ("mandi", "mandis"), ("cold_storage", "cold_storages")):
        for x in loc[key]:
            out[x["id"]] = {**x, "kind": kind}
    return out


@lru_cache(maxsize=1)
def _table():
    f = SEED_DIR / "distance_table.json"
    if not f.exists():
        return None
    t = json.loads(f.read_text())
    t["index"] = {k: i for i, k in enumerate(t["ids"])}
    return t


@lru_cache(maxsize=1)
def routes() -> dict:
    f = SEED_DIR / "routes_cache.json"
    return json.loads(f.read_text())["routes"] if f.exists() else {}


def travel(src, dst: str, speed_factor: float = 1.0):
    """src: point id or (lat, lng). Returns dict(km, hours, source)."""
    t = _table()
    if isinstance(src, str) and t and src in t["index"] and dst in t["index"]:
        i, j = t["index"][src], t["index"][dst]
        d, s = t["distance_m"][i][j], t["duration_s"][i][j]
        if d is not None and s is not None:
            return {"km": d / 1000.0, "hours": s / 3600.0 * speed_factor + 0.5, "source": "osrm_cached"}
    a = (points()[src]["lat"], points()[src]["lng"]) if isinstance(src, str) else src
    b = (points()[dst]["lat"], points()[dst]["lng"])
    km = haversine_km(a, b) * 1.3
    return {"km": km, "hours": km / 45.0 * speed_factor + 0.5, "source": "straight_line_estimate"}


def route_geometry(src: str, dst: str):
    r = routes().get(f"{src}__{dst}")
    return r
