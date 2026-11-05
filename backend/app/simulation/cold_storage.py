"""Single-node store model used for both the traditional (unrefrigerated) room and cold-storage rooms.
One time step couples: thermal balance -> humidity balance -> gas balance -> produce deterioration."""
from __future__ import annotations

from app.engine.registry import get_produce
from . import gas_model, humidity_model, thermal_model
from .deterioration_model import step_produce
from .environment import P_STANDARD, humidity_ratio, vapour_pressure
from .state import SimState
from .thermal_model import Envelope

COP = thermal_model.COP


def envelope_from_config(cfg: dict) -> Envelope:
    return Envelope(volume_m3=cfg["volume_m3"], ua_w_per_k=cfg["ua_w_per_k"], ach=cfg["ach"],
                    c_struct_j_per_k=cfg["c_struct_j_per_k"], cooling_kw=cfg.get("cooling_kw", 0.0),
                    door_ach=cfg.get("door_ach", 20.0))


def total_ach(env: Envelope, s: SimState) -> float:
    eq = s.equipment
    ach = eq.fresh_air_ach if eq.fresh_air_ach is not None else env.ach
    if s.kind == "traditional_storage" and not eq.vents_open:
        ach *= 0.25      # closing vents cuts natural ventilation (assumption)
    if eq.door_open:
        ach += env.door_ach
    return ach


def step_room(s: SimState, env: Envelope, amb: dict, dt: float) -> dict:
    """amb: {"t", "rh", "p"} outside conditions (already including any user override). Mutates s; returns flows."""
    p_atm = amb.get("p") or P_STANDARD
    pp = get_produce(s.produce.commodity)
    q10 = pp.v("q10")
    a = s.air
    rh = humidity_model.rh_of(a.t, a.w, p_atm)
    ach = total_ach(env, s)
    m_vent = thermal_model.ventilation_mass_flow(env, ach, amb["t"], amb["rh"], p_atm)
    o2f = gas_model.o2_factor(a.x_o2)
    q_resp = thermal_model.respiration_heat_w(s.produce.commodity, a.t, q10, s.produce.mass_kg, o2f)
    eq = s.equipment
    q_cool = thermal_model.cooling_power_w(env, a.t, eq.setpoint, eq.refrigeration_on, eq.cooling_failed, eq.cooling_efficiency, eq.backup_cooling)
    c = thermal_model.heat_capacity(env, s.produce.mass_kg, s.produce.commodity, a.t, rh, p_atm)
    t_new = thermal_model.step_temperature(a.t, amb["t"], c, env.ua_w_per_k, m_vent, q_resp, q_cool, dt)
    # produce deterioration at the current air state (also gives transpiration)
    transp, k = step_produce(s.produce, a.t, rh, a.x_o2, a.x_co2, dt)
    w_out = humidity_ratio(amb["t"], amb["rh"], p_atm)
    coil = humidity_model.coil_removal_kg_s(a.t, rh, q_cool)
    hum = humidity_model.humidifier_kg_s(rh, eq.rh_setpoint, eq.humidifier_fault) if (env.cooling_kw > 0 or eq.humidifier_fault) else 0.0
    m_vent_dry = m_vent / (1 + w_out)
    a.w = humidity_model.step_humidity(a.w, t_new, env.volume_m3, p_atm, m_vent_dry, w_out, transp, hum, coil, dt)
    resp = thermal_model.respiration_rate(s.produce.commodity, a.t, q10)
    a.x_o2, a.x_co2 = gas_model.step_gas(a.x_o2, a.x_co2, resp, s.produce.mass_kg, env.volume_m3, ach, dt)
    a.t = t_new
    eq.power_kw = q_cool / COP / 1000.0
    return {"q_cool_w": q_cool, "q_resp_w": q_resp, "ach": ach, "decay_rate_per_day": k, "transpiration_kg_h": transp * 3600}


def readings_room(s: SimState, amb: dict) -> dict:
    p_atm = amb.get("p") or P_STANDARD
    a = s.air
    rh = humidity_model.rh_of(a.t, a.w, p_atm)
    pw = vapour_pressure(a.t, rh)
    pp = gas_model.partial_pressures(a.x_o2, a.x_co2, p_atm, pw)
    return {"temperature_c": round(a.t, 3), "rh_pct": round(rh, 2), "pressure_pa": round(p_atm, 1),
            "o2_pct": round(a.x_o2 * 100, 3), "co2_pct": round(a.x_co2 * 100, 4),
            "o2_partial_pa": round(pp["o2_pa"], 1), "co2_partial_pa": round(pp["co2_pa"], 2),
            "power_kw": round(s.equipment.power_kw, 3)}
