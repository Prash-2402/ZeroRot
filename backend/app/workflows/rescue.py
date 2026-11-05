"""Rescue workflow after a reefer failure.

Agentic Rescue Workflow: when Groq is configured and answers within the timeout, the model chooses the
order of tool calls. Tools are deterministic backend functions; the final reroute numbers always come from
the decision/plan engine, never from model text.
Rule-Based Workflow: the same steps run deterministically when Groq is missing, slow (>3 s) or fails.
Rerouting is only a recommendation: a human must approve it."""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta

from sqlalchemy import select

from app import domain
from app.db.models import Batch, Facility, GhostComparison, ImpactEvent, Reading, ReeferEvent, Trip, WorkflowRun, WorkflowStep
from app.db.session import SessionLocal
from app.engine import geo
from app.engine.conditions import Segment
from app.engine.decay import State
from app.engine.format import inr
from app.engine.ghost import compare
from app.engine.plans import COSTS, Plan, auction_wait_hours, evaluate_plans, strip_internal, transport_cost
from app.engine.predict import PredictionInput, predict
from app.engine.registry import get_produce
from app.notify import notify
from app.providers.external import ai_groq, routes_live
from app.simulation.loop import truck_payload, world_lock
from app.simulation.transport import cached_leg, position, remaining_route, straight_leg
from app.ws.hub import hub

log = logging.getLogger("zerorot.rescue")
REPAIR_HOURS = 6
STORE_HOURS = 48
MAX_KM = 220
STAGES = ["Detect", "Assess", "Plan", "Check capacity", "Notify"]


def _leg(lat, lng, target, live_ok: bool):
    leg = cached_leg(lat, lng, target)
    if leg:
        return leg
    if live_ok:
        try:
            r = routes_live.route((lat, lng), (geo.points()[target]["lat"], geo.points()[target]["lng"]))
            return {"coords": [[lng, lat]] + r["coords"], "distance_m": r["distance_m"], "duration_s": r["duration_s"], "source": "osrm_live"}
        except Exception:
            pass
    return straight_leg(lat, lng, target)


