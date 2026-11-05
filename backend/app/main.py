"""ZERO ROT API. Run: uvicorn app.main:app --reload --port 8000  (from backend/)"""
from __future__ import annotations

import asyncio
import logging
import pathlib

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect

from app.api.v1 import assistant, core, farm, ops, prove
from app.core.config import ROOT
from app.db.session import SessionLocal, engine
from app.simulation.loop import simulator
from app.ws.hub import hub

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("zerorot")

app = FastAPI(title="ZERO ROT API", version="1.0.0",
              description="Post-harvest quality, shelf-life and market value prediction. Decay Engine + Rule-Based Decision Engine.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError):
    msgs = [f"{'.'.join(str(x) for x in e['loc'][1:])}: {e['msg']}" for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": {"error": "invalid_input", "message": "; ".join(msgs), "errors": msgs}})


@app.exception_handler(ValueError)
async def value_handler(_: Request, exc: ValueError):
    return JSONResponse(status_code=422, content={"detail": {"error": "invalid_input", "message": str(exc)}})


for r in (core.router, ops.router, prove.router, farm.router, assistant.router):
    app.include_router(r, prefix="/api/v1")


@app.get("/api/v1/health")
def health():
    return {"ok": True, "sim_error": simulator.last_error}


@app.websocket("/ws/live")
async def ws_live(ws: WebSocket):
    await hub.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        hub.disconnect(ws)
    except Exception:
        hub.disconnect(ws)


@app.on_event("startup")
async def startup():
    hub.loop = asyncio.get_running_loop()
    if not inspect(engine).has_table("batches"):
        from app.db.seed import seed
        log.info("empty database: seeding demo state")
        await asyncio.to_thread(seed)
    with SessionLocal() as db:
        ops.check_integrations(db)
    simulator.start()
    from app.providers.notify import telegram
    telegram.start_polling(ops.handle_telegram_update)


# Serve the built frontend (single port for LAN / judge mode) when frontend/dist exists.
DIST = ROOT / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = DIST / path
        if path and f.is_file():
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
