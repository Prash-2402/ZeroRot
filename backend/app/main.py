"""ZERO ROT API. Run: python -m uvicorn app.main:app --app-dir backend --port 8000"""
from __future__ import annotations

import asyncio
import logging

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.v1 import auth, catalog, flow as flow_api, intelligence, operations, simulations
from app.core.config import BACKEND, ROOT, settings
from app.core.deps import limiter, principal_from_ws_token
from app.db.session import SessionLocal
from app.simulation.manager import manager
from app.ws.hub import hub

logging.basicConfig(level=logging.INFO, format='{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}')
log = logging.getLogger("zerorot")

app = FastAPI(title="ZERO ROT API", version="2.0.0",
              description="Post-harvest loss prevention and cold-chain digital twin. Numerical models + Groq explanations. "
                          "Virtual sensors are SIMULATED; external data is LIVE or reported unavailable.")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=False, allow_methods=["GET", "POST", "PATCH", "DELETE"],
                   allow_headers=["Authorization", "Content-Type"])


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    if request.url.path.startswith("/api/") and not limiter.check(f"ip:{request.client.host if request.client else '?'}"):
        return JSONResponse(status_code=429, content={"detail": {"error": "rate_limited", "message": "Too many requests; slow down"}})
    return await call_next(request)


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError):
    msgs = [f"{'.'.join(str(x) for x in e['loc'][1:])}: {e['msg']}" for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": {"error": "invalid_input", "message": "; ".join(msgs), "errors": msgs}})


@app.exception_handler(ValueError)
async def value_handler(_: Request, exc: ValueError):
    return JSONResponse(status_code=422, content={"detail": {"error": "invalid_input", "message": str(exc)}})


for r in (auth.router, catalog.router, operations.router, simulations.router, intelligence.router, flow_api.router):
    app.include_router(r, prefix="/api/v1")


@app.get("/api/v1/health")
def health():
    return {"ok": True, "simulation_loop_error": manager.last_error, "running": len(manager.runtimes)}


async def _ws(ws: WebSocket, topic_for):
    await ws.accept()
    db = SessionLocal()
    try:
        p = principal_from_ws_token(ws.query_params.get("token"), db)
        topic = topic_for(p)
        if topic is None:
            await ws.close(code=4403)
            return
        hub.subscribe(topic, ws)
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await ws.close(code=4401)
        except Exception:
            pass
    finally:
        hub.unsubscribe(ws)
        db.close()


@app.websocket("/ws/simulations/{sid}")
async def ws_sim(ws: WebSocket, sid: int):
    def topic(p):
        if p.kind == "user" or p.can_access("simulation", sid):
            return f"sim:{sid}"
        with SessionLocal() as db:
            from app.db.models import Simulation
            s = db.get(Simulation, sid)
            return f"sim:{sid}" if s and s.batch_id and p.can_access("batch", s.batch_id) else None
    await _ws(ws, topic)


@app.websocket("/ws/station/{sid}")
async def ws_station(ws: WebSocket, sid: int):
    def topic(p):
        if p.kind == "user":
            return f"station:{sid}"
        return f"station:{sid}" if (p.scope or {}).get("type") == "station" and p.qr_session_id == sid else None
    await _ws(ws, topic)


@app.websocket("/ws/alerts")
async def ws_alerts(ws: WebSocket):
    await _ws(ws, lambda p: "alerts" if p.kind == "user" else None)


def migrate():
    from alembic import command
    from alembic.config import Config
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    command.upgrade(cfg, "head")


@app.on_event("startup")
async def startup():
    hub.loop = asyncio.get_running_loop()
    await asyncio.to_thread(migrate)
    from app.db.bootstrap import sync_commodities
    with SessionLocal() as db:
        sync_commodities(db)
    manager.start()
    from app.integrations import tts_kn
    tts_kn.warm_up()   # optional offline Kannada voice; loads in the background


DIST = ROOT / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = DIST / path
        if path and f.is_file():
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