def build_plans(db, trip: Trip, b: Batch, *, fail_time, fail_lat, fail_lng, cur_lat, cur_lng, remaining_h_from_fail: float,
                remaining_km_from_fail: float, delay_h: float, t0: float, live_ok: bool = False):
    """Ghost (continue original plan) and rescue candidates, all starting from the failure moment."""
    p = get_produce(b.produce)
    rh_mid = (p.v("rh_low") + p.v("rh_high")) / 2
    pt = domain.weather_point((fail_lat, fail_lng))
    mass = b.quantity_kg
    rem_h = max(1, round(remaining_h_from_fail))
    gw = auction_wait_hours(fail_time, rem_h)  # truck waits (unit still dead) for the next morning auction
    ghost = Plan("CONTINUE", "CONTINUE", f"Continue to {trip.dest_name} with failed reefer",
                 [Segment("reefer_failed", rem_h + gw, point=pt, t0=t0)], rem_h + gw, trip.dest_id, trip.dest_name,
                 transport_cost(remaining_km_from_fail, mass, True), handling=COSTS["handling_per_kg"] * mass,
                 hold_point=trip.dest_id, meta={"hours": rem_h, "km": round(remaining_km_from_fail), "auction_wait_h": gw})
    cands, legs = [], {}
    for f in db.scalars(select(Facility)).all():
        d_km = geo.haversine_km((cur_lat, cur_lng), (f.lat, f.lng))
        if d_km > MAX_KM or f.id == trip.dest_id:
            continue
        if f.type == "cold_storage" and (b.produce not in f.accepts or (f.capacity_t - f.used_t) * 1000 < mass):
            continue
        leg = _leg(cur_lat, cur_lng, f.id, live_ok)
        legs[f.id] = leg
        leg_h = max(1, round(delay_h + leg["duration_s"] / 3600 + 0.25))
        leg_cost = transport_cost(leg["distance_m"] / 1000, mass, True)
        fail_seg = Segment("reefer_failed", leg_h, point=pt, t0=t0)
        if f.type == "cold_storage":
            onward = geo.travel(f.id, trip.dest_id)
            on_h = max(1, round(onward["hours"]))
            on_h += auction_wait_hours(fail_time, leg_h + REPAIR_HOURS + on_h)  # repaired reefer keeps it cold while waiting
            cands.append(Plan(f"RECOOL_{f.id}", "REROUTE", f"Divert to {f.name}: re-cool and repair reefer (~{REPAIR_HOURS} h), then continue to {trip.dest_name}",
                              [fail_seg, Segment("setpoint", REPAIR_HOURS, t=p.v("t_ref"), rh=rh_mid), Segment("setpoint", on_h, t=p.v("t_ref"), rh=rh_mid)],
                              leg_h + REPAIR_HOURS + on_h, trip.dest_id, trip.dest_name,
                              leg_cost + transport_cost(onward["km"], mass, True), rent=f.rent_per_kg_day * mass * REPAIR_HOURS / 24,
                              handling=3 * COSTS["handling_per_kg"] * mass, hold_point=trip.dest_id,
                              meta={"target_id": f.id, "target_name": f.name, "target_type": "cold_storage", "action": "recool_resume",
                                    "leg_km": round(leg["distance_m"] / 1000), "leg_hours": round(leg["duration_s"] / 3600, 1), "route_source": leg["source"]}))
            sale = domain.local_mandi(f.id)
            out = geo.travel(f.id, sale)
            o_h = max(1, round(out["hours"]))
            o_h += auction_wait_hours(fail_time, leg_h + STORE_HOURS + o_h)
            cands.append(Plan(f"STORE_{f.id}", "REROUTE", f"Divert to {f.name}, store 2 days, sell at {geo.points()[sale]['name']}",
                              [fail_seg, Segment("setpoint", STORE_HOURS, t=p.v("t_ref"), rh=rh_mid), Segment("weather", o_h, point=pt)],
                              leg_h + STORE_HOURS + o_h, sale, geo.points()[sale]["name"], leg_cost + transport_cost(out["km"], mass),
                              rent=f.rent_per_kg_day * mass * STORE_HOURS / 24, handling=2 * COSTS["handling_per_kg"] * mass, hold_point=sale,
                              meta={"target_id": f.id, "target_name": f.name, "target_type": "cold_storage", "action": "store_sell",
                                    "leg_km": round(leg["distance_m"] / 1000), "leg_hours": round(leg["duration_s"] / 3600, 1), "route_source": leg["source"]}))
        else:
            sw = auction_wait_hours(fail_time, leg_h)
            cands.append(Plan(f"SELL_{f.id}", "REROUTE", f"Divert to {f.name} and sell at the next auction",
                              [Segment("reefer_failed", leg_h + sw, point=pt, t0=t0)], leg_h + sw, f.id, f.name, leg_cost,
                              handling=COSTS["handling_per_kg"] * mass, hold_point=f.id,
                              meta={"target_id": f.id, "target_name": f.name, "target_type": "mandi", "action": "sell",
                                    "leg_km": round(leg["distance_m"] / 1000), "leg_hours": round(leg["duration_s"] / 3600, 1), "route_source": leg["source"]}))
    return ghost, cands, legs


def failure_context(db, trip: Trip, b: Batch):
    ev = db.scalars(select(ReeferEvent).where(ReeferEvent.trip_id == trip.id, ReeferEvent.kind == "failure").order_by(ReeferEvent.ts.desc())).first()
    return ev.detail if ev else None


