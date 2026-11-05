"""Provider interfaces for DEMO and REAL modes. Each integration has a demo provider and a real provider.

| Integration    | Demo provider              | Real provider        |
| Mandi          | CachedMandiProvider        | LiveMandiProvider    |
| Weather        | CachedWeatherProvider      | OpenMeteoProvider    |
| Routes         | CachedRouteProvider        | OSRMProvider         |
| AI             | RuleBasedWorkflowProvider  | GroqProvider         |
| Transport feed | SimulatedTransportProvider | FutureIoTProvider    |
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

import httpx

from app.core.config import settings
from app.engine.conditions import WeatherStore, cached_weather
from app.engine.geo import locations

log = logging.getLogger("zerorot.providers")


# ---------------- weather ----------------
class CachedWeatherProvider:
    name = "CachedWeatherProvider"

    def store(self) -> WeatherStore:
        return cached_weather()

    def check(self):
        ws = cached_weather()
        return "demo", f"Open-Meteo forecast cached at {ws.retrieved_at[:16] if ws.retrieved_at else 'unknown'} (real data, cached)"


class OpenMeteoProvider:
    name = "OpenMeteoProvider"

    def fetch(self) -> WeatherStore:
        loc = locations()
        pts = {d["id"]: d for d in loc["districts"] + loc["mandis"]}
        ids = list(pts)
        r = httpx.get(settings.open_meteo_url, params={
            "latitude": ",".join(str(pts[i]["lat"]) for i in ids), "longitude": ",".join(str(pts[i]["lng"]) for i in ids),
            "hourly": "temperature_2m,relative_humidity_2m", "past_days": 7, "forecast_days": 7, "timezone": "Asia/Kolkata"}, timeout=8)
        r.raise_for_status()
        data = r.json()
        data = data if isinstance(data, list) else [data]
        payload = {"retrieved_at": datetime.now().isoformat(), "points": {}}
        for pid, d in zip(ids, data):
            h = d["hourly"]
            payload["points"][pid] = {"time": h["time"], "temp_c": h["temperature_2m"], "rh": h["relative_humidity_2m"]}
        ws = WeatherStore(payload, "external_api")
        ws.set_coords({k: (v["lat"], v["lng"]) for k, v in pts.items()})
        return ws


# ---------------- mandi ----------------
class CachedMandiProvider:
    name = "CachedMandiProvider"

    def check(self):
        return "demo", "SIMULATED price history (no data.gov.in key configured). Labelled SIMULATED everywhere."


class LiveMandiProvider:
    name = "LiveMandiProvider"
    COMMODITY = {"tomato": "Tomato", "mango": "Mango", "banana": "Banana"}

    def configured(self):
        return bool(settings.data_gov_api_key)

    def fetch(self) -> list[dict]:
        """Latest Agmarknet records for Karnataka. Returns normalised rows (Rs/quintal) with origin external_api."""
        out = []
        for key, name in self.COMMODITY.items():
            r = httpx.get(f"https://api.data.gov.in/resource/{settings.agmarknet_resource_id}", params={
                "api-key": settings.data_gov_api_key, "format": "json", "limit": 500,
                "filters[state.keyword]": "Karnataka", "filters[commodity]": name}, timeout=8)
            r.raise_for_status()
            for rec in r.json().get("records", []):
                out.append({"commodity": key, "market": rec.get("market"), "variety": rec.get("variety"),
                            "date": rec.get("arrival_date"), "min": rec.get("min_price"), "max": rec.get("max_price"),
                            "modal": rec.get("modal_price")})
        return out


# ---------------- routes ----------------
class CachedRouteProvider:
    name = "CachedRouteProvider"

    def check(self):
        return "demo", "OSRM road routes cached from the public server (real geometry, cached)"


class OSRMProvider:
    name = "OSRMProvider"

    def route(self, a: tuple, b: tuple):
        r = httpx.get(f"{settings.osrm_url}/route/v1/driving/{a[1]},{a[0]};{b[1]},{b[0]}",
                      params={"overview": "full", "geometries": "geojson"}, timeout=3)
        r.raise_for_status()
        rt = r.json()["routes"][0]
        coords = rt["geometry"]["coordinates"]
        step = max(1, len(coords) // 300)
        return {"coords": coords[::step] + [coords[-1]], "distance_m": rt["distance"], "duration_s": rt["duration"], "source": "osrm_live"}

    def check(self):
        try:
            r = httpx.get(f"{settings.osrm_url}/route/v1/driving/78.13,13.13;77.59,12.97", params={"overview": "false"}, timeout=3)
            return ("ok", "OSRM public server reachable") if r.status_code == 200 else ("unavailable", f"OSRM returned {r.status_code}")
        except Exception as e:
            return "unavailable", f"OSRM unreachable ({type(e).__name__})"


# ---------------- AI ----------------
class GroqProvider:
    name = "GroqProvider"

    def configured(self):
        return bool(settings.groq_api_key)

    def chat(self, messages: list, tools: list | None = None):
        body = {"model": settings.groq_model, "messages": messages, "temperature": 0.1}
        if tools:
            body["tools"] = tools
            body["tool_choice"] = "auto"
        r = httpx.post("https://api.groq.com/openai/v1/chat/completions", json=body,
                       headers={"Authorization": f"Bearer {settings.groq_api_key}"}, timeout=settings.groq_timeout)
        r.raise_for_status()
        return r.json()["choices"][0]["message"]

    def check(self):
        if not self.configured():
            return "unavailable", "GROQ_API_KEY not set: rescue runs as a Rule-Based Workflow"
        try:
            r = httpx.get("https://api.groq.com/openai/v1/models", headers={"Authorization": f"Bearer {settings.groq_api_key}"}, timeout=3)
            return ("ok", f"Groq reachable, model {settings.groq_model}") if r.status_code == 200 else ("unavailable", f"Groq returned {r.status_code}")
        except Exception as e:
            return "unavailable", f"Groq unreachable ({type(e).__name__})"


class RuleBasedWorkflowProvider:
    name = "RuleBasedWorkflowProvider"

    def check(self):
        return "demo", "Rule-Based Workflow (deterministic steps, no LLM)"


# ---------------- transport feed ----------------
class SimulatedTransportProvider:
    name = "SimulatedTransportProvider"

    def check(self):
        return "demo", "SIMULATED cold-chain feed: setpoint + noise + injected faults"


class FutureIoTProvider:
    """Interface for real hardware (ESP32 / LoRa / reefer telematics). Not implemented in this build.

    A real device would POST readings to /api/v1/batches/{id}/readings with origin='sensor':
        {"ts": "2026-11-05T10:15", "temperature": 12.7, "humidity": 91, "origin": "sensor"}
    and GPS fixes to a future /api/v1/trips/{id}/position endpoint. The decay engine already consumes
    readings by origin, so no engine change is needed; confidence treats 'sensor' as a measured source.
    """
    name = "FutureIoTProvider"

    def check(self):
        return "unavailable", "Interface only (no hardware in this build)"


weather_cached, weather_live = CachedWeatherProvider(), OpenMeteoProvider()
mandi_cached, mandi_live = CachedMandiProvider(), LiveMandiProvider()
routes_cached, routes_live = CachedRouteProvider(), OSRMProvider()
ai_rules, ai_groq = RuleBasedWorkflowProvider(), GroqProvider()
transport_sim, transport_iot = SimulatedTransportProvider(), FutureIoTProvider()
