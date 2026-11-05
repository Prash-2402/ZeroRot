"""Event-driven alert engine. Rules read the authoritative simulation state; an alert opens when a condition starts,
and resolves when it clears. Each alert carries the reading, expected range, risk and a recommended action."""
from __future__ import annotations

from dataclasses import dataclass

from app.engine.registry import get_produce
from .state import COMMODITY_PHYSICS, SimState


@dataclass
class Finding:
    code: str
    severity: str
    title: str
    message: str
    reading: dict
    expected: dict
    risk: str
    recommendation: str
    action: str | None = None   # corrective action key


def thresholds(kind: str, commodity: str, setpoint: float | None, cfg: dict) -> dict:
    p = get_produce(commodity)
    t_ref = p.v("t_ref")
    if kind == "traditional_storage":
        warn, crit = cfg.get("temp_warning_above", t_ref + 10), cfg.get("temp_critical_above", t_ref + 15)
    else:
        base = setpoint if setpoint is not None else t_ref
        warn, crit = cfg.get("temp_warning_above", base + 2), cfg.get("temp_critical_above", base + 5)
    ph = COMMODITY_PHYSICS[commodity]
    return {"t_warn": warn, "t_crit": crit, "t_chill": p.v("t_chill"), "rh_low": p.v("rh_low") - 5, "rh_high": min(100.0, p.v("rh_high") + 3),
            "o2_min": ph["o2_min"], "o2_crit": ph["o2_critical"], "co2_max": ph["co2_max"], "co2_crit": ph["co2_critical"]}


