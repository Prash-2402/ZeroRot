"""Water-vapour balance on the store air (humidity ratio W, kg water / kg dry air).

m_da dW/dt = m_vent (W_out - W) + transpiration + humidifier - coil condensation
Excess above saturation condenses (RH capped at 100%)."""
from __future__ import annotations

from .environment import R_DRY, dew_point, humidity_ratio, kelvin, rh_from_ratio, vapour_pressure
from .thermal_model import COIL_APPROACH_K

H_FG = 2.45e6           # J/kg latent heat of vaporisation
LATENT_FRACTION = 0.15  # share of cooling that condenses moisture when the coil is below dew point (assumption)
HUMIDIFIER_KG_H = 2.0   # cold-room humidifier capacity (assumption)


def dry_air_mass(volume_m3: float, t: float, w: float, p_atm: float) -> float:
    pw = w * p_atm / (0.62198 + w)
    return (p_atm - pw) * volume_m3 / (R_DRY * kelvin(t))


def coil_removal_kg_s(t_air: float, rh: float, q_cool_w: float) -> float:
    if q_cool_w <= 0:
        return 0.0
    coil_t = t_air - COIL_APPROACH_K
    if dew_point(t_air, rh) <= coil_t:
        return 0.0
    return LATENT_FRACTION * q_cool_w / H_FG


def humidifier_kg_s(rh: float, rh_setpoint: float | None, fault: bool) -> float:
    if fault:
        return 3 * HUMIDIFIER_KG_H / 3600.0   # stuck-on humidifier (humidity deviation scenario)
    if rh_setpoint is None:
        return 0.0
    return HUMIDIFIER_KG_H / 3600.0 if rh < rh_setpoint - 2 else 0.0


def step_humidity(w: float, t_new: float, volume_m3: float, p_atm: float, m_vent_kg_s: float, w_out: float,
                  transpiration_kg_s: float, humid_kg_s: float, coil_kg_s: float, dt: float) -> float:
    m_da = dry_air_mass(volume_m3, t_new, w, p_atm)
    w = w + (m_vent_kg_s * (w_out - w) + transpiration_kg_s + humid_kg_s - coil_kg_s) * dt / m_da
    w_sat = humidity_ratio(t_new, 100.0, p_atm)
    return max(1e-5, min(w, w_sat))


def rh_of(t: float, w: float, p_atm: float) -> float:
    return max(0.0, min(100.0, rh_from_ratio(t, w, p_atm)))


__all__ = ["step_humidity", "rh_of", "coil_removal_kg_s", "humidifier_kg_s", "dry_air_mass", "vapour_pressure"]
