"""Psychrometrics and Dalton's law. Pressures in pascals, temperatures in degC.

Dalton: total pressure = sum of partial pressures. For a gas with dry-air mole fraction x:
    p_gas = x * (P_atmospheric - p_water_vapour)
For ambient oxygen x = 0.2095, giving P_O2 = 0.2095 x (P_atm - P_w).
Dalton's law gives partial pressure only; the oxygen *fraction* inside a store comes from gas_model.py."""
from __future__ import annotations

import math

R_DRY = 287.05      # J/(kg K)
R_VAP = 461.5       # J/(kg K)
CP_AIR = 1006.0     # J/(kg K)
X_O2_AMBIENT = 0.2095
X_CO2_AMBIENT = 0.00042   # ~420 ppm
P_STANDARD = 101325.0


def kelvin(t_c: float) -> float:
    return t_c + 273.15


def saturation_vapour_pressure(t_c: float) -> float:
    """Magnus-type formula (Alduchov & Eskridge 1996), Pa, valid about -40..50 degC."""
    return 610.94 * math.exp(17.625 * t_c / (t_c + 243.04))


def vapour_pressure(t_c: float, rh: float) -> float:
    return max(0.0, min(100.0, rh)) / 100.0 * saturation_vapour_pressure(t_c)


def humidity_ratio(t_c: float, rh: float, p_atm: float) -> float:
    pw = vapour_pressure(t_c, rh)
    return 0.62198 * pw / max(1.0, p_atm - pw)


def rh_from_ratio(t_c: float, w: float, p_atm: float) -> float:
    pw = w * p_atm / (0.62198 + w)
    return 100.0 * pw / saturation_vapour_pressure(t_c)


def dew_point(t_c: float, rh: float) -> float:
    pw = max(1e-3, vapour_pressure(t_c, rh))
    g = math.log(pw / 610.94)
    return 243.04 * g / (17.625 - g)


def moist_air_density(t_c: float, rh: float, p_atm: float) -> float:
    pw = vapour_pressure(t_c, rh)
    tk = kelvin(t_c)
    return (p_atm - pw) / (R_DRY * tk) + pw / (R_VAP * tk)


def partial_pressure(x_dry: float, p_atm: float, p_water: float) -> float:
    """Dalton's law: partial pressure (Pa) of a component with dry-air mole fraction x_dry."""
    return x_dry * (p_atm - p_water)


def ambient_o2_partial_pressure(p_atm: float, t_c: float, rh: float) -> float:
    """P_O2 = 0.2095 x (P_atm - P_w)  [Pa]"""
    return partial_pressure(X_O2_AMBIENT, p_atm, vapour_pressure(t_c, rh))