def evaluate_rescue(db, trip: Trip, b: Batch, now: datetime, live_ok: bool = False):
    ctx = failure_context(db, trip, b)
    fail_time = datetime.fromisoformat(ctx["time"])
    delay_h = max(0.0, (now - fail_time).total_seconds() / 3600)
    ghost, cands, legs = build_plans(db, trip, b, fail_time=fail_time, fail_lat=ctx["lat"], fail_lng=ctx["lng"], cur_lat=trip.lat, cur_lng=trip.lng,
                                     remaining_h_from_fail=ctx["remaining_h"], remaining_km_from_fail=ctx["remaining_km"], delay_h=delay_h,
                                     t0=ctx["cargo_temp"], live_ok=live_ok)
    st = State(**ctx["state"])
    prices = domain.all_scenarios(db, b.produce)
    res = evaluate_plans(get_produce(b.produce), b.maturity, st, b.quantity_kg, fail_time, [ghost] + cands, domain.weather(db), prices)
    g = res[0]
    options = sorted(res[1:], key=lambda r: -(r["net"] or -1e12))
    min_q = get_produce(b.produce).v("min_arrival_quality")
    feasible = [o for o in options if o["net"] is not None and o["quality_at_sale"] >= min_q]
    best = feasible[0] if feasible else None
    return {"ghost": strip_internal(g), "options": [strip_internal(o) for o in options[:8]], "best": strip_internal(best) if best else None,
            "legs": legs, "ghost_plan": ghost, "plans": {p_.key: p_ for p_ in cands}, "state": st, "fail_time": fail_time, "ctx": ctx}


# ---------------- tools (deterministic) ----------------
def tool_get_trip_status(db, trip, b, now, **_):
    return {"trip_id": trip.id, "batch_id": b.id, "produce": b.produce, "quantity_kg": b.quantity_kg, "destination": trip.dest_name,
            "progress_pct": round(100 * trip.progress_s / trip.duration_s, 1), "reefer_status": trip.reefer_status,
            "cargo_temp_c": round(trip.cargo_temp or 0, 1), "quality": round(b.q, 1), "position": [round(trip.lat, 4), round(trip.lng, 4)]}


def tool_get_recent_readings(db, trip, b, now, **_):
    rows = db.scalars(select(Reading).where(Reading.batch_id == b.id).order_by(Reading.ts.desc()).limit(8)).all()
    return {"readings": [{"ts": r.ts.isoformat(timespec="minutes"), "temp_c": r.temp_c, "rh": r.rh, "origin": r.origin} for r in rows]}


def tool_run_decay_forecast(db, trip, b, now, **_):
    res = domain.twin(db, b, horizon_days=3, store=False)
    return {"quality_now": res["current"]["quality"], "quality_24h": res["future"]["24h"]["quality"],
            "shelf_life_days": res["shelf_life"]["days"], "shelf_life_p10_p90": [res["shelf_life"]["p10_days"], res["shelf_life"]["p90_days"]],
            "value_now": res["current"]["value"], "confidence": res["confidence"]["text"]}


def tool_run_decision_engine(db, trip, b, now, **_):
    ev = evaluate_rescue(db, trip, b, now)
    return {"continue_original_plan": {k: ev["ghost"][k] for k in ("label", "quality_at_sale", "net", "saleable_kg")},
            "best_option": {k: ev["best"][k] for k in ("key", "label", "quality_at_sale", "net", "saleable_kg")} if ev["best"] else None,
            "options": [{k: o[k] for k in ("key", "label", "net", "quality_at_sale")} for o in ev["options"][:5]]}


def tool_check_storage_capacity(db, trip, b, now, facility_id: str | None = None, **_):
    fs = db.scalars(select(Facility).where(Facility.type == "cold_storage")).all()
    out = [{"id": f.id, "name": f.name, "free_t": round(f.capacity_t - f.used_t), "accepts": f.accepts,
            "fits": (f.capacity_t - f.used_t) * 1000 >= b.quantity_kg and b.produce in f.accepts} for f in fs if facility_id in (None, f.id)]
    return {"storages": out}


def tool_draft_farmer_message(db, trip, b, now, **_):
    ev = evaluate_rescue(db, trip, b, now)
    best = ev["best"]
    if not best:
        return {"english": "No better option found; continue and sell on arrival.", "kannada": None}
    return {"english": f"Reefer failed on {b.id}. Recommended: {best['label']}. Expected net {inr(best['net'])} vs {inr(ev['ghost']['net'])} if the truck continues.",
            "kannada": f"ಶಿಫಾರಸು: {best['meta'].get('target_name', best['market_name'])} ಕಡೆಗೆ ತಿರುಗಿಸಿ. ಅಂದಾಜು ನಿವ್ವಳ ಮೌಲ್ಯ {inr(best['net'])}."}


