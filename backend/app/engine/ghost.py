"""Ghost comparison: estimated counterfactual of the original plan vs the approved reroute from the identical state."""
from __future__ import annotations

from datetime import datetime

from .conditions import WeatherStore
from .decay import State
from .plans import Plan, evaluate_plans, strip_internal
from .registry import get_produce

LABEL = "Estimated counterfactual simulation, not measured savings."


def compare(produce: str, maturity: str | None, mass_kg: float, state: State, start: datetime,
            ghost_plan: Plan, reroute_plan: Plan, prices: dict, weather: WeatherStore) -> dict:
    p = get_produce(produce)
    g, r = evaluate_plans(p, maturity, state, mass_kg, start, [ghost_plan, reroute_plan], weather, prices)
    g_net = g["net"] if g["net"] is not None else 0
    r_net = r["net"] if r["net"] is not None else 0
    protected = r_net - g_net
    return {
        "start_state": state.as_dict(), "start_time": start.isoformat(timespec="minutes"),
        "ghost": strip_internal(g), "reroute": strip_internal(r),
        "value_protected": round(protected), "reroute_better": protected > 0,
        "message": None if protected > 0 else "The reroute is not better than continuing; no value protected.",
        "food_protected_kg": round(max(0.0, r["saleable_kg"] - g["saleable_kg"]), 1),
        "label": LABEL, "price_scenario": "base (same for both runs)",
    }
