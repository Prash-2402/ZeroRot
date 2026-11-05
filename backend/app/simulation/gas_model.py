"""Simplified O2 / CO2 balance in the free air volume (dry mole fractions), with Dalton partial pressures.

dx_CO2/dt = G / V_free + (ACH/3600)(x_CO2,out - x_CO2)
dx_O2/dt  = -G / (RQ V_free) + (ACH/3600)(0.2095 - x_O2)
G = respiration CO2 volume production (m3/s). RQ = 1 (assumption). Respiration slows as O2 falls
(Michaelis-Menten factor x/(x + 0.01), engineering assumption) so O2 cannot go negative."""
from __future__ import annotations

from .environment import X_CO2_AMBIENT, X_O2_AMBIENT, partial_pressure

BULK_DENSITY = 650.0  # kg produce per m3 of occupied volume incl. crates (assumption)
RQ = 1.0


def free_volume(volume_m3: float, mass_kg: float) -> float:
    return max(0.1 * volume_m3, volume_m3 - mass_kg / BULK_DENSITY)


def o2_factor(x_o2: float) -> float:
    return x_o2 / (x_o2 + 0.01)


def step_gas(x_o2: float, x_co2: float, resp_ml_kg_h: float, mass_kg: float, volume_m3: float, ach_total: float, dt: float):
    v_free = free_volume(volume_m3, mass_kg)
    g = resp_ml_kg_h * o2_factor(x_o2) * mass_kg * 1e-6 / 3600.0   # m3 CO2 per second
    k = ach_total / 3600.0
    x_co2 = x_co2 + (g / v_free + k * (X_CO2_AMBIENT - x_co2)) * dt
    x_o2 = x_o2 + (-g / (RQ * v_free) + k * (X_O2_AMBIENT - x_o2)) * dt
    return max(0.0, min(0.21, x_o2)), max(0.0, min(0.5, x_co2))


def partial_pressures(x_o2: float, x_co2: float, p_atm: float, p_water: float) -> dict:
    return {"o2_pa": partial_pressure(x_o2, p_atm, p_water), "co2_pa": partial_pressure(x_co2, p_atm, p_water)}