TOOLS = {"get_trip_status": tool_get_trip_status, "get_recent_readings": tool_get_recent_readings,
         "run_decay_forecast": tool_run_decay_forecast, "run_decision_engine": tool_run_decision_engine,
         "check_storage_capacity": tool_check_storage_capacity, "draft_farmer_message": tool_draft_farmer_message}
STAGE_OF = {"get_trip_status": "Detect", "get_recent_readings": "Assess", "run_decay_forecast": "Assess",
            "run_decision_engine": "Plan", "check_storage_capacity": "Check capacity", "draft_farmer_message": "Notify"}
TOOL_SPECS = [{"type": "function", "function": {"name": n, "description": d, "parameters": {"type": "object", "properties": props, "required": []}}}
              for n, d, props in [
                  ("get_trip_status", "Current trip position, reefer status, cargo temperature and quality.", {}),
                  ("get_recent_readings", "Latest simulated cold-chain readings for the batch.", {}),
                  ("run_decay_forecast", "Run the decay engine: quality, shelf life with P10-P90, value.", {}),
                  ("run_decision_engine", "Evaluate continue vs reroute options with the deterministic plan engine.", {}),
                  ("check_storage_capacity", "Free capacity of cold storages.", {"facility_id": {"type": "string"}}),
                  ("draft_farmer_message", "Draft the farmer alert in English and Kannada.", {}),
              ]]
SUMMARY = {
    "get_trip_status": lambda o: f"Reefer {o['reefer_status'].upper()} on {o['trip_id']}: cargo at {o['cargo_temp_c']} °C, {o['progress_pct']}% of the way to {o['destination']}.",
    "get_recent_readings": lambda o: f"Read {len(o['readings'])} latest feed readings (simulated); latest {o['readings'][0]['temp_c'] if o['readings'] else '-'} °C.",
    "run_decay_forecast": lambda o: f"Decay engine: quality {o['quality_now']}% now, {o['quality_24h']}% in 24 h; shelf life {o['shelf_life_days']} days ({o['shelf_life_p10_p90'][0]}–{o['shelf_life_p10_p90'][1]}).",
    "run_decision_engine": lambda o: (f"Best option: {o['best_option']['label']} ({inr(o['best_option']['net'])} net) vs continuing ({inr(o['continue_original_plan']['net'])})."
                                      if o["best_option"] else "No reroute option beats continuing."),
    "check_storage_capacity": lambda o: f"Capacity checked: {sum(1 for s in o['storages'] if s['fits'])} cold storages can take this load.",
    "draft_farmer_message": lambda o: "Drafted Kannada + English alert with approve / store / sell buttons.",
}


async def _emit(run_id: int, idx: int, stage: str, tool: str, summary: str, output: dict, kind: str, trip_id: str):
    with SessionLocal() as db:
        db.add(WorkflowStep(run_id=run_id, idx=idx, stage=stage, tool=tool, summary=summary, output=output, ts=domain.sim_now(db)))
        db.commit()
    await hub.broadcast({"type": "workflow.step", "data": {"run_id": run_id, "trip_id": trip_id, "idx": idx, "stage": stage, "tool": tool,
                                                           "summary": summary, "kind": kind}})


def _call(tool: str, trip_id: str, args: dict | None = None):
    with world_lock:
        with SessionLocal() as db:
            trip = db.get(Trip, trip_id)
            b = db.get(Batch, trip.batch_id)
            out = TOOLS[tool](db, trip, b, domain.sim_now(db), **(args or {}))
            db.commit()
            return json.loads(json.dumps(out, default=str))


