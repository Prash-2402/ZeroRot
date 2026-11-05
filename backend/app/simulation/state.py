"""Commodity physics constants and the serialisable simulation state containers."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

# Respiration reference rates and controlled-atmosphere tolerances from the UC Davis produce fact sheets
# (tomato, mango, banana, potato). Heat of respiration: 1 mL CO2/kg.h = 122 kcal/t/day = 0.00591 W/kg
# ("multiply mL CO2/kg.h by 122 to get kcal/metric ton/day", same sheets).
# Specific heat 3.8 kJ/kg.K is an engineering assumption typical of high-moisture produce.
COMMODITY_PHYSICS = {
    "tomato": {"resp_ref": 7.5, "resp_t": 10.0, "o2_min": 3.0, "o2_critical": 1.0, "co2_max": 3.0, "co2_critical": 5.0, "cp": 3800.0,
               "source": "UC Davis tomato: respiration 6-9 mL CO2/kg.h at 10 degC (mature-green); 1% O2 causes off-flavours; CO2 above 3-5% not tolerated"},
    "mango": {"resp_ref": 18.5, "resp_t": 13.0, "o2_min": 3.0, "o2_critical": 2.0, "co2_max": 8.0, "co2_critical": 10.0, "cp": 3800.0,
              "source": "UC Davis mango: respiration 15-22 at 13 degC; below 2% O2 and/or above 8% CO2 may cause injury"},
    "banana": {"resp_ref": 20.0, "resp_t": 13.0, "o2_min": 2.0, "o2_critical": 1.5, "co2_max": 7.0, "co2_critical": 9.0, "cp": 3800.0,
               "source": "UC Davis banana: respiration 10-30 at 13 degC; below 2% O2 and/or above 7% CO2 may cause undesirable texture/flavour"},
    "potato": {"resp_ref": 9.0, "resp_t": 10.0, "o2_min": 5.0, "o2_critical": 1.5, "co2_max": 10.0, "co2_critical": 12.0, "cp": 3600.0,
               "source": "UC Davis potato: respiration 7-11 at 10 degC; wound healing delayed below 5% O2; injury below 1.5% O2 or above 10% CO2"},
}
W_PER_ML_CO2 = 0.00591  # W/kg per (mL CO2/kg.h)


@dataclass
class ProduceState:
    commodity: str
    maturity: str | None
    mass_kg: float
    q: float
    w: float = 0.0
    r: float = 0.0
    e: float = 0.0  # chilling exposure, degC.h


@dataclass
class AirState:
    t: float          # degC (single node; trucks hold per-zone temps separately)
    w: float          # humidity ratio kg/kg
    x_o2: float = 0.2095
    x_co2: float = 0.00042


@dataclass
class Equipment:
    refrigeration_on: bool = True
    cooling_failed: bool = False
    backup_cooling: bool = False
    cooling_efficiency: float = 1.0
    door_open: bool = False
    vents_open: bool = True
    humidifier_fault: bool = False
    setpoint: float | None = None
    rh_setpoint: float | None = None
    fresh_air_ach: float | None = None
    power_kw: float = 0.0


@dataclass
class Overrides:
    ambient_t: float | None = None
    ambient_rh: float | None = None
    ambient_offset: float = 0.0


@dataclass
class SimState:
    kind: str
    t_seconds: float
    produce: ProduceState
    air: AirState
    equipment: Equipment
    overrides: Overrides = field(default_factory=Overrides)
    zones: list[float] = field(default_factory=list)   # truck cargo zone temperatures, front -> rear
    route_progress_m: float = 0.0
    speed_kmh: float = 0.0
    delay_remaining_s: float = 0.0
    ambient: dict = field(default_factory=dict)
    faults: list[str] = field(default_factory=list)
    last_prediction: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "SimState":
        d = dict(d)
        d["produce"] = ProduceState(**d["produce"])
        d["air"] = AirState(**d["air"])
        d["equipment"] = Equipment(**d["equipment"])
        d["overrides"] = Overrides(**d.get("overrides", {}))
        return cls(**d)
