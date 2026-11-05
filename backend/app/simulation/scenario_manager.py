"""Scenario injection. A scenario only changes equipment state or boundary conditions; every resulting temperature,
humidity, gas or quality change then evolves through the physical models over time (nothing jumps)."""
from __future__ import annotations

from .state import SimState

SCENARIOS = {
    "cold_chain": {
        "normal": "Normal transportation: refrigeration on, door closed, nominal efficiency.",
        "high_external_temp": "High external temperature: ambient raised 12 degC above the live weather (scenario override).",
        "refrigeration_failure": "Refrigeration failure: compressor stops; cargo warms through the insulation.",
        "door_open": "Cargo door left open: rear zones exchange air with the outside.",
        "cooling_degradation": "Cooling efficiency degradation: unit delivers 35% of rated capacity.",
        "humidity_deviation": "Humidity deviation: humidification fault adds moisture continuously.",
        "extended_delay": "Extended transportation delay: truck stopped for 4 hours (traffic / breakdown).",
    },
    "cold_storage": {
        "normal": "Normal operation.",
        "cooling_failure": "Cooling system failure: refrigeration stops.",
        "door_open": "Door left open: heavy air exchange with the loading area.",
        "cooling_degradation": "Cooling efficiency degradation to 35%.",
        "heat_wave": "Heat wave: ambient raised 8 degC above live weather (scenario override).",
        "humidity_deviation": "Humidifier stuck on.",
    },
    "traditional_storage": {
        "normal": "Vents open, door closed, live weather.",
        "heat_wave": "Heat wave: ambient raised 8 degC above live weather (scenario override).",
        "vents_closed": "Ventilation openings closed (natural air exchange cut to 25%).",
        "door_open": "Door left open.",
    },
}


def apply(s: SimState, kind: str, scenario: str) -> str:
    if scenario not in SCENARIOS.get(kind, {}):
        raise ValueError(f"Unknown scenario '{scenario}' for {kind}. Options: {', '.join(SCENARIOS[kind])}")
    eq, ov = s.equipment, s.overrides
    if scenario == "normal":
        eq.cooling_failed = False
        eq.refrigeration_on = True
        eq.cooling_efficiency = 1.0
        eq.door_open = False
        eq.vents_open = True
        eq.humidifier_fault = False
        ov.ambient_offset = 0.0
        s.delay_remaining_s = 0.0
        s.faults = []
        return SCENARIOS[kind][scenario]
    tag = scenario
    if scenario in ("refrigeration_failure", "cooling_failure"):
        eq.cooling_failed = True
    elif scenario == "door_open":
        eq.door_open = True
    elif scenario == "cooling_degradation":
        eq.cooling_efficiency = 0.35
    elif scenario == "humidity_deviation":
        eq.humidifier_fault = True
    elif scenario == "high_external_temp":
        ov.ambient_offset = 12.0
    elif scenario == "heat_wave":
        ov.ambient_offset = 8.0
    elif scenario == "vents_closed":
        eq.vents_open = False
    elif scenario == "extended_delay":
        s.delay_remaining_s += 4 * 3600.0
    if tag not in s.faults:
        s.faults.append(tag)
    return SCENARIOS[kind][scenario]


CONTROLS = {
    "ambient_t": (-10.0, 55.0), "ambient_rh": (5.0, 100.0), "ambient_offset": (-15.0, 20.0), "setpoint": (-2.0, 30.0),
    "rh_setpoint": (40.0, 100.0), "fresh_air_ach": (0.0, 30.0), "cooling_efficiency": (0.0, 1.0), "speed_kmh": (0.0, 100.0),
    "route_progress": (0.0, 1.0),
}
TOGGLES = ("door_open", "refrigeration_on", "backup_cooling", "vents_open", "humidifier_fault")


def set_control(s: SimState, name: str, value, route_distance_m: float = 0.0) -> None:
    """Change a control while running. Values are bounded; physics then evolves the state over time."""
    if name in TOGGLES:
        setattr(s.equipment, name, bool(value))
        return
    if name not in CONTROLS:
        raise ValueError(f"Unknown control '{name}'")
    if value is None and name in ("ambient_t", "ambient_rh", "fresh_air_ach"):
        target = s.overrides if name.startswith("ambient") else s.equipment
        setattr(target, name, None)
        return
    lo, hi = CONTROLS[name]
    v = max(lo, min(hi, float(value)))
    if name in ("ambient_t", "ambient_rh", "ambient_offset"):
        setattr(s.overrides, name, v)
    elif name == "speed_kmh":
        s.speed_kmh = v
    elif name == "route_progress":
        s.route_progress_m = v * route_distance_m
    else:
        setattr(s.equipment, name, v)
