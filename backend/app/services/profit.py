"""Sell now vs store and sell later.

Revenue = saleable quantity x price x grade factor(quality)
Net profit = revenue - storage cost - transport cost - commission - other costs
Saleable quantity = quantity x (1 - weight loss) x (1 - rejected), zero once quality falls below the sellable threshold.
Quality over time comes from the decay engine at the chosen storage conditions; the price path comes from the
numerical forecast when one exists, otherwise the current verified/manual price is held flat and labelled so."""
from __future__ import annotations

import zlib

import numpy as np

from app.engine.decay import State, crossing_hours, make_params, simulate
from app.engine.registry import get_produce
from app.engine.value import grade_factor


def evaluate(*, commodity: str, maturity: str | None, quantity_kg: float, quality: float, price_now_per_kg: float, price_origin: str,
             forecast_points: list[dict] | None, storage_temp: float, storage_rh: float, storage_cost_per_kg_day: float,
             transport_cost: float, commission_rate: float, other_costs: float, max_days: int = 14, seed_key: str = "profit") -> dict:
    p = get_produce(commodity)
    hours = max_days * 24 + 1
    temps, rhs = np.full(hours, storage_temp), np.full(hours, storage_rh)
    Q, W, R, _ = simulate(make_params(p, maturity), State(q=quality), temps, rhs)
    mc = make_params(p, maturity, draws=100, seed=zlib.crc32(seed_key.encode()))
    Qm, *_ = simulate(mc, State(q=quality), temps, rhs)
    sl = crossing_hours(Q, p.v("q_min"))[0]
    sl_mc = crossing_hours(Qm, p.v("q_min"))
    p10_h = float(np.nanpercentile(np.where(np.isnan(sl_mc), hours, sl_mc), 10))
    price_by_day = {0: price_now_per_kg}
    band_by_day = {0: (price_now_per_kg, price_now_per_kg)}
    if forecast_points:
        for i, pt in enumerate(forecast_points, start=1):
            price_by_day[i] = pt["price"]
            band_by_day[i] = (pt.get("low", pt["price"]), pt.get("high", pt["price"]))
    rows = []
    for d in range(0, max_days + 1):
        h = d * 24
        q, w, r = float(Q[0, h]), float(W[0, h]), float(R[0, h])
        sellable = q >= p.v("q_min")
        saleable = quantity_kg * (1 - w) * (1 - r) if sellable else 0.0
        price = price_by_day.get(d, price_by_day[max(price_by_day)] if forecast_points else price_now_per_kg)
        lo, hi = band_by_day.get(d, (price, price))
        risk = float(np.mean(Qm[:, h] < p.v("q_min"))) * 100
        gf = float(grade_factor(q))
        revenue = saleable * price * gf
        storage = quantity_kg * storage_cost_per_kg_day * d
        commission = commission_rate * revenue
        net = revenue - storage - transport_cost - commission - other_costs
        rows.append({"day": d, "quality": round(q, 1), "saleable_kg": round(saleable, 1), "spoilage_loss_kg": round(quantity_kg - saleable, 1),
                     "price_per_kg": round(price, 2), "price_low": round(lo, 2), "price_high": round(hi, 2), "spoil_risk_pct": round(risk, 1),
                     "quality_p10": round(float(np.percentile(Qm[:, h], 10)), 1), "quality_p90": round(float(np.percentile(Qm[:, h], 90)), 1),
                     "grade_factor": round(gf, 3), "revenue": round(revenue, 2), "storage_cost": round(storage, 2),
                     "transport_cost": round(transport_cost, 2), "commission": round(commission, 2), "other_costs": round(other_costs, 2),
                     "net_profit": round(net, 2), "within_shelf_life_p10": h <= p10_h,
                     "price_basis": "forecast" if (forecast_points and d in price_by_day and d > 0) else ("current price held flat (no forecast)" if d > 0 else price_origin)})
    feasible = [r for r in rows if r["within_shelf_life_p10"] and r["saleable_kg"] > 0]
    best = max(feasible, key=lambda r: r["net_profit"]) if feasible else rows[0]
    now = rows[0]
    rec = "sell_now" if best["day"] == 0 or best["net_profit"] <= now["net_profit"] else "store_and_sell_later"
    gain = best["net_profit"] - now["net_profit"]
    return {"recommendation": rec, "best_day": best["day"] if rec != "sell_now" else 0, "sell_now": now, "best": best if rec != "sell_now" else now,
            "gain_vs_now": round(gain if rec != "sell_now" else 0.0, 2), "rows": rows,
            "shelf_life_days": None if np.isnan(sl) else round(sl / 24, 2), "shelf_life_p10_days": round(p10_h / 24, 2),
            "assumptions": [f"Storage at {storage_temp} degC / {storage_rh}% RH for the whole period.",
                            f"Current price {price_now_per_kg} Rs/kg ({price_origin}).",
                            "Future prices from the numerical price forecast (see its backtest)." if forecast_points else "No price forecast available: future price assumed equal to today's (no increase is assumed).",
                            f"Storage cost {storage_cost_per_kg_day} Rs/kg/day; transport {transport_cost} Rs; commission {commission_rate * 100:.1f}%; other costs {other_costs} Rs.",
                            "Days beyond the pessimistic (P10) shelf life are excluded from the recommendation.",
                            "Quality from the Q10 decay engine (calibrated to published storage life; curve shape not validated)."]}
