"""Loss analytics from simulation results.

Loss % = quantity lost / initial quantity x 100
Loss prevented = baseline loss - improved scenario loss
Comparisons run both scenarios through the same engine from the identical starting state; they are simulated
counterfactual estimates, never measured savings."""
from __future__ import annotations

import copy

from app.engine.value import grade_factor
from app.simulation.engine import run_headless

LABEL = "Simulated counterfactual estimate (same engine, same inputs). Not measured farmer savings."


def money(summary: dict, price_per_kg: float | None, storage_cost: float, transport_cost: float, energy_tariff: float) -> dict:
    energy_cost = summary.get("energy_kwh", 0) * energy_tariff
    if price_per_kg is None:
        return {"revenue": None, "net_profit": None, "storage_cost": round(storage_cost, 2), "transport_cost": round(transport_cost, 2),
                "energy_cost": round(energy_cost, 2), "note": "No verified or manual price given: revenue not computed."}
    revenue = summary["final_saleable_kg"] * price_per_kg * float(grade_factor(summary["final_quality"]))
    return {"revenue": round(revenue, 2), "storage_cost": round(storage_cost, 2), "transport_cost": round(transport_cost, 2),
            "energy_cost": round(energy_cost, 2), "net_profit": round(revenue - storage_cost - transport_cost - energy_cost, 2)}


def compare(baseline: tuple[str, dict, str | None], improved: tuple[str, dict, str | None], price_per_kg: float | None,
            costs: dict, labels: tuple[str, str]) -> dict:
    """baseline/improved: (kind, config, scenario)."""
    res = []
    for (kind, cfg, scen), lab, ck in ((baseline[0], baseline[1], baseline[2]), labels[0], "baseline"), ((improved[0], improved[1], improved[2]), labels[1], "improved"):
        s = run_headless(0, kind, copy.deepcopy(cfg), scenario=scen)
        if "error" in s:
            return {"error": s["error"]}
        c = costs.get(ck, {})
        s["money"] = money(s, price_per_kg, c.get("storage_cost", 0.0), c.get("transport_cost", 0.0), costs.get("energy_tariff", 8.0))
        s["label"] = lab
        res.append(s)
    b, i = res
    prevented_kg = round(b["lost_kg"] - i["lost_kg"], 1)
    out = {"baseline": b, "improved": i, "loss_prevented_kg": prevented_kg,
           "loss_prevented_pct_points": round(b["loss_pct"] - i["loss_pct"], 2), "label": LABEL}
    if b["money"]["net_profit"] is not None:
        out["net_profit_difference"] = round(i["money"]["net_profit"] - b["money"]["net_profit"], 2)
    return out