async def run_rescue(trip_id: str, step_delay: float = 0.6):
    with SessionLocal() as db:
        trip = db.get(Trip, trip_id)
        run = WorkflowRun(trip_id=trip_id, batch_id=trip.batch_id, kind="rule_based", status="running", started=domain.sim_now(db))
        db.add(run)
        db.commit()
        run_id = run.id
    kind, note, idx = "rule_based", None, 0
    done_tools: list[str] = []
    if ai_groq.configured():
        try:
            kind = "agentic"
            await hub.broadcast({"type": "workflow.start", "data": {"run_id": run_id, "trip_id": trip_id, "kind": kind}})
            msgs = [{"role": "system", "content": "You are the ZERO ROT rescue coordinator for a reefer failure. Call tools to detect, assess, plan, check storage capacity and draft the farmer message. Use every tool once, in the order you judge best, then reply 'done'. Never invent numbers."},
                    {"role": "user", "content": f"Reefer failure on trip {trip_id}. Run the rescue workflow."}]
            for _ in range(8):
                msg = await asyncio.wait_for(asyncio.to_thread(ai_groq.chat, msgs, TOOL_SPECS), timeout=3.5)
                calls = msg.get("tool_calls") or []
                if not calls:
                    break
                msgs.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
                for c in calls:
                    name = c["function"]["name"]
                    if name not in TOOLS:
                        continue
                    args = json.loads(c["function"].get("arguments") or "{}")
                    out = await asyncio.to_thread(_call, name, trip_id, args)
                    idx += 1
                    done_tools.append(name)
                    await _emit(run_id, idx, STAGE_OF[name], name, SUMMARY[name](out), out, kind, trip_id)
                    msgs.append({"role": "tool", "tool_call_id": c["id"], "content": json.dumps(out)[:3000]})
            if len(set(done_tools)) < len(TOOLS):
                raise RuntimeError("model skipped tools")
        except Exception as e:
            note = f"Groq unavailable or slow ({type(e).__name__}); switched to Rule-Based Workflow."
            kind = "rule_based"
    if kind == "rule_based":
        await hub.broadcast({"type": "workflow.start", "data": {"run_id": run_id, "trip_id": trip_id, "kind": kind, "note": note}})
        for name in TOOLS:
            if name in done_tools:
                continue
            await asyncio.sleep(step_delay)
            out = await asyncio.to_thread(_call, name, trip_id)
            idx += 1
            await _emit(run_id, idx, STAGE_OF[name], name, SUMMARY[name](out), out, kind, trip_id)
    # final proposal: numbers from the plan engine only
    proposal = await asyncio.to_thread(_make_proposal, trip_id, run_id, kind)
    with SessionLocal() as db:
        run = db.get(WorkflowRun, run_id)
        run.kind, run.status, run.finished, run.note, run.result = kind, "done", domain.sim_now(db), note, proposal
        db.commit()
    await hub.broadcast({"type": "workflow.done", "data": {"run_id": run_id, "trip_id": trip_id, "kind": kind, "proposal": proposal, "note": note}})
    return proposal


