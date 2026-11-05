"""Refrigerated truck: cargo space split into N zones front -> rear (refrigeration unit at the front, door at the rear).

Per zone i:  C_i dT_i/dt = UA_i(v)(T_out - T_i) + k_ax (T_{i-1} + T_{i+1} - 2T_i) + Q_resp,i - w_i Q_cool + Q_door,i
- Cooling air is delivered from the front: share w_i decays along the box (w_i ~ exp(-i/2.5), normalised).
- Door opening exchanges air mostly in the rear zones (share ~ exp(-(N-1-i)/1.5)).
- Wall conductance rises with road speed: UA(v) = UA (1 + 0.004 v_kmh) (forced convection, assumption).
Humidity and gas are single-node for the whole box. Coefficients are engineering assumptions (configurable)."""
from __future__ import annotations

import math

from app.engine.registry import get_produce
from . import gas_model, humidity_model, thermal_model
from .deterioration_model import step_produce
from .environment import CP_AIR, P_STANDARD, humidity_ratio, moist_air_density, vapour_pressure
from .state import COMMODITY_PHYSICS, SimState

N_ZONES = 6
K_AXIAL_W_PER_K = 60.0
DOOR_ACH = 60.0


def _weights(n: int, front: bool) -> list[float]:
    raw = [math.exp(-i / 2.5) for i in range(n)] if front else [math.exp(-(n - 1 - i) / 1.5) for i in range(n)]
    tot = sum(raw)
    return [x / tot for x in raw]


COOL_W = _weights(N_ZONES, True)
DOOR_W = _weights(N_ZONES, False)


def step_truck(s: SimState, cfg: dict, amb: dict, dt: float) -> dict:
    p_atm = amb.get("p") or P_STANDARD
    pp = get_produce(s.produce.commodity)
    q10 = pp.v("q10")
    n = len(s.zones)
    vol = cfg["cargo_volume_m3"]
    ua = cfg["ua_w_per_k"] * (1 + 0.004 * max(0.0, s.speed_kmh))
    a = s.air
    t_mean = sum(s.zones) / n
    rh = humidity_model.rh_of(t_mean, a.w, p_atm)
    eq = s.equipment
    env = thermal_model.Envelope(vol, ua, cfg.get("ach", 0.3), cfg.get("c_struct_j_per_k", 400000.0), cfg["cooling_kw"])
    # refrigeration is controlled on the return-air (front) sensor
    q_cool = thermal_model.cooling_power_w(env, s.zones[0], eq.setpoint, eq.refrigeration_on, eq.cooling_failed, eq.cooling_efficiency, eq.backup_cooling)
    o2f = gas_model.o2_factor(a.x_o2)
    mass_i = s.produce.mass_kg / n
    rho = moist_air_density(t_mean, rh, p_atm)
    c_i = rho * vol / n * CP_AIR + mass_i * COMMODITY_PHYSICS[s.produce.commodity]["cp"] + env.c_struct_j_per_k / n
    door_ach = DOOR_ACH if eq.door_open else 0.0
    m_door_total = moist_air_density(amb["t"], amb["rh"], p_atm) * vol * door_ach / 3600.0
    m_inf_total = moist_air_density(amb["t"], amb["rh"], p_atm) * vol * env.ach / 3600.0
    new = []
    for i, t in enumerate(s.zones):
        left = s.zones[i - 1] if i > 0 else t
        right = s.zones[i + 1] if i < n - 1 else t
        q = (ua / n) * (amb["t"] - t) + K_AXIAL_W_PER_K * (left + right - 2 * t)
        q += thermal_model.respiration_heat_w(s.produce.commodity, t, q10, mass_i, o2f)
        q -= COOL_W[i] * q_cool
        q += (DOOR_W[i] * m_door_total + m_inf_total / n) * CP_AIR * (amb["t"] - t)
        new.append(t + q * dt / c_i)
    # deterioration uses the warmest zone (worst case) and the box mean (central)
    transp, k = step_produce(s.produce, t_mean, rh, a.x_o2, a.x_co2, dt)
    w_out = humidity_ratio(amb["t"], amb["rh"], p_atm)
    coil = humidity_model.coil_removal_kg_s(s.zones[0], rh, q_cool)
    hum = humidity_model.humidifier_kg_s(rh, None, eq.humidifier_fault)
    m_vent_dry = (m_door_total + m_inf_total) / (1 + w_out)
    s.zones = new
    t_new_mean = sum(new) / n
    a.w = humidity_model.step_humidity(a.w, t_new_mean, vol, p_atm, m_vent_dry, w_out, transp, hum, coil, dt)
    resp = thermal_model.respiration_rate(s.produce.commodity, t_mean, q10)
    a.x_o2, a.x_co2 = gas_model.step_gas(a.x_o2, a.x_co2, resp, s.produce.mass_kg, vol, env.ach + door_ach, dt)
    a.t = t_new_mean
    eq.power_kw = q_cool / thermal_model.COP / 1000.0
    # movement
    if s.delay_remaining_s > 0:
        s.delay_remaining_s = max(0.0, s.delay_remaining_s - dt)
        moving_speed = 0.0
    else:
        moving_speed = s.speed_kmh
    s.route_progress_m = min(cfg["route_distance_m"], s.route_progress_m + moving_speed / 3.6 * dt)
    return {"q_cool_w": q_cool, "decay_rate_per_day": k, "moving_speed_kmh": moving_speed}


def readings_truck(s: SimState, amb: dict) -> dict:
    p_atm = amb.get("p") or P_STANDARD
    a = s.air
    t_mean = sum(s.zones) / len(s.zones)
    rh = humidity_model.rh_of(t_mean, a.w, p_atm)
    pw = vapour_pressure(t_mean, rh)
    pp = gas_model.partial_pressures(a.x_o2, a.x_co2, p_atm, pw)
    return {"temperature_c": round(t_mean, 3), "zone_temperatures_c": [round(z, 3) for z in s.zones], "max_zone_c": round(max(s.zones), 3),
            "rh_pct": round(rh, 2), "pressure_pa": round(p_atm, 1), "o2_pct": round(a.x_o2 * 100, 3), "co2_pct": round(a.x_co2 * 100, 4),
            "o2_partial_pa": round(pp["o2_pa"], 1), "co2_partial_pa": round(pp["co2_pa"], 2), "power_kw": round(s.equipment.power_kw, 3)}
