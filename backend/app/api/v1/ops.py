"""PROTECT endpoints + operations: dashboard, markets, trips, reefer failure, reroute, ghost, notifications,
mode/integrations, demo reset/scenarios, judge mode and Telegram callbacks."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import domain
from app.core.config import settings
from app.db.models import (Batch, Facility, GhostComparison, IntegrationStatus, MarketPrice, Notification, StorageRecord, Trip,
                           WorkflowRun, WorkflowStep)
from app.db.session import SessionLocal, get_db
from app.engine import geo
from app.engine.format import inr
from app.engine.value import MARKET_CONDITIONS
from app.notify import notification_dict, notify
from app.providers import external as ext
from app.providers.notify import WhatsAppPreviewProvider, telegram
from app.simulation import loop as sim
from app.simulation.transport import lane_route, position, straight_leg
from app.workflows import rescue
from app.ws.hub import hub

router = APIRouter()


def err(status, code, message):
    raise HTTPException(status, detail={"error": code, "message": message})


# ---------------- dashboard ----------------
def latest_prices(db: Session):
    rows = {}
    for r in db.scalars(select(MarketPrice).order_by(MarketPrice.date)).all():
        rows[(r.commodity, r.mandi_id)] = r
    names = {m["id"]: m["name"] for m in geo.locations()["mandis"]}
    out = []
    for (c, m), r in rows.items():
        prev = db.scalars(select(MarketPrice).where(MarketPrice.commodity == c, MarketPrice.mandi_id == m, MarketPrice.date < r.date)
                          .order_by(MarketPrice.date.desc())).first()
        out.append({"commodity": c, "mandi_id": m, "mandi": names.get(m, m), "modal_per_kg": round(r.modal_price / 100, 2),
                    "date": r.date.date().isoformat(), "change_pct": round((r.modal_price / prev.modal_price - 1) * 100, 1) if prev else None,
                    "origin": r.origin, "source": r.source})
    return out


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db)):
    st = sim.stats(db)
    trips = db.scalars(select(Trip).where(Trip.status == "in_transit")).all()
    batches = {b.id: b for b in db.scalars(select(Batch)).all()}
    alerts = db.scalars(select(Notification).where(Notification.channel == "in_app").order_by(Notification.id.desc()).limit(25)).all()
    stored = [domain.fmt_batch(db, b) for b in batches.values() if b.status in ("stored", "delivered")]
    return {"stats": st, "sim_now": domain.iso(domain.sim_now(db)), "mode": domain.mode(db),
            "trips": [rescue.trip_dict(t, batches.get(t.batch_id)) for t in trips],
            "stored_batches": stored, "facilities": domain.mandis(db) + domain.storages(db),
            "alerts": [notification_dict(n) for n in alerts], "ticker": latest_prices(db),
            "market_condition": domain.market_condition(db), "speed": domain.get_state(db, "sim_speed"),
            "labels": {"feed": "SIMULATED cold-chain feed", "prices": "Mandi prices: SIMULATED seed (no Agmarknet key)",
                       "weather": "Weather: Open-Meteo forecast (real, cached)"}}


# ---------------- markets ----------------
def crash_warnings(db: Session):
    out = []
    mc = domain.market_condition(db)
    for c in ("tomato", "mango", "banana"):
        for m in geo.locations()["mandis"]:
            series, src, origin = domain.price_series(db, c, m["id"])
            if len(series) < 8:
                continue
            last = series[-1].price_per_kg
            wk = series[-8].price_per_kg
            chg = last / wk - 1
            vals = np.array([s.price_per_kg for s in series[-15:]])
            vol = float(np.std(np.diff(np.log(vals)))) if len(vals) > 3 else 0
            if chg <= -0.12:
                out.append({"commodity": c, "mandi_id": m["id"], "mandi": m["name"], "kind": "Observed decline",
                            "detail": f"Modal price down {abs(chg) * 100:.0f}% over the last 7 reported days", "origin": origin})
            elif vol >= 0.09:
                out.append({"commodity": c, "mandi_id": m["id"], "mandi": m["name"], "kind": "Potential risk",
                            "detail": f"High day-to-day volatility ({vol * 100:.0f}% per day)", "origin": origin})
        if mc["condition"] == "price_crash":
            mid = mc.get("mandi_id") or "m_kolar"
            out.insert(0, {"commodity": c, "mandi_id": mid, "mandi": geo.points()[mid]["name"], "kind": "Forecast decline",
                           "detail": "Demo scenario: arrivals up 40%, prices expected to fall ~30% over 3 days. Not a confirmed crash.", "origin": "scenario"})
    return out


@router.get("/markets")
def markets(db: Session = Depends(get_db)):
    return {"mandis": domain.mandis(db), "latest": latest_prices(db), "warnings": crash_warnings(db),
            "market_condition": domain.market_condition(db), "conditions": {k: v["label"] for k, v in MARKET_CONDITIONS.items()},
            "label": "Prices are SIMULATED seed data until a data.gov.in key is configured (REAL MODE)."}


@router.get("/market-prices")
def market_prices(commodity: str = "tomato", mandi: str = "m_kolar", db: Session = Depends(get_db)):
    series, src, origin = domain.price_series(db, commodity, mandi)
    scen = domain.scenario_for(db, commodity, mandi, horizon=14)
    return {"commodity": commodity, "mandi": mandi, "mandi_name": geo.points().get(mandi, {}).get("name"), "origin": origin, "source": src,
            "history": [{"date": s.day.isoformat(), "price_per_kg": round(s.price_per_kg, 2)} for s in series], "scenarios": scen}


class ConditionIn(BaseModel):
    condition: str
    mandi_id: str | None = "m_kolar"


@router.post("/markets/condition")
def set_condition(body: ConditionIn, db: Session = Depends(get_db)):
    if body.condition not in MARKET_CONDITIONS:
        err(422, "invalid_input", "unknown condition")
    with sim.world_lock:
        domain.set_state(db, "market_condition", {"condition": body.condition, "mandi_id": body.mandi_id})
        if body.condition != "normal":
            notify(db, now=domain.sim_now(db), kind="price_warning", severity="warning", title=f"Market shift: {MARKET_CONDITIONS[body.condition]['label']}",
                   body=MARKET_CONDITIONS[body.condition]["banner"])
        db.commit()
    sim.refresh_status(db)
    db.commit()
    return domain.market_condition(db)


# ---------------- trips ----------------
@router.get("/trips")
def trips(include_arrived: bool = True, db: Session = Depends(get_db)):
    q = select(Trip)
    if not include_arrived:
        q = q.where(Trip.status == "in_transit")
    batches = {b.id: b for b in db.scalars(select(Batch)).all()}
    return {"trips": [rescue.trip_dict(t, batches.get(t.batch_id)) for t in db.scalars(q).all()]}


class TripIn(BaseModel):
    batch_id: str
    dest_id: str
    reefer: bool = False


@router.post("/trips", status_code=201)
def create_trip(body: TripIn, db: Session = Depends(get_db)):
    with sim.world_lock:
        b = db.get(Batch, body.batch_id)
        if b is None:
            err(404, "not_found", "batch not found")
        if b.status == "in_transit":
            err(409, "conflict", "batch is already in transit")
        if body.dest_id not in geo.points():
            err(422, "invalid_input", "unknown destination")
        src = b.facility_id if (b.facility_id and b.facility_id in geo.points()) else b.district
        coords, dist_m, dur_s, source = lane_route(src, body.dest_id)
        if source != "osrm_cached" and domain.mode(db) == "real":
            try:
                a, d = geo.points()[src], geo.points()[body.dest_id]
                r = ext.routes_live.route((a["lat"], a["lng"]), (d["lat"], d["lng"]))
                coords, dist_m, dur_s, source = r["coords"], r["distance_m"], r["duration_s"], "osrm_live"
            except Exception:
                pass
        now = domain.sim_now(db)
        tid = f"TRIP-{b.id[3:]}-{now.strftime('%H%M')}"
        t = Trip(id=tid, batch_id=b.id, origin_id=src, dest_id=body.dest_id, dest_name=geo.points()[body.dest_id]["name"], route=coords,
                 route_source=source, distance_m=dist_m, duration_s=dur_s, progress_s=0, reefer=body.reefer,
                 reefer_status="ok" if body.reefer else "na", lat=coords[0][1], lng=coords[0][0], started_at=now, loop=False,
                 cargo_temp=None, origin="manual")
        db.add(t)
        b.status = "in_transit"
        db.add(StorageRecord(batch_id=b.id, storage_type="reefer" if body.reefer else "truck",
                             label=f"{'Reefer' if body.reefer else 'Open'} truck to {t.dest_name}", start=now, origin="manual"))
        db.commit()
        out = rescue.trip_dict(t, b)
    hub.publish({"type": "trip.update", "data": {"trip": out}})
    return out


@router.post("/trips/{trip_id}/inject-failure")
async def inject(trip_id: str):
    def _do():
        with sim.world_lock:
            with SessionLocal() as db:
                return rescue.inject_failure(db, trip_id)
    try:
        detail = await asyncio.to_thread(_do)
    except ValueError as e:
        err(409, "conflict", str(e))
    asyncio.create_task(rescue.run_rescue(trip_id))
    return {"ok": True, "failure": detail, "message": "Reefer failure injected (simulated). Rescue workflow started."}


class ApproveIn(BaseModel):
    option_key: str | None = None
    via: str = "app"


def _approve(trip_id: str, option_key: str | None, via: str):
    with sim.world_lock:
        with SessionLocal() as db:
            return rescue.approve(db, trip_id, via=via, option_key=option_key)


@router.post("/trips/{trip_id}/approve-reroute")
async def approve(trip_id: str, body: ApproveIn | None = None):
    body = body or ApproveIn()
    try:
        return await asyncio.to_thread(_approve, trip_id, body.option_key, body.via)
    except ValueError as e:
        err(409, "conflict", str(e))


@router.get("/ghost/{trip_id}")
def ghost(trip_id: str, db: Session = Depends(get_db)):
    t = db.get(Trip, trip_id)
    if t is None:
        err(404, "not_found", "trip not found")
    g = db.scalars(select(GhostComparison).where(GhostComparison.trip_id == trip_id).order_by(GhostComparison.id.desc())).first()
    b = db.get(Batch, t.batch_id)
    return {"trip": rescue.trip_dict(t, b), "comparison": rescue.ghost_dict(g) if g else None,
            "label": "Estimated counterfactual simulation, not measured savings."}


@router.get("/workflows/{trip_id}")
def workflow(trip_id: str, db: Session = Depends(get_db)):
    run = db.scalars(select(WorkflowRun).where(WorkflowRun.trip_id == trip_id).order_by(WorkflowRun.id.desc())).first()
    if run is None:
        return {"run": None, "steps": []}
    steps = db.scalars(select(WorkflowStep).where(WorkflowStep.run_id == run.id).order_by(WorkflowStep.idx)).all()
    return {"run": {"id": run.id, "kind": run.kind, "status": run.status, "note": run.note, "result": run.result,
                    "label": "Agentic Rescue Workflow (Groq tool calling)" if run.kind == "agentic" else "Rule-Based Workflow"},
            "steps": [{"idx": s.idx, "stage": s.stage, "tool": s.tool, "summary": s.summary, "ts": domain.iso(s.ts)} for s in steps]}


# ---------------- notifications ----------------
@router.get("/notifications")
def notifications(limit: int = 50, channel: str | None = None, db: Session = Depends(get_db)):
    q = select(Notification).order_by(Notification.id.desc()).limit(min(limit, 200))
    if channel:
        q = q.where(Notification.channel == channel)
    rows = db.scalars(q).all()
    unread = sum(1 for n in rows if not n.read and n.channel == "in_app")
    return {"notifications": [notification_dict(n) for n in rows], "unread": unread}


@router.post("/notifications/read")
def mark_read(db: Session = Depends(get_db)):
    for n in db.scalars(select(Notification).where(Notification.read == False)).all():  # noqa: E712
        n.read = True
    db.commit()
    return {"ok": True}


# ---------------- mode & integrations ----------------
def check_integrations(db: Session):
    m = domain.mode(db)
    rows = []
    def add(name, provider, status, detail):
        rows.append({"name": name, "provider": provider, "status": status, "detail": detail})
    if m == "demo":
        add("weather", ext.weather_cached.name, *ext.weather_cached.check())
        add("mandi", ext.mandi_cached.name, *ext.mandi_cached.check())
        add("routes", ext.routes_cached.name, *ext.routes_cached.check())
        add("ai", ext.ai_rules.name, *ext.ai_rules.check())
        add("notify", "InAppProvider", "demo", "In-app notifications" + (" + Telegram (configured)" if telegram.configured() else ""))
    else:
        try:
            ws = ext.weather_live.fetch()
            domain.set_live_weather(ws)
            add("weather", ext.weather_live.name, "ok", "Open-Meteo live forecast loaded")
        except Exception as e:
            domain.set_live_weather(None)
            add("weather", ext.weather_live.name, "unavailable", f"Open-Meteo unreachable ({type(e).__name__}); using cached forecast (labelled cached)")
        if ext.mandi_live.configured():
            try:
                n = len(ext.mandi_live.fetch())
                add("mandi", ext.mandi_live.name, "ok", f"Agmarknet reachable ({n} Karnataka records today)")
            except Exception as e:
                add("mandi", ext.mandi_live.name, "unavailable", f"Agmarknet error ({type(e).__name__}); prices shown are SIMULATED seed")
        else:
            add("mandi", ext.mandi_live.name, "unavailable", "DATA_GOV_API_KEY not set; prices shown are SIMULATED seed")
        add("routes", ext.routes_live.name, *ext.routes_live.check())
        add("ai", ext.ai_groq.name, *ext.ai_groq.check())
        add("notify", "TelegramProvider", *telegram.check())
    add("whatsapp", "WhatsAppPreviewProvider", *WhatsAppPreviewProvider().check())
    add("transport_feed", ext.transport_sim.name, *ext.transport_sim.check())
    add("iot", ext.transport_iot.name, *ext.transport_iot.check())
    now = datetime.now()
    for r in rows:
        row = db.get(IntegrationStatus, r["name"])
        if row is None:
            db.add(IntegrationStatus(name=r["name"], status=r["status"], provider=r["provider"], detail=r["detail"], checked_at=now))
        else:
            row.status, row.provider, row.detail, row.checked_at = r["status"], r["provider"], r["detail"], now
    db.commit()
    return rows


@router.get("/integrations")
def integrations(db: Session = Depends(get_db)):
    rows = db.scalars(select(IntegrationStatus)).all()
    if not rows:
        return {"mode": domain.mode(db), "integrations": check_integrations(db)}
    return {"mode": domain.mode(db), "integrations": [{"name": r.name, "provider": r.provider, "status": r.status, "detail": r.detail,
                                                       "checked_at": r.checked_at.isoformat(timespec="seconds")} for r in rows],
            "keys": {"groq": bool(settings.groq_api_key), "data_gov": bool(settings.data_gov_api_key), "telegram": telegram.configured()}}


class ModeIn(BaseModel):
    mode: str


@router.post("/mode")
async def set_mode(body: ModeIn):
    if body.mode not in ("demo", "real"):
        err(422, "invalid_input", "mode must be demo or real")

    def _do():
        with SessionLocal() as db:
            domain.set_state(db, "mode", {"mode": body.mode})
            db.commit()
            return check_integrations(db)
    rows = await asyncio.to_thread(_do)
    await hub.broadcast({"type": "mode", "data": {"mode": body.mode, "integrations": rows}})
    return {"mode": body.mode, "integrations": rows}


# ---------------- demo ----------------
def do_reset():
    from app.db.seed import seed
    with sim.world_lock:
        sim.reset_runtime()
        domain.set_live_weather(None)
        with SessionLocal() as db:
            m = domain.mode(db)
        took = seed()
        with SessionLocal() as db:
            domain.set_state(db, "mode", {"mode": m})
            db.commit()
            check_integrations(db)
    return took


@router.post("/demo/reset")
async def reset():
    took = await asyncio.to_thread(do_reset)
    await hub.broadcast({"type": "reset", "data": {"seconds": took}})
    return {"ok": True, "seconds": took, "message": "Demo reset to the deterministic start state."}


@router.post("/demo/scenario/{n}")
async def scenario(n: int):
    if n not in (1, 2, 3):
        err(404, "not_found", "scenario must be 1, 2 or 3")
    took = await asyncio.to_thread(do_reset)
    out = {"scenario": n, "reset_seconds": took}
    if n == 1:
        out.update({"navigate": "/?focus=shed", "batch_id": "ZR-TOM-001", "prefill": {"produce": "tomato", "quantity_kg": 500, "district": "kolar", "storage_type": "open_shed",
                                                              "maturity": "mature_green", "initial_quality": 95, "variety": "Local hybrid", "farmer_name": "Demo farmer"}})
    elif n == 2:
        def _hand():
            from app.api.v1.farm import handover
            with sim.world_lock:
                with SessionLocal() as db:
                    handover(db, "ZR-BAN-001")
        await asyncio.to_thread(_hand)
        out.update({"navigate": "/?focus=truck", "trip_id": "TRIP-S2", "batch_id": "ZR-BAN-001",
                    "hint": "Simulate a breakdown on the mandi company's truck (or press F)."})
    else:
        def _cond():
            with SessionLocal() as db:
                domain.set_state(db, "market_condition", {"condition": "price_crash", "mandi_id": "m_kolar"})
                notify(db, now=domain.sim_now(db), kind="price_warning", severity="warning", title="Market shift: Price crash at Kolar APMC",
                       body=MARKET_CONDITIONS["price_crash"]["banner"])
                db.commit()
        await asyncio.to_thread(_cond)
        out.update({"navigate": "/?focus=cold", "batch_id": "ZR-MAN-001", "condition": "price_crash"})
    await hub.broadcast({"type": "reset", "data": out})
    return out


class SpeedIn(BaseModel):
    minutes_per_tick: float | None = None
    paused: bool | None = None


@router.post("/demo/speed")
def speed(body: SpeedIn, db: Session = Depends(get_db)):
    cur = domain.get_state(db, "sim_speed") or {"minutes_per_tick": settings.sim_minutes_per_tick, "paused": False}
    if body.minutes_per_tick is not None:
        if not 0.5 <= body.minutes_per_tick <= 60:
            err(422, "invalid_input", "minutes_per_tick must be 0.5-60")
        cur["minutes_per_tick"] = body.minutes_per_tick
    if body.paused is not None:
        cur["paused"] = body.paused
    domain.set_state(db, "sim_speed", cur)
    db.commit()
    return cur


# ---------------- judge mode ----------------
@router.post("/judge/session")
def judge_session(db: Session = Depends(get_db)):
    from app.api.v1.core import BatchCreate, create_batch
    with sim.world_lock:
        b = create_batch(db, BatchCreate(produce="tomato", variety="Local hybrid", quantity_kg=500, maturity="turning", initial_quality=94,
                                         district="kolar", storage_type="open_shed", is_judge=True))
        notify(db, now=domain.sim_now(db), kind="judge", severity="info", batch=b, title=f"Judge farmer registered {b.id}",
               body="500 kg tomatoes, Kolar, open shed. Watch it on the Control Room map.")
        db.commit()
    out = domain.fmt_batch(db, b)
    hub.publish({"type": "batch.new", "data": out})
    return out


# ---------------- telegram ----------------
def handle_telegram_update(upd: dict):
    cb = upd.get("callback_query")
    if not cb:
        return
    action, trip_id, batch_id = (cb.get("data", "") + "||").split("|")[:3]
    try:
        if action in ("approve", "store", "sell") and trip_id:
            key = None
            if action != "approve":
                with SessionLocal() as db:
                    t = db.get(Trip, trip_id)
                    opts = (t.pending_reroute or {}).get("options", []) if t else []
                    pref = ("STORE_", "RECOOL_") if action == "store" else ("SELL_",)
                    key = next((o["key"] for o in opts if o["key"].startswith(pref)), None)
            _approve(trip_id, key, f"telegram:{action}")
            telegram.answer_callback(cb["id"], "Done. ZERO ROT updated the route.")
        else:
            telegram.answer_callback(cb["id"], "No action for this alert.")
    except Exception as e:
        telegram.answer_callback(cb["id"], f"Could not apply: {e}"[:180])


@router.post("/telegram/webhook")
async def telegram_webhook(request: Request):
    upd = await request.json()
    await asyncio.to_thread(handle_telegram_update, upd)
    return {"ok": True}


# ---------------- geo & network (for the map and the judge-mode QR) ----------------
@router.get("/geo/outline")
def outline():
    import json
    f = geo.SEED_DIR / "karnataka_outline.geojson"
    return json.loads(f.read_text()) if f.exists() else {"type": "FeatureCollection", "features": []}


@router.get("/geo/points")
def geo_points():
    return {"points": list(geo.points().values())}


@router.get("/network")
def network():
    """LAN addresses so the Control Room QR code opens judge mode on a phone on the same network."""
    import socket
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ips.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    return {"ips": ips}
