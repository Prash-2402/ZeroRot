"""Virtual sensors: named readings with positions for the 3D scene, all read from the one simulation state.
No random noise is added: values are the model state (deterministic)."""
from __future__ import annotations

from .state import SimState


def sensors(kind: str, s: SimState, r: dict, gps: tuple | None = None) -> list[dict]:
    out = []
    if kind == "cold_chain":
        n = len(s.zones)
        for i, t in enumerate(r["zone_temperatures_c"]):
            out.append({"id": f"T{i + 1}", "kind": "temperature", "value": t, "unit": "degC", "position": [round(2.4 - 4.8 * (i + 0.5) / n, 2), 1.6, 0.0],
                        "label": f"Cargo zone {i + 1}" + (" (front, near unit)" if i == 0 else " (rear, door)" if i == n - 1 else "")})
        out += [{"id": "RH1", "kind": "humidity", "value": r["rh_pct"], "unit": "%", "position": [0.0, 2.3, 0.9], "label": "Cargo humidity"},
                {"id": "O2", "kind": "oxygen", "value": r["o2_pct"], "unit": "%", "position": [0.8, 2.3, -0.9], "label": "Oxygen"},
                {"id": "CO2", "kind": "co2", "value": r["co2_pct"], "unit": "%", "position": [1.2, 2.3, -0.9], "label": "Carbon dioxide"},
                {"id": "PWR", "kind": "power", "value": r["power_kw"], "unit": "kW", "position": [2.6, 2.6, 0.0], "label": "Refrigeration power"},
                {"id": "DOOR", "kind": "door", "value": 1.0 if s.equipment.door_open else 0.0, "unit": "open", "position": [-2.6, 1.4, 0.0], "label": "Rear door"},
                {"id": "COOL", "kind": "cooling_status", "value": 0.0 if (s.equipment.cooling_failed or not s.equipment.refrigeration_on) else 1.0,
                 "unit": "on", "position": [2.6, 2.9, 0.0], "label": "Cooling unit"}]
        if gps:
            out.append({"id": "GPS", "kind": "gps", "value": 0.0, "unit": "", "lat": gps[0], "lng": gps[1], "position": [3.4, 2.3, 0.0], "label": "GPS"})
        return out
    out = [{"id": "T1", "kind": "temperature", "value": r["temperature_c"], "unit": "degC", "position": [0.0, 2.2, -1.5], "label": "Air temperature"},
           {"id": "RH1", "kind": "humidity", "value": r["rh_pct"], "unit": "%", "position": [1.2, 2.2, -1.5], "label": "Relative humidity"},
           {"id": "P1", "kind": "pressure", "value": r["pressure_pa"], "unit": "Pa", "position": [-1.2, 2.2, -1.5], "label": "Atmospheric pressure"},
           {"id": "O2", "kind": "oxygen", "value": r["o2_pct"], "unit": "%", "position": [2.0, 1.2, -1.5], "label": "Oxygen"},
           {"id": "CO2", "kind": "co2", "value": r["co2_pct"], "unit": "%", "position": [2.4, 1.2, -1.5], "label": "Carbon dioxide"}]
    if kind == "cold_storage":
        out += [{"id": "PWR", "kind": "power", "value": r["power_kw"], "unit": "kW", "position": [0.0, 3.0, 0.0], "label": "Refrigeration power"},
                {"id": "DOOR", "kind": "door", "value": 1.0 if s.equipment.door_open else 0.0, "unit": "open", "position": [3.0, 1.2, 1.5], "label": "Door"}]
    else:
        out.append({"id": "VENT", "kind": "vents", "value": 1.0 if s.equipment.vents_open else 0.0, "unit": "open", "position": [-3.0, 2.6, 0.0], "label": "Ventilation"})
    return out
