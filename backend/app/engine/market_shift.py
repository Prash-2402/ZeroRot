"""Market Shift Planner: compares selling Today / Day 2 / Day 4 / Day 7 under a market condition.
Quality comes from the decay engine at the batch's actual storage conditions; price from labelled scenarios."""
from __future__ import annotations

from datetime import datetime

from .conditions import Segment, WeatherStore
from .decay import State
from .geo import travel
from .plans import COSTS, Plan, auction_wait_hours, evaluate_plans, strip_internal, transport_cost
from .registry import get_produce
from .value import MARKET_CONDITIONS, price_scenarios

PERIODS = [0, 2, 4, 7]


def plan_market_shift(*, produce: str, maturity: str | None, mass_kg: float, state: State, start: datetime,
                      storage_segments, rent_per_kg_day: float, origin, origin_weather_point: str,
                      market: dict, series, condition: str, weather: WeatherStore, price_source: str, price_origin: str):
    """storage_segments(hours, rh_shift) -> list[Segment] for the batch's actual storage."""
    p = get_produce(produce)
    cond = MARKET_CONDITIONS.get(condition, MARKET_CONDITIONS["normal"])
    scen = price_scenarios(series, 10, condition, price_source, price_origin)
    leg = travel(origin, market["id"], cond["transit_delay"])
    hl = max(1, round(leg["hours"]))
    plans = []
    for d in PERIODS:
        wait = auction_wait_hours(start, d * 24 + hl)  # same morning-auction rule as Sell / Ship
        segs = list(storage_segments(d * 24, cond["rh_shift"])) + [Segment("weather", hl, point=origin_weather_point, bias_rh=cond["rh_shift"]),
                                                                  Segment("weather", wait, point=market["id"], bias_rh=cond["rh_shift"])]
        plans.append(Plan(f"DAY_{d}", "PERIOD", "Today" if d == 0 else f"Day {d}", segs, d * 24 + hl + wait, market["id"], market["name"],
                          transport_cost(leg["km"], mass_kg), rent=rent_per_kg_day * mass_kg * d,
                          handling=COSTS["handling_per_kg"] * mass_kg, meta={"day": d}))
    res = evaluate_plans(p, maturity, state, mass_kg, start, plans, weather, {market["id"]: scen})
    periods = []
    for r in res:
        sellable = r["quality_at_sale"] >= p.v("q_min")
        periods.append({"key": r["key"], "label": r["label"], "day": r["meta"]["day"],
                        "price_per_kg": r["base"]["price_per_kg"], "quality": r["quality_at_sale"], "saleable_kg": r["saleable_kg"],
                        "gross": r["base"]["gross"], "rent": r["rent"], "transport": r["transport_cost"], "commission": r["base"]["commission"],
                        "net": r["base"]["net"], "net_low": r["low"]["net"], "net_high": r["high"]["net"], "sellable": sellable})
    best = max(periods, key=lambda x: x["net"])
    for x in periods:
        x["recommended"] = x["key"] == best["key"]
        x["diff_vs_recommended"] = x["net"] - best["net"]
    return {"condition": condition, "condition_label": cond["label"], "banner": cond["banner"], "market": market,
            "periods": periods, "recommended": best["key"],
            "price_method": scen["label"], "observed_price": scen["observed"],
            "labels": {"scenario": "Demo market scenario; prices are scenarios, not guaranteed forecasts."}}


def choice_difference(plan: dict, chosen_key: str) -> dict:
    chosen = next(x for x in plan["periods"] if x["key"] == chosen_key)
    best = next(x for x in plan["periods"] if x["recommended"])
    diff = chosen["net"] - best["net"]
    if chosen_key == best["key"]:
        msg = "You chose the recommended period."
    else:
        from .format import inr
        msg = f"{inr(abs(diff))} {'less' if diff < 0 else 'more'} than recommended, your call."
    return {"chosen": chosen_key, "recommended": best["key"], "difference": diff, "message": msg}