def evaluate(s: SimState, r: dict, kind: str, cfg: dict, ctx: dict) -> list[Finding]:
    """r: current readings; ctx: {"door_open_s", "decay_ratio", "spoilage_probability", "delay_s"}."""
    out: list[Finding] = []
    th = thresholds(kind, s.produce.commodity, s.equipment.setpoint, cfg)
    t = r.get("max_zone_c", r["temperature_c"])
    where = "warmest cargo zone" if "max_zone_c" in r else "store air"
    if t >= th["t_crit"]:
        out.append(Finding("TEMP_EXCURSION", "CRITICAL", "Critical temperature excursion",
                           f"Temperature in the {where} is {t:.1f} degC, above the critical limit {th['t_crit']:.1f} degC.",
                           {"temperature_c": round(t, 2)}, {"max_c": round(th["t_warn"], 1)},
                           "Rapid quality loss and shortened shelf life.", "Restore cooling, close openings and prioritise this batch for sale or transfer.", "restore_cooling"))
    elif t >= th["t_warn"]:
        out.append(Finding("TEMP_EXCURSION", "WARNING", "Temperature above operating range",
                           f"Temperature in the {where} is {t:.1f} degC (warning limit {th['t_warn']:.1f} degC).",
                           {"temperature_c": round(t, 2)}, {"max_c": round(th["t_warn"], 1)},
                           "Faster deterioration than planned.", "Check cooling setpoint and airflow; improve ventilation in unrefrigerated stores.", "adjust_setpoint"))
    if r["temperature_c"] < th["t_chill"]:
        out.append(Finding("CHILLING_RISK", "WARNING", "Below chilling threshold",
                           f"Air at {r['temperature_c']:.1f} degC is below the {th['t_chill']:.1f} degC chilling threshold for {s.produce.commodity}.",
                           {"temperature_c": r["temperature_c"]}, {"min_c": th["t_chill"]},
                           "Cumulative chilling injury (failure to ripen, pitting, decay).", "Raise the setpoint above the chilling threshold.", "raise_setpoint"))
    rh = r["rh_pct"]
    if rh < th["rh_low"] or rh > th["rh_high"]:
        low = rh < th["rh_low"]
        out.append(Finding("HUMIDITY_DEVIATION", "WARNING", "Humidity outside recommended range",
                           f"Relative humidity is {rh:.0f}% (recommended {th['rh_low'] + 5:.0f}-{th['rh_high'] - 3:.0f}%).",
                           {"rh_pct": round(rh, 1)}, {"min_pct": th["rh_low"] + 5, "max_pct": th["rh_high"] - 3},
                           "Moisture loss and shrivelling." if low else "Condensation and mould growth.",
                           "Add humidification or reduce dry ventilation." if low else "Check the humidifier and increase air exchange.",
                           "increase_humidity" if low else "reduce_humidity"))
    if r["o2_pct"] < th["o2_crit"] or r["co2_pct"] > th["co2_crit"]:
        out.append(Finding("GAS_ABNORMAL", "CRITICAL", "Harmful gas concentration",
                           f"O2 {r['o2_pct']:.2f}% / CO2 {r['co2_pct']:.2f}% beyond injury limits (O2 >= {th['o2_crit']}%, CO2 <= {th['co2_crit']}%).",
                           {"o2_pct": r["o2_pct"], "co2_pct": r["co2_pct"]}, {"o2_min_pct": th["o2_crit"], "co2_max_pct": th["co2_crit"]},
                           "Off-flavours, internal browning, increased decay.", "Increase fresh-air ventilation immediately.", "ventilate"))
    elif r["o2_pct"] < th["o2_min"] or r["co2_pct"] > th["co2_max"]:
        out.append(Finding("GAS_ABNORMAL", "WARNING", "Gas concentration drifting",
                           f"O2 {r['o2_pct']:.2f}% / CO2 {r['co2_pct']:.2f}% outside the tolerated range.",
                           {"o2_pct": r["o2_pct"], "co2_pct": r["co2_pct"]}, {"o2_min_pct": th["o2_min"], "co2_max_pct": th["co2_max"]},
                           "Risk of physiological injury if it continues.", "Increase fresh-air exchange.", "ventilate"))
    eq = s.equipment
    if eq.setpoint is not None and (eq.cooling_failed or not eq.refrigeration_on):
        out.append(Finding("COOLING_FAILURE", "CRITICAL", "Refrigeration failure" if kind == "cold_chain" else "Cooling system failure",
                           "The refrigeration system is not cooling. Temperature will rise through the insulation.",
                           {"refrigeration_on": eq.refrigeration_on, "failed": eq.cooling_failed, "temperature_c": round(t, 2)},
                           {"refrigeration": "running"}, "Temperature rise and accelerated spoilage.",
                           "Inspect the refrigeration unit and activate backup cooling.", "activate_backup_cooling"))
    if eq.door_open and ctx.get("door_open_s", 0) >= 600:
        out.append(Finding("DOOR_OPEN", "WARNING", "Door left open",
                           f"The door has been open for {ctx['door_open_s'] / 60:.0f} minutes.", {"door_open_minutes": round(ctx["door_open_s"] / 60)},
                           {"door": "closed"}, "Heat and moisture enter the store.", "Close the door.", "close_door"))
    if kind == "cold_chain" and ctx.get("delay_s", 0) >= 1800:
        out.append(Finding("ROUTE_DELAY", "WARNING", "Transportation delay",
                           f"The truck is {ctx['delay_s'] / 3600:.1f} h behind the planned arrival.", {"delay_hours": round(ctx["delay_s"] / 3600, 2)},
                           {"delay_hours_max": 0.5}, "Longer exposure; reduced shelf life at arrival.", "Re-plan the delivery or divert to a nearer market.", "replan_route"))
    sp = ctx.get("spoilage_probability")
    if sp is not None and sp >= 0.2:
        crit = sp >= 0.5
        out.append(Finding("SPOILAGE_RISK", "CRITICAL" if crit else "WARNING", "High spoilage risk",
                           f"{sp * 100:.0f}% of model runs reach the unsellable threshold before the planned end.",
                           {"spoilage_probability": sp}, {"max": 0.2}, "Produce may become unsellable before sale.",
                           "Sell earlier or move the batch to better storage.", "prioritise_batch"))
    ratio = ctx.get("decay_ratio")
    if ratio is not None and ratio >= 3.0:
        out.append(Finding("ABNORMAL_DETERIORATION", "WARNING", "Abnormal deterioration rate",
                           f"Quality is falling {ratio:.1f}x faster than at the recommended storage conditions.", {"rate_ratio": round(ratio, 2)},
                           {"max_ratio": 3.0}, "Shelf life is shrinking quickly.", "Correct temperature/humidity or sell soon.", "prioritise_batch"))
    return out


ACTION_TEXT = {
    "restore_cooling": "Restore cooling capacity (repair or backup unit)",
    "adjust_setpoint": "Lower the cooling setpoint within the safe range",
    "raise_setpoint": "Raise the setpoint above the chilling threshold",
    "increase_humidity": "Increase humidity",
    "reduce_humidity": "Reduce humidity",
    "ventilate": "Increase fresh-air ventilation",
    "activate_backup_cooling": "Activate backup cooling",
    "close_door": "Close the door",
    "replan_route": "Re-plan route or destination",
    "prioritise_batch": "Prioritise this batch for sale or transfer",
}