def _make_proposal(trip_id: str, run_id: int, kind: str):
    with world_lock:
        with SessionLocal() as db:
            trip = db.get(Trip, trip_id)
            b = db.get(Batch, trip.batch_id)
            now = domain.sim_now(db)
            ev = evaluate_rescue(db, trip, b, now, live_ok=domain.mode(db) == "real")
            best = ev["best"]
            if not best or best["net"] <= ev["ghost"]["net"]:
                proposal = {"recommend": "continue", "message": "No reroute option beats continuing to the original destination.",
                            "ghost": ev["ghost"], "options": ev["options"], "workflow": kind, "run_id": run_id}
                trip.pending_reroute = proposal
                db.commit()
                return proposal
            leg = ev["legs"][best["meta"]["target_id"]]
            proposal = {"recommend": "reroute", "key": best["key"], "label": best["label"], "target_id": best["meta"]["target_id"],
                        "target_name": best["meta"]["target_name"], "target_type": best["meta"]["target_type"], "action": best["meta"]["action"],
                        "sale_market": best["market_name"], "expected_net": best["net"], "expected_quality": best["quality_at_sale"],
                        "continue_net": ev["ghost"]["net"], "continue_quality": ev["ghost"]["quality_at_sale"],
                        "preview_value_protected": best["net"] - ev["ghost"]["net"], "leg_km": best["meta"]["leg_km"],
                        "leg_hours": best["meta"]["leg_hours"], "route_source": leg["source"], "options": ev["options"], "ghost": ev["ghost"],
                        "workflow": kind, "run_id": run_id, "requires_approval": True, "proposed_at": now.isoformat(timespec="minutes")}
            trip.pending_reroute = proposal
            notify(db, now=now, kind="reroute_proposal", severity="warning", batch=b, trip_id=trip.id, external=True,
                   title=f"Reroute recommended for {b.id}",
                   body=f"{best['label']}. Expected net {inr(best['net'])} vs {inr(ev['ghost']['net'])} if it continues. Needs your approval.",
                   actions=[{"label": "Approve reroute", "action": "approve"}, {"label": "Store", "action": "store"}, {"label": "Sell now", "action": "sell"}],
                   kn_args={"target": best["meta"]["target_name"], "net": inr(best["net"])})
            db.commit()
            return proposal


def approve(db, trip_id: str, via: str = "app", option_key: str | None = None):
    """Human-approved reroute. Value protected = net(reroute) - net(ghost) from the identical failure state."""
    trip = db.get(Trip, trip_id)
    if trip is None:
        raise ValueError("trip not found")
    if not trip.pending_reroute or trip.pending_reroute.get("recommend") != "reroute":
        raise ValueError("no reroute proposal is pending for this trip")
    b = db.get(Batch, trip.batch_id)
    now = domain.sim_now(db)
    ev = evaluate_rescue(db, trip, b, now, live_ok=domain.mode(db) == "real")
    key = option_key or trip.pending_reroute["key"]
    plan = ev["plans"].get(key)
    if plan is None:
        raise ValueError("selected option is no longer feasible")
    cmp_ = compare(b.produce, b.maturity, b.quantity_kg, ev["state"], ev["fail_time"], ev["ghost_plan"], plan,
                   domain.all_scenarios(db, b.produce), domain.weather(db))
    gc = GhostComparison(trip_id=trip.id, batch_id=b.id, ts=now, ghost=cmp_["ghost"], reroute=cmp_["reroute"], start_state=cmp_["start_state"],
                         value_protected=cmp_["value_protected"], food_protected_kg=cmp_["food_protected_kg"], label=cmp_["label"], origin="simulated")
    db.add(gc)
    target = plan.meta["target_id"]
    leg = ev["legs"][target]
    # ghost truck keeps following the original plan
    frac = trip.progress_s / trip.duration_s
    trip.ghost_route = remaining_route(trip.route, frac)
    trip.ghost_duration_s = trip.duration_s - trip.progress_s
    trip.ghost_progress_s = 0
    # real truck changes route only now, after approval
    trip.route, trip.distance_m, trip.duration_s, trip.progress_s = leg["coords"], leg["distance_m"], leg["duration_s"], 0
    trip.route_source = leg["source"]
    trip.dest_id, trip.dest_name = target, geo.points()[target]["name"]
    trip.rerouted, trip.loop = True, False
    trip.pending_reroute = {**trip.pending_reroute, "approved": True, "approved_via": via, "approved_at": now.isoformat(timespec="minutes"),
                            "ghost_comparison_id": None}
    db.flush()
    trip.pending_reroute = {**trip.pending_reroute, "ghost_comparison_id": gc.id}
    db.add(ReeferEvent(trip_id=trip.id, ts=now, kind="reroute_approved", detail={"via": via, "target": target, "value_protected": cmp_["value_protected"]}))
    if cmp_["value_protected"] > 0:
        db.add(ImpactEvent(ts=now, kind="value_protected", batch_id=b.id, trip_id=trip.id, produce=b.produce, district=b.district,
                           value_inr=cmp_["value_protected"], kg=cmp_["food_protected_kg"], origin="simulated"))
    db.add(ImpactEvent(ts=now, kind="alert_handled", batch_id=b.id, trip_id=trip.id, produce=b.produce, district=b.district, origin="simulated"))
    notify(db, now=now, kind="reroute_approved", severity="success", batch=b, trip_id=trip.id, external=True,
           title=f"Reroute approved ({via}) for {b.id}",
           body=(f"Truck now heading to {trip.dest_name}. Estimated value protected {inr(cmp_['value_protected'])} (counterfactual estimate)."
                 if cmp_["value_protected"] > 0 else f"Truck now heading to {trip.dest_name}. {cmp_['message']}"),
           kn_args={"target": trip.dest_name})
    db.commit()
    hub.publish({"type": "trip.update", "data": {"trip": trip_dict(trip, b), "ghost_comparison": ghost_dict(gc)}})
    return {"trip": trip_dict(trip, b), "ghost_comparison": ghost_dict(gc)}


