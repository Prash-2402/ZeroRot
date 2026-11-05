"""Hosts running simulations: real-time pacing, persistence, WebSocket broadcast and alert notifications."""
from __future__ import annotations

import asyncio
import logging
import threading
from datetime import datetime

from sqlalchemy import delete, select

from app.db.models import (Alert, CorrectiveAction, NotificationSubscription, Prediction, ProduceBatch, QRAccessSession, Simulation,
                           SimulationState, VirtualSensorReading)
from app.db.session import SessionLocal
from app.ws.hub import hub
from .engine import Runtime, initial_state
from .event_manager import ACTION_TEXT
from .state import SimState

log = logging.getLogger("zerorot.sim")
TICK_SECONDS = 1.0


class Manager:
    def __init__(self):
        self.runtimes: dict[int, Runtime] = {}
        self.lock = threading.RLock()
        self.task: asyncio.Task | None = None
        self.last_error: str | None = None

    # ---------- loading ----------
    def runtime(self, db, sim: Simulation) -> Runtime:
        with self.lock:
            rt = self.runtimes.get(sim.id)
            if rt is not None:
                return rt
            snap = db.scalars(select(SimulationState).where(SimulationState.simulation_id == sim.id).order_by(SimulationState.sim_seconds.desc())).first()
            if snap is not None:
                rt = Runtime(sim.id, sim.kind, sim.config, SimState.from_dict(snap.state["state"]), snap.state.get("meta"))
            else:
                rt = Runtime(sim.id, sim.kind, sim.config, initial_state(sim.kind, sim.config))
            self.runtimes[sim.id] = rt
            return rt

    def drop(self, sim_id: int):
        with self.lock:
            self.runtimes.pop(sim_id, None)

    # ---------- persistence ----------
    def persist(self, db, sim: Simulation, rt: Runtime, out: dict):
        rows = []
        for batch in out["readings"]:
            for s in batch["sensors"]:
                if s["kind"] == "gps":
                    continue
                rows.append({"simulation_id": sim.id, "sensor_id": s["id"], "kind": s["kind"], "value": float(s["value"]), "unit": s["unit"],
                             "sim_seconds": batch["t"], "origin": "simulated", "created_at": datetime.utcnow()})
        if rows:
            db.bulk_insert_mappings(VirtualSensorReading, rows)
        p = out.get("prediction")
        if p:
            db.add(Prediction(simulation_id=sim.id, batch_id=sim.batch_id, sim_seconds=p["t"], quality=p["quality"], shelf_life_days=p["shelf_life_days"],
                              shelf_life_p10=p["shelf_life_p10"], shelf_life_p90=p["shelf_life_p90"], spoilage_risk=p["spoilage_probability"],
                              model_version="decay-1.0.0+physics-1", inputs={"assumes": p["assumes"], "t": p["t"]}))
        new_alerts = []
        for f in out["alerts_opened"]:
            a = Alert(simulation_id=sim.id, batch_id=sim.batch_id, truck_id=sim.truck_id, zone_id=sim.zone_id, severity=f.severity, code=f.code,
                      title=f.title, message=f.message, reading=f.reading, expected=f.expected, risk=f.risk, recommendation=f.recommendation,
                      sim_seconds=rt.s.t_seconds)
            db.add(a)
            db.flush()
            if f.action:
                db.add(CorrectiveAction(alert_id=a.id, simulation_id=sim.id, action=f.action, reason=f.recommendation,
                                        parameters={"label": ACTION_TEXT.get(f.action)}, automatic=False, applied=False))
            new_alerts.append(a)
        for code in out["alerts_resolved"]:
            for a in db.scalars(select(Alert).where(Alert.simulation_id == sim.id, Alert.code == code, Alert.status != "resolved")).all():
                a.status = "resolved"
        for act in out["actions"]:
            db.add(CorrectiveAction(simulation_id=sim.id, action=act["action"], reason=act["reason"], parameters=act.get("parameters", {}),
                                    automatic=True, applied=True))
        sim.sim_seconds = rt.s.t_seconds
        if out.get("snapshot"):
            db.add(SimulationState(simulation_id=sim.id, sim_seconds=rt.s.t_seconds, state=rt.snapshot()))
        if out.get("completed"):
            sim.status = "completed"
            sim.config = {**sim.config, "summary": rt.meta.get("summary")}
            if sim.batch_id:
                b = db.get(ProduceBatch, sim.batch_id)
                if b and b.status in ("in_storage", "in_transit"):
                    b.status = "inspected" if sim.kind == "cold_chain" else b.status
        if out.get("error"):
            sim.status = "paused"
            sim.config = {**sim.config, "last_error": out["error"]}
        db.commit()
        return new_alerts

    # ---------- notifications ----------
    def notify(self, db, sim: Simulation, alerts: list[Alert]):
        from app.integrations import push
        from app.services import flow
        try:
            flow.on_sim_alerts(db, sim, alerts)
        except Exception:
            log.exception("flow alert forward failed")
        for a in alerts:
            payload = {"type": "alert", "id": a.id, "severity": a.severity, "title": a.title, "message": a.message,
                       "simulation_id": sim.id, "batch_id": sim.batch_id, "recommendation": a.recommendation}
            hub.publish("alerts", payload)
            hub.publish(f"sim:{sim.id}", {"type": "alert", "data": payload})
            if a.severity == "INFO":
                continue
            subs = db.scalars(select(NotificationSubscription).where(NotificationSubscription.active == True)).all()  # noqa: E712
            for s in subs:
                if s.qr_session_id:
                    q = db.get(QRAccessSession, s.qr_session_id)
                    if q is None or q.revoked or not ((q.resource_type == "simulation" and q.resource_id == sim.id) or
                                                      (q.resource_type == "batch" and q.resource_id == sim.batch_id)):
                        continue
                ok, msg = push.send({"endpoint": s.endpoint, "keys": {"p256dh": s.p256dh, "auth": s.auth}},
                                    {"title": f"ZERO ROT · {a.severity}", "body": f"{a.title}: {a.message}", "url": f"/m?sim={sim.id}"})
                if not ok and ("410" in msg or "404" in msg):
                    s.active = False
            db.commit()

    # ---------- loop ----------
    def tick_once(self) -> list[tuple[int, dict]]:
        updates = []
        with self.lock, SessionLocal() as db:
            sims = db.scalars(select(Simulation).where(Simulation.status == "running")).all()
            for sim in sims:
                try:
                    rt = self.runtime(db, sim)
                    out = rt.advance(sim.speed * TICK_SECONDS)
                    alerts = self.persist(db, sim, rt, out)
                    if alerts:
                        self.notify(db, sim, alerts)
                    if hub.has_subscribers(f"sim:{sim.id}"):
                        updates.append((f"sim:{sim.id}", {"type": "state", "status": sim.status, "speed": sim.speed, "data": rt.live(),
                                                          "error": out.get("error")}))
                except Exception as e:
                    log.exception("simulation %s failed", sim.id)
                    db.rollback()
                    sim.status = "failed"
                    sim.config = {**sim.config, "last_error": f"{type(e).__name__}: {e}"}
                    db.commit()
            from app.services import flow
            try:
                flow.tick(db, TICK_SECONDS)
            except Exception:
                log.exception("flow tick failed")
                db.rollback()
            for topic in [t for t in list(hub.topics) if t.startswith("station:") and hub.has_subscribers(t)]:
                try:
                    updates.append((topic, flow.station_payload(db, int(topic.split(":")[1]))))
                except Exception:
                    log.exception("station payload failed")
        return updates

    async def run(self):
        while True:
            await asyncio.sleep(TICK_SECONDS)
            try:
                for topic, msg in await asyncio.to_thread(self.tick_once):
                    await hub.broadcast(topic, msg)
                self.last_error = None
            except Exception as e:
                self.last_error = repr(e)
                log.exception("manager tick failed")

    def start(self):
        if self.task is None:
            self.task = asyncio.create_task(self.run())

    # ---------- operations ----------
    def reset(self, db, sim: Simulation):
        with self.lock:
            self.drop(sim.id)
            for model in (VirtualSensorReading, SimulationState, Prediction, CorrectiveAction):
                db.execute(delete(model).where(model.simulation_id == sim.id))
            for a in db.scalars(select(Alert).where(Alert.simulation_id == sim.id, Alert.status != "resolved")).all():
                a.status = "resolved"
            sim.sim_seconds, sim.status, sim.scenario = 0.0, "created", None
            cfg = dict(sim.config)
            cfg.pop("summary", None)
            cfg.pop("last_error", None)
            sim.config = cfg
            db.commit()


manager = Manager()
