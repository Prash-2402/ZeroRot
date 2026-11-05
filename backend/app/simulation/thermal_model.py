"""Lumped-capacitance heat balance for a storage room / cargo node.

C dT/dt = UA (T_out - T) + m_vent cp (T_out - T) + Q_respiration + Q_door - Q_cooling

C = air + produce + structure heat capacity. Engineering assumptions (documented, configurable):
refrigeration COP 2.5, proportional cooling band 2 K, coil runs ~8 K below air temperature."""
from __future__ import annotations

from dataclasses import dataclass

from .environment import CP_AIR, moist_air_density
from .state import COMMODITY_PHYSICS, W_PER_ML_CO2

COP = 2.5
COOLING_BAND_K = 2.0
COIL_APPROACH_K = 8.0


@dataclass
class Envelope:
    volume_m3: float
    ua_w_per_k: float
    ach: float                  # infiltration / natural ventilation air changes per hour
    c_struct_j_per_k: float     # structure thermal mass (masonry, panels)
    cooling_kw: float = 0.0     # rated refrigeration capacity (0 = no refrigeration)
    door_ach: float = 20.0      # extra air changes while the door is open


def respiration_rate(commodity: str, t: float, q10: float) -> float:
    """mL CO2 / kg.h at temperature t, scaled from the sheet reference with the commodity Q10."""
    ph = COMMODITY_PHYSICS[commodity]
    return ph["resp_ref"] * q10 ** ((t - ph["resp_t"]) / 10.0)


def respiration_heat_w(commodity: str, t: float, q10: float, mass_kg: float, o2_factor: float = 1.0) -> float:
    return respiration_rate(commodity, t, q10) * o2_factor * W_PER_ML_CO2 * mass_kg


def heat_capacity(env: Envelope, mass_kg: float, commodity: str, t: float, rh: float, p_atm: float) -> float:
    air = moist_air_density(t, rh, p_atm) * env.volume_m3 * CP_AIR
    return air + mass_kg * COMMODITY_PHYSICS[commodity]["cp"] + env.c_struct_j_per_k


def cooling_demand(t: float, setpoint: float) -> float:
    """Proportional controller: 0 below (setpoint - 0.5 K), full at setpoint + 1.5 K."""
    return max(0.0, min(1.0, (t - (setpoint - 0.5)) / COOLING_BAND_K))


def cooling_power_w(env: Envelope, t: float, setpoint: float | None, on: bool, failed: bool, efficiency: float, backup: bool) -> float:
    if setpoint is None or env.cooling_kw <= 0:
        return 0.0
    cap = env.cooling_kw * 1000.0
    if failed or not on:
        cap = 0.0
    cap = cap * max(0.0, min(1.0, efficiency))
    if backup:
        cap += env.cooling_kw * 1000.0 * 0.5   # backup unit assumed at 50% of rated capacity
    return cap * cooling_demand(t, setpoint)


def ventilation_mass_flow(env: Envelope, ach_total: float, t_out: float, rh_out: float, p_atm: float) -> float:
    """kg/s of (moist) outside air exchanged."""
    return moist_air_density(t_out, rh_out, p_atm) * env.volume_m3 * ach_total / 3600.0


def step_temperature(t: float, t_out: float, c_total: float, ua: float, m_vent: float, q_resp: float, q_cool: float, dt: float) -> float:
    q = ua * (t_out - t) + m_vent * CP_AIR * (t_out - t) + q_resp - q_cool
    return t + q * dt / c_total
