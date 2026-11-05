"""Builds simulation configurations from database records and live weather/route data.

Traditional room defaults (engineering assumptions, overridable): wall U-values brick 2.0, mud 1.5, tin sheet 5.5 W/m2K;
structure heat capacity brick 25 MJ/K, mud 30 MJ/K, tin 3 MJ/K (for an 8 x 6 x 3.5 m room, scaled by envelope area);
natural ventilation 2 air changes/h with vents open. Cold rooms: insulated panel structure 3 MJ/K. Trucks: 0.4 MJ/K."""
from __future__ import annotations

from datetime import datetime, timezone

from app.db.models import ProduceBatch, StorageZone, TransportationRoute, Truck
from app.integrations import routing, weather
from app.simulation.engine import MAX_STORAGE_DAYS

STRUCTURES = {"brick": (2.0, 25e6), "mud": (1.5, 30e6), "tin": (5.5, 3e6)}
REF_AREA = 2 * (8 + 6) * 3.5 + 8 * 6


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0, tzinfo=None).isoformat()


def batch_block(b: ProduceBatch) -> dict:
    return {"id": b.id, "code": b.code, "commodity": b.commodity_id, "maturity": b.maturity, "quantity_kg": b.quantity_kg,
            "initial_quality": b.initial_quality}


def weather_points(points: list[tuple[float, float, str]], manual: dict | None) -> tuple[dict, str | None]:
    pts, errors = [], []
    for lat, lng, name in points:
        try:
            pts.append(weather.series_point(weather.forecast(lat, lng, name=name)))
        except weather.Unavailable as e:
            errors.append(str(e))
    if errors and not manual:
        return {}, errors[0]
    return {"source": "Open-Meteo forecast API", "status": "live" if pts else "unavailable", "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "points": pts if not errors else []}, None


def traditional(b: ProduceBatch, req: dict) -> tuple[dict, str | None]:
    lat, lng = req.get("lat", b.lat), req.get("lng", b.lng)
    if lat is None or lng is None:
        return {}, "Storage location (latitude/longitude) is required for weather"
    days = float(req.get("duration_days", 7))
    if not 0 < days <= MAX_STORAGE_DAYS:
        return {}, f"Storage duration must be between 0 and {MAX_STORAGE_DAYS} days (the live forecast window)"
    L, W, H = req.get("length_m", 8.0), req.get("width_m", 6.0), req.get("height_m", 3.5)
    u, c_ref = STRUCTURES.get(req.get("structure", "brick"), STRUCTURES["brick"])
    area = 2 * (L + W) * H + L * W
    wx, e = weather_points([(lat, lng, req.get("location_name") or b.location_name or "storage")], req.get("manual_ambient"))
    if e:
        return {}, f"Weather unavailable: {e}. Provide a manual outside temperature/humidity to continue."
    return {"start_time": now_iso(), "weather": wx, "manual_ambient": req.get("manual_ambient"), "duration_days": days, "batch": batch_block(b),
            "volume_m3": L * W * H, "ua_w_per_k": u * area, "ach": float(req.get("ach", 2.0)), "c_struct_j_per_k": c_ref * area / REF_AREA,
            "structure": req.get("structure", "brick"), "dimensions_m": [L, W, H], "location": {"name": req.get("location_name") or b.location_name, "lat": lat, "lng": lng},
            "reading_interval_s": 600, "prediction_interval_s": 3600, "auto_control": False,
            "price_per_kg": req.get("price_per_kg"), "assumptions": __doc__}, None


def cold_room(b: ProduceBatch, z: StorageZone, req: dict, setpoint: float | None, rh_setpoint: float | None) -> tuple[dict, str | None]:
    f = z.facility
    if f.lat is None or f.lng is None:
        return {}, "The cold-storage facility needs a location for ambient weather"
    days = float(req.get("duration_days", 7))
    if not 0 < days <= MAX_STORAGE_DAYS:
        return {}, f"Storage duration must be between 0 and {MAX_STORAGE_DAYS} days"
    wx, e = weather_points([(f.lat, f.lng, f.name)], req.get("manual_ambient"))
    if e:
        return {}, f"Weather unavailable: {e}. Provide a manual ambient value to continue."
    return {"start_time": now_iso(), "weather": wx, "manual_ambient": req.get("manual_ambient"), "duration_days": days, "batch": batch_block(b),
            "volume_m3": z.volume_m3, "ua_w_per_k": z.ua_w_per_k, "ach": z.air_changes_per_hour, "c_struct_j_per_k": 3e6, "cooling_kw": z.cooling_capacity_kw,
            "setpoint": setpoint if setpoint is not None else z.setpoint, "rh_setpoint": rh_setpoint if rh_setpoint is not None else z.rh_setpoint,
            "zone": {"id": z.id, "name": z.name, "facility": f.name}, "location": {"name": f.name, "lat": f.lat, "lng": f.lng},
            "reading_interval_s": 600, "prediction_interval_s": 3600, "auto_control": bool(req.get("auto_control", False)),
            "backup_cooling_available": bool(req.get("backup_cooling_available", True)), "price_per_kg": req.get("price_per_kg"),
            "storage_cost_per_kg_day": z.cost_per_kg_day}, None


def cold_chain(b: ProduceBatch, t: Truck, r: TransportationRoute, req: dict) -> tuple[dict, str | None]:
    pts = routing.points_along(r.geometry, 3)
    names = [r.origin_name, "route midpoint", r.dest_name]
    wx, e = weather_points([(lat, lng, n) for (lat, lng), n in zip(pts, names)], req.get("manual_ambient"))
    if e:
        return {}, f"Weather along the route unavailable: {e}. Provide a manual ambient value to continue."
    avg_kmh = r.distance_m / max(1.0, r.duration_s) * 3.6
    return {"start_time": now_iso(), "weather": wx, "manual_ambient": req.get("manual_ambient"), "batch": batch_block(b),
            "setpoint": float(req.get("target_temp_c", 13.0)), "rh_requirement": req.get("rh_requirement"), "cooling_kw": t.cooling_capacity_kw,
            "ua_w_per_k": t.ua_w_per_k, "cargo_volume_m3": t.cargo_volume_m3, "c_struct_j_per_k": 4e5, "ach": 0.3,
            "initial_internal_temp": req.get("initial_internal_temp"),
            "route_distance_m": r.distance_m, "route_duration_s": r.duration_s, "route_geometry": r.geometry, "route_source": r.source,
            "planned_speed_kmh": float(req.get("speed_kmh", round(avg_kmh, 1))),
            "route": {"id": r.id, "origin": r.origin_name, "dest": r.dest_name, "distance_km": round(r.distance_m / 1000, 1),
                      "osrm_duration_h": round(r.duration_s / 3600, 2)},
            "truck": {"id": t.id, "code": t.code, "name": t.name}, "reading_interval_s": 300, "prediction_interval_s": 1800,
            "auto_control": bool(req.get("auto_control", False)), "backup_cooling_available": bool(req.get("backup_cooling_available", False)),
            "price_per_kg": req.get("price_per_kg"), "transport_rate_per_km": float(req.get("transport_rate_per_km", 45.0))}, None
