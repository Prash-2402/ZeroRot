"""Reverse geocoding for route checkpoints (OpenStreetMap Nominatim, light use: cached, <= 1 request/s,
identifying User-Agent as required by the Nominatim usage policy)."""
from __future__ import annotations

import threading
import time

import httpx

_cache: dict[tuple[float, float], str | None] = {}
_cache2: dict[tuple[float, float], dict] = {}
_lock = threading.Lock()
_last = [0.0]
UA = "ZeroRot/2.0 (post-harvest digital twin; hackathon prototype)"


def reverse(lat: float, lng: float) -> str | None:
    key = (round(lat, 2), round(lng, 2))
    if key in _cache:
        return _cache[key]
    with _lock:
        wait = 1.1 - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            r = httpx.get("https://nominatim.openstreetmap.org/reverse", params={"lat": lat, "lon": lng, "format": "jsonv2", "zoom": 14},
                          headers={"User-Agent": UA}, timeout=8)
            r.raise_for_status()
            a = r.json().get("address", {})
            name = (a.get("village") or a.get("hamlet") or a.get("town") or a.get("suburb") or a.get("city") or a.get("county")
                    or a.get("state_district"))
        except (httpx.HTTPError, ValueError):
            name = None
    _cache[key] = name
    return name


def reverse_names(lat: float, lng: float) -> dict:
    """{"en": name, "kn": Kannada name or None} for the place at (lat, lng), from OpenStreetMap name / name:kn tags."""
    key = (round(lat, 2), round(lng, 2))
    if key in _cache2:
        return _cache2[key]
    with _lock:
        wait = 1.1 - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            r = httpx.get("https://nominatim.openstreetmap.org/reverse", params={"lat": lat, "lon": lng, "format": "jsonv2", "zoom": 14, "namedetails": 1},
                          headers={"User-Agent": UA}, timeout=8)
            r.raise_for_status()
            j = r.json()
            a, nd = j.get("address", {}), j.get("namedetails") or {}
            en = j.get("name") or a.get("village") or a.get("hamlet") or a.get("town") or a.get("suburb") or a.get("city") or a.get("county")
            out = {"en": nd.get("name:en") or en, "kn": nd.get("name:kn")}
        except (httpx.HTTPError, ValueError):
            out = {"en": None, "kn": None}
    _cache2[key] = out
    return out
