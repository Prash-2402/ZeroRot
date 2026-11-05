"""Deterministic tools for Mitra. Every number comes from the ZERO ROT engine (same functions the app uses).
Each tool returns {"data": ..., "ui": [actions]}; UI actions tell the farmer app where to go.
State-changing actions are never executed here: they come back as a "confirm" action the farmer must tap."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import domain
from app.db.models import Batch, Trip
from app.api.v1.farm import card, place_of, truck_state
from app.engine.registry import get_produce
from .rag import index

WORDS = {
    "tomato": ["tomato", "tomatoes", "ಟೊಮೇಟೊ", "ಟೊಮ್ಯಾಟೊ", "ಟೊಮೆಟೊ", "ಟಮೋಟ", "shed", "ಶೆಡ್"],
    "mango": ["mango", "mangoes", "ಮಾವು", "ಮಾವಿನ", "cold", "storage", "ಶೀತಲ", "ಕೋಲ್ಡ್"],
    "banana": ["banana", "bananas", "ಬಾಳೆ", "ಬಾಳೆಹಣ್ಣು", "truck", "lorry", "ಲಾರಿ", "ಟ್ರಕ್"],
}
T_REF = {"tomato": 12.5, "mango": 13.0, "banana": 14.0}


def find_batch(db: Session, ref: str | None, context_batch: str | None = None) -> Batch | None:
    batches = db.scalars(select(Batch).where(Batch.status.in_(("stored", "in_transit", "delivered")))).all()
    if ref:
        r = ref.lower()
        for b in batches:
            if b.id.lower() == r:
                return b
        for produce, words in WORDS.items():
            if any(w in r for w in words):
                hit = next((b for b in batches if b.produce == produce), None)
                if hit:
                    return hit
    if context_batch:
        return next((b for b in batches if b.id == context_batch), None)
    return None


def _focus(b: Batch) -> dict:
    return {"type": "focus", "place": place_of(b), "batch_id": b.id}


def farm_overview(db: Session, **_):
    rows = []
    for b in db.scalars(select(Batch).where(Batch.status.in_(("stored", "in_transit", "delivered")))).all():
        c = card(db, b)
        rows.append({k: c[k] for k in ("id", "produce", "place", "quantity_kg", "quality", "days_left", "value_now", "risk")} | {"action": c["action"]["kind"]})
    worst = min(rows, key=lambda r: r["days_left"] if r["days_left"] is not None else 99) if rows else None
    return {"data": {"batches": rows, "most_urgent": worst["id"] if worst else None}, "ui": [{"type": "focus", "place": "yard"}]}


def batch_status(db: Session, batch: str | None = None, context_batch: str | None = None, **_):
    b = find_batch(db, batch, context_batch)
    if b is None:
        return {"data": {"error": "which crop? tomato, mango or banana"}, "ui": []}
    c = card(db, b)
    data = {k: c[k] for k in ("id", "produce", "place", "quantity_kg", "quality", "category", "days_left", "days_p10", "days_p90",
                              "beyond_horizon", "value_now", "price_per_kg", "value_drop_48h_pct", "weather_based")}
    data["confidence"] = c["confidence"]
    data["recommended_action"] = c["action"]
    return {"data": data, "ui": [_focus(b)]}


def future(db: Session, batch: str | None = None, days: float = 3, context_batch: str | None = None, **_):
    b = find_batch(db, batch, context_batch)
    if b is None:
        return {"data": {"error": "which crop?"}, "ui": []}
    c = card(db, b)
    pt = next((f for f in c["future"] if f["day"] >= float(days)), c["future"][-1])
    idx = c["future"].index(pt)
    return {"data": {"id": b.id, "day": pt["day"], "quality": pt["quality"], "value": pt["value"], "days_left": pt["days_left"],
                     "today": {"quality": c["quality"], "value": c["value_now"]}},
            "ui": [_focus(b), {"type": "future", "index": idx}]}


def what_if(db: Session, change: str = "keep_cool", batch: str | None = None, days: float | None = None, market_id: str | None = None,
            temperature: float | None = None, context_batch: str | None = None, **_):
    from app.api.v1.core import WhatIf, recalculate
    b = find_batch(db, batch, context_batch)
    if b is None:
        return {"data": {"error": "which crop?"}, "ui": []}
    body = {"batch_id": b.id}
    if change == "keep_cool":
        body.update(temperature=T_REF[b.produce], humidity=92)
    elif change == "temperature" and temperature is not None:
        body.update(temperature=float(temperature))
    elif change == "sell_later":
        body.update(sell_day=float(days or 2))
    elif change == "send_to":
        body.update(destination_market=market_id or "m_bengaluru")
    r = recalculate(WhatIf(**body), db)
    keys = ("quality_at", "at_day", "shelf_life_days", "value_at", "net_profit", "action_label")
    return {"data": {"id": b.id, "change": change, "inputs": r["inputs"], "now": {k: r["baseline"][k] for k in keys},
                     "if_you_do_this": {k: r["whatif"][k] for k in keys}}, "ui": [_focus(b)]}


def choices(db: Session, batch: str | None = None, context_batch: str | None = None, **_):
    b = find_batch(db, batch, context_batch)
    if b is None:
        return {"data": {"error": "which crop?"}, "ui": []}
    d = domain.decision_for(db, b)
    best = {}
    for a in d.get("alternatives", []):
        if a["kind"] not in best or a["net"] > best[a["kind"]]["net"]:
            best[a["kind"]] = {"label": a["label"], "net": a["net"], "quality_at_sale": a["quality_at_sale"], "market": a["market_name"]}
    return {"data": {"id": b.id, "recommended": d.get("action"), "explanation": d.get("explanation") or d.get("message"), "options": best},
            "ui": [_focus(b), {"type": "open_choices", "batch_id": b.id}]}


def when_to_sell(db: Session, batch: str | None = None, condition: str = "normal", context_batch: str | None = None, **_):
    from app.api.v1.core import market_shift
    b = find_batch(db, batch, context_batch)
    if b is None:
        return {"data": {"error": "which crop?"}, "ui": []}
    cond = condition if condition in ("normal", "price_crash", "festival", "heavy_rain") else "normal"
    p = market_shift(b.id, cond, db)
    return {"data": {"id": b.id, "condition": cond, "recommended": p["recommended"],
                     "periods": [{k: x[k] for k in ("label", "price_per_kg", "quality", "net")} for x in p["periods"]]},
            "ui": [_focus(b), {"type": "open_choices", "batch_id": b.id}]}


def truck(db: Session, **_):
    b = db.scalars(select(Batch).where(Batch.lane_id == "S2")).first()
    st = truck_state(db, b)
    data = {k: st.get(k) for k in ("state", "dest_name", "reefer_status", "cargo_temp", "progress", "rerouted")}
    pr = st.get("pending_reroute") or {}
    if pr.get("recommend") == "reroute" and not pr.get("approved"):
        data["reroute_proposal"] = {k: pr.get(k) for k in ("target_name", "expected_net", "continue_net", "expected_quality", "continue_quality")}
    if st.get("ghost"):
        data["value_protected"] = st["ghost"]["value_protected"]
    ui = [{"type": "focus", "place": "truck", "batch_id": b.id if b else None}]
    if st.get("state") == "parked":
        ui.append({"type": "confirm", "action": "handover", "batch_id": b.id})
    elif data.get("reroute_proposal"):
        ui.append({"type": "confirm", "action": "approve_reroute", "trip_id": "TRIP-S2"})
    return {"data": data, "ui": ui}


def navigate(db: Session, place: str = "yard", **_):
    p = place if place in ("yard", "shed", "cold", "truck") else "yard"
    return {"data": {"place": p}, "ui": [{"type": "focus", "place": p}]}


def knowledge(db: Session, query: str = "", **_):
    hits = index().search(query, k=3)
    return {"data": {"passages": [{"title": h["title"], "heading": h["heading"], "text_en": h["en"], "text_kn": h["kn"], "source": h["source"]} for h in hits]},
            "ui": [], "sources": [{"title": h["title"], "heading": h["heading"], "source": h["source"], "url": h["url"]} for h in hits]}


TOOLS = {"farm_overview": farm_overview, "batch_status": batch_status, "future": future, "what_if": what_if, "choices": choices,
         "when_to_sell": when_to_sell, "truck": truck, "navigate": navigate, "knowledge": knowledge}

_b = {"type": "string", "description": "crop or batch: tomato, mango, banana or a batch id; omit to use the batch on screen"}
SPECS = [
    ("farm_overview", "All batches on the farm with quality, days left, value and the most urgent one.", {}),
    ("batch_status", "Quality now, days of shelf life left (with range), value today, confidence and the recommended action for one batch.", {"batch": _b}),
    ("future", "Predicted quality and value after N days if nothing changes.", {"batch": _b, "days": {"type": "number"}}),
    ("what_if", "Re-run the engine for a change: keep_cool, temperature, sell_later (days), send_to (market_id like m_bengaluru).",
     {"batch": _b, "change": {"type": "string", "enum": ["keep_cool", "temperature", "sell_later", "send_to"]}, "days": {"type": "number"},
      "temperature": {"type": "number"}, "market_id": {"type": "string"}}),
    ("choices", "Sell now / store / ship options with net rupees and the recommendation; opens the choices screen.", {"batch": _b}),
    ("when_to_sell", "Compare selling Today, Day 2, Day 4, Day 7 under a market condition.",
     {"batch": _b, "condition": {"type": "string", "enum": ["normal", "price_crash", "festival", "heavy_rain"]}}),
    ("truck", "Status of the mandi company's truck carrying the bananas: parked, on the road, cooling failure, reroute proposal, value protected.", {}),
    ("navigate", "Move the app camera to a place.", {"place": {"type": "string", "enum": ["yard", "shed", "cold", "truck"]}}),
    ("knowledge", "Search the storage-science and how-ZERO-ROT-works library (UC Davis fact sheets, app docs). Use for general questions.",
     {"query": {"type": "string"}}),
]
TOOL_SPECS = [{"type": "function", "function": {"name": n, "description": d, "parameters": {"type": "object", "properties": p}}} for n, d, p in SPECS]


def run_tool(db: Session, name: str, args: dict, context_batch: str | None):
    fn = TOOLS.get(name)
    if fn is None:
        return {"data": {"error": f"unknown tool {name}"}, "ui": []}
    args = {k: v for k, v in (args or {}).items() if k != "context_batch"}
    return fn(db, context_batch=context_batch, **args)