def trip_dict(t: Trip, b: Batch | None = None) -> dict:
    d = {"id": t.id, "batch_id": t.batch_id, "lane_id": t.lane_id, "origin_id": t.origin_id, "dest_id": t.dest_id, "dest_name": t.dest_name,
         "route": t.route, "route_source": t.route_source, "distance_km": round(t.distance_m / 1000, 1), "duration_h": round(t.duration_s / 3600, 2),
         "progress_s": t.progress_s, "duration_s": t.duration_s, "status": t.status, "reefer": t.reefer, "reefer_status": t.reefer_status,
         "cargo_temp": t.cargo_temp, "cargo_rh": t.cargo_rh, "lat": t.lat, "lng": t.lng, "started_at": domain.iso(t.started_at),
         "failed_at": domain.iso(t.failed_at), "pending_reroute": t.pending_reroute, "rerouted": t.rerouted, "ghost_route": t.ghost_route,
         "is_scenario": t.is_scenario, "origin": t.origin,
         "origin_name": geo.points().get(t.origin_id, {}).get("name", t.origin_id)}
    if b is not None:
        d["truck"] = truck_payload(t, b)
    return d


def ghost_dict(g: GhostComparison) -> dict:
    return {"id": g.id, "trip_id": g.trip_id, "batch_id": g.batch_id, "ts": domain.iso(g.ts), "ghost": g.ghost, "reroute": g.reroute,
            "start_state": g.start_state, "value_protected": g.value_protected, "food_protected_kg": g.food_protected_kg, "label": g.label,
            "origin": g.origin, "reroute_better": g.value_protected > 0}


def inject_failure(db, trip_id: str):
    trip = db.get(Trip, trip_id)
    if trip is None:
        raise ValueError("trip not found")
    if trip.status != "in_transit":
        raise ValueError("trip is not in transit")
    if not trip.reefer:
        raise ValueError("this truck has no reefer unit")
    if trip.reefer_status == "failed":
        raise ValueError("reefer already failed")
    b = db.get(Batch, trip.batch_id)
    now = domain.sim_now(db)
    trip.reefer_status, trip.failed_at = "failed", now
    remaining_h = (trip.duration_s - trip.progress_s) / 3600
    remaining_km = (1 - trip.progress_s / trip.duration_s) * trip.distance_m / 1000
    detail = {"time": now.isoformat(), "lat": trip.lat, "lng": trip.lng, "cargo_temp": trip.cargo_temp, "remaining_h": remaining_h,
              "remaining_km": remaining_km, "state": domain.state_of(b).as_dict(), "progress_s": trip.progress_s}
    db.add(ReeferEvent(trip_id=trip.id, ts=now, kind="failure", detail=detail))
    notify(db, now=now, kind="reefer_failure", severity="critical", batch=b, trip_id=trip.id, external=True,
           title=f"Reefer FAILED on {trip.id} ({b.id})",
           body=f"Reefer unit stopped at {trip.cargo_temp:.1f} °C, {remaining_km:.0f} km from {trip.dest_name}. Cargo temperature will climb toward ambient (simulated fault).")
    db.commit()
    return detail
