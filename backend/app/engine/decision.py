"""Rule-Based Decision Engine: Sell / Store / Ship. Deterministic and explainable; no LLM involved."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from .conditions import Segment, WeatherStore
from .decay import State
from .geo import points, travel
from .plans import COSTS, Plan, auction_wait_hours, evaluate_plans, strip_internal, transport_cost
from .registry import get_produce

# Demo default thresholds (configurable per produce)
THRESHOLDS = {"sell_urgent_drop_48h": 0.08, "sell_urgent_shelf_days": 3.0, "wait_penalty": 0.05,
              "store_gain": 0.05, "ship_gain": 0.08, "buffer_hours": 24.0, "store_days": [2, 4, 7]}
INSUFFICIENT = "INSUFFICIENT DATA FOR A RELIABLE RECOMMENDATION."


@dataclass
class DecisionInput:
    produce: str
    maturity: str | None
    mass_kg: float
    state: State
    start: datetime
    origin: str | tuple
    origin_weather_point: str
    prices: dict
    mandis: list[dict]
    storages: list[dict]
    confidence: dict
    value_drop_48h_pct: float = 0.0
    shelf_life_days: float | None = None
    transit_reefer: bool = False
    transit_temp: float | None = None
    transit_rh: float | None = None
    storage_temp: float | None = None
    local_mandi_id: str | None = None
    only_market: str | None = None   # what-if: destination market
    sell_day: float | None = None     # what-if: selling date
    hold_temp: float | None = None    # what-if: storage conditions while holding before the sale
    hold_rh: float | None = None
    speed_factor: float = 1.0
    missing: list = field(default_factory=list)


def _transit(inp: DecisionInput, p, hours: int, src_point: str):
    if inp.transit_temp is not None:
        return Segment("constant", hours, t=inp.transit_temp, rh=inp.transit_rh if inp.transit_rh is not None else 75.0)
    if inp.transit_reefer:
        return Segment("setpoint", hours, t=p.v("t_ref"), rh=(p.v("rh_low") + p.v("rh_high")) / 2)
    return Segment("weather", hours, point=src_point)


def decide(inp: DecisionInput, weather: WeatherStore):
    p = get_produce(inp.produce)
    min_q = p.v("min_arrival_quality")
    buffer_h = THRESHOLDS["buffer_hours"]
    missing = list(inp.missing)
    if inp.confidence.get("category") == "INSUFFICIENT":
        missing.append("confidence too low")
    pts = points()
    # local mandi = nearest by road
    mandis = [m for m in inp.mandis if m["id"] in inp.prices]
    if not mandis:
        missing.append("no market price data")
    if missing and (not mandis or inp.confidence.get("category") == "INSUFFICIENT"):
        return {"action": "INSUFFICIENT_DATA", "message": INSUFFICIENT, "missing": missing, "alternatives": [], "rejected": []}
    legs = {m["id"]: travel(inp.origin, m["id"], inp.speed_factor) for m in mandis}
    local_id = inp.local_mandi_id or min(legs, key=lambda k: legs[k]["km"])
    local = next(m for m in mandis if m["id"] == local_id)
    hold_rh = (p.v("rh_low") + p.v("rh_high")) / 2
    store_t = inp.storage_temp if inp.storage_temp is not None else p.v("t_ref")

    plans: list[Plan] = []
    lg = legs[local_id]
    hl = max(1, round(lg["hours"]))
    if inp.sell_day:
        # what-if selling date: hold under current conditions then sell locally
        hold_h = int(round(inp.sell_day * 24))
        plans.append(Plan("SELL_NOW", "SELL", f"Sell at {local['name']} on day {inp.sell_day:g}",
                          [Segment("constant", hold_h, t=inp.hold_temp, rh=inp.hold_rh if inp.hold_rh is not None else hold_rh)
                           if inp.hold_temp is not None else Segment("weather", hold_h, point=inp.origin_weather_point),
                           _transit(inp, p, hl, inp.origin_weather_point)],
                          hold_h + hl, local_id, local["name"], transport_cost(lg["km"], inp.mass_kg, inp.transit_reefer),
                          handling=COSTS["handling_per_kg"] * inp.mass_kg, meta={"km": round(lg["km"]), "travel_hours": round(lg["hours"], 1)}))
    else:
        wl = auction_wait_hours(inp.start, hl)
        plans.append(Plan("SELL_NOW", "SELL", f"Sell now at {local['name']}",
                          [_transit(inp, p, hl, inp.origin_weather_point), Segment("weather", wl, point=local_id)], hl + wl,
                          local_id, local["name"], transport_cost(lg["km"], inp.mass_kg, inp.transit_reefer),
                          handling=COSTS["handling_per_kg"] * inp.mass_kg,
                          meta={"km": round(lg["km"]), "travel_hours": round(lg["hours"], 1), "route_source": lg["source"], "auction_wait_h": wl}))
    rejected = []
    # STORE options: best suitable storage = nearest that accepts the produce and has capacity
    suitable = []
    for s in inp.storages:
        if inp.produce not in s.get("accepts", []):
            rejected.append({"key": f"STORE@{s['id']}", "label": f"Store at {s['name']}", "reason": f"{s['name']} does not accept {p.display_name.lower()}"})
            continue
        free_t = s.get("capacity_t", 0) - s.get("used_t", 0)
        if free_t * 1000 < inp.mass_kg:
            rejected.append({"key": f"STORE@{s['id']}", "label": f"Store at {s['name']}", "reason": f"{s['name']} has only {free_t:.0f} t free"})
            continue
        suitable.append((travel(inp.origin, s["id"], inp.speed_factor), s))
    if not inp.only_market and suitable:
        leg_s, st = min(suitable, key=lambda x: x[0]["km"])
        out_leg = travel(st["id"], local_id, inp.speed_factor)
        for d in THRESHOLDS["store_days"]:
            hs, ho = max(1, round(leg_s["hours"])), max(1, round(out_leg["hours"]))
            segs = [_transit(inp, p, hs, inp.origin_weather_point), Segment("setpoint", d * 24, t=store_t, rh=hold_rh),
                    _transit(inp, p, ho, inp.origin_weather_point)]
            tc = transport_cost(leg_s["km"], inp.mass_kg, inp.transit_reefer) + transport_cost(out_leg["km"], inp.mass_kg, inp.transit_reefer)
            plans.append(Plan(f"STORE_{d}D", "STORE", f"Store {d} days at {st['name']}, then sell at {local['name']}", segs,
                              hs + d * 24 + ho, local_id, local["name"], tc, rent=st.get("rent_per_kg_day", 0.45) * inp.mass_kg * d,
                              handling=2 * COSTS["handling_per_kg"] * inp.mass_kg,
                              meta={"storage_id": st["id"], "storage_name": st["name"], "days": d, "storage_temp": store_t}))
    # SHIP options: every other mandi
    for m in mandis:
        if m["id"] == local_id or (inp.only_market and m["id"] != inp.only_market):
            continue
        lg = legs[m["id"]]
        h = max(1, round(lg["hours"]))
        wt = auction_wait_hours(inp.start, h)
        plans.append(Plan(f"SHIP_{m['id']}", "SHIP", f"Ship to {m['name']}",
                          [_transit(inp, p, h, inp.origin_weather_point), Segment("weather", wt, point=m["id"])], h + wt,
                          m["id"], m["name"], transport_cost(lg["km"], inp.mass_kg, inp.transit_reefer),
                          handling=COSTS["handling_per_kg"] * inp.mass_kg,
                          meta={"km": round(lg["km"]), "travel_hours": round(lg["hours"], 1), "route_source": lg["source"], "reefer": inp.transit_reefer, "auction_wait_h": wt}))

    results = evaluate_plans(p, inp.maturity, inp.state, inp.mass_kg, inp.start, plans, weather, inp.prices)
    feasible = []
    for r in results:
        reason = None
        sl = r["shelf_life_hours"]
        travel_h = r["sale_hour"]
        if r["quality_at_sale"] < p.v("q_min"):
            reason = f"quality at sale {r['quality_at_sale']:.0f} is below the sellable threshold"
        elif r["kind"] == "SHIP" and sl is not None and sl < r["meta"]["travel_hours"] + buffer_h:
            reason = f"shelf life {sl / 24:.1f} days is shorter than the {r['meta']['travel_hours']:.0f} h trip plus 24 h buffer"
        elif r["kind"] in ("SHIP", "STORE") and r["quality_at_sale"] < min_q:
            reason = f"arrival quality {r['quality_at_sale']:.0f} is below the minimum market grade ({min_q:.0f})"
        elif r["kind"] == "STORE" and sl is not None and sl < r["sale_hour"] + buffer_h:
            reason = f"shelf life {sl / 24:.1f} days does not cover {r['meta']['days']} days storage plus buffer"
        elif r["net"] is None:
            reason = "no price available for this market"
        if reason:
            rejected.append({"key": r["key"], "label": r["label"], "reason": reason, "net": r["net"]})
        else:
            feasible.append(r)

    def choose(which: str):
        cands = [r for r in feasible if r[which]]
        if not cands:
            return None, None
        sell = next((r for r in cands if r["key"] == "SELL_NOW"), None)
        if sell is None:
            best = max(cands, key=lambda r: r[which]["net"])
            return best, "best remaining option"
        sn = sell[which]["net"]
        best_store = max((r for r in cands if r["kind"] == "STORE"), key=lambda r: r[which]["net"], default=None)
        best_ship = max((r for r in cands if r["kind"] == "SHIP"), key=lambda r: r[which]["net"], default=None)
        eligible = [sell]

        def beats(r, gain):
            if r is None:
                return False
            return r[which]["net"] >= sn * (1 + gain) if sn > 0 else r[which]["net"] > sn

        if beats(best_store, THRESHOLDS["store_gain"]):
            eligible.append(best_store)
        if beats(best_ship, THRESHOLDS["ship_gain"]):
            eligible.append(best_ship)
        best = max(eligible, key=lambda r: r[which]["net"])
        return best, None

    best, note = choose("base")
    if best is None:
        return {"action": "NO_FEASIBLE_OPTION", "message": "No option keeps this batch sellable. Consider processing or local sale at a discount.",
                "alternatives": [strip_internal(r) for r in results], "rejected": rejected, "missing": missing}
    low_best, _ = choose("low")
    high_best, _ = choose("high")
    sell = next((r for r in feasible if r["key"] == "SELL_NOW"), None)
    action = best["kind"]
    urgent = False
    if sell:
        waits = [r for r in feasible if r["kind"] == "STORE"]
        best_wait = max((r["net"] for r in waits), default=None)
        if (inp.value_drop_48h_pct / 100 >= THRESHOLDS["sell_urgent_drop_48h"] and inp.shelf_life_days is not None
                and inp.shelf_life_days <= THRESHOLDS["sell_urgent_shelf_days"]):
            urgent = True
        if best_wait is not None and sell["net"] > 0 and best_wait <= sell["net"] * (1 - THRESHOLDS["wait_penalty"]):
            urgent = urgent or action == "SELL"
    pct = None
    if sell and sell["net"] and best["key"] != "SELL_NOW":
        pct = (best["net"] / sell["net"] - 1) * 100 if sell["net"] > 0 else None
    explanation = _explain(best, sell, pct, local, urgent)
    flips = {w: (b["key"] if b else None) for w, b in (("low", low_best), ("base", best), ("high", high_best))}
    depends = len(set(flips.values())) > 1
    alts = sorted([strip_internal(r) for r in feasible], key=lambda r: -(r["net"] or -1e12))
    return {
        "action": action, "urgent": urgent, "recommended": strip_internal(best), "explanation": explanation,
        "alternatives": alts, "rejected": rejected, "local_mandi": {"id": local_id, "name": local["name"]},
        "thresholds": THRESHOLDS, "costs": COSTS, "scenario_check": flips,
        "depends_on_market": depends, "market_note": "Recommendation depends on market direction." if depends else "Recommendation holds under low, base and high price scenarios.",
        "confidence": inp.confidence, "missing": missing, "note": note,
        "labels": {"engine": "Rule-Based Decision Engine", "thresholds": "Demo defaults, configurable per produce", "costs": "Demo default costs (engineering assumptions)"},
    }


def _fmt(n):
    from .format import inr
    return inr(n)


def _explain(best, sell, pct, local, urgent):
    q = best["quality_at_sale"]
    if best["kind"] == "SELL":
        if urgent:
            return f"SELL NOW at {local['name']}: expected {_fmt(best['net'])} net; waiting loses value fast (quality {q:.0f}% at sale)."
        return f"SELL NOW at {local['name']}: expected {_fmt(best['net'])} net; no alternative beats it by the required margin."
    gain = f", {pct:.0f}% above selling at {local['name']} today" if pct is not None else ""
    if best["kind"] == "STORE":
        return f"STORE {best['meta']['days']} days at {best['meta']['storage_name']}: expected {_fmt(best['net'])} net{gain}, selling at {q:.0f}% quality."
    return f"SHIP to {best['market_name']}: expected {_fmt(best['net'])} net{gain}, selling at {q:.0f}% quality."
