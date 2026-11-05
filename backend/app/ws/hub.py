"""WebSocket broadcast hub. publish() is thread-safe (the simulation tick runs in a worker thread)."""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import WebSocket

log = logging.getLogger("zerorot.ws")


class Hub:
    def __init__(self):
        self.clients: set[WebSocket] = set()
        self.loop: asyncio.AbstractEventLoop | None = None

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.clients.add(ws)

    def disconnect(self, ws: WebSocket):
        self.clients.discard(ws)

    async def broadcast(self, msg: dict):
        if not self.clients:
            return
        data = json.dumps(msg, default=str)
        dead = []
        for ws in list(self.clients):
            try:
                await asyncio.wait_for(ws.send_text(data), timeout=2)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    def publish(self, msg: dict):
        if self.loop is None:
            return
        try:
            asyncio.run_coroutine_threadsafe(self.broadcast(msg), self.loop)
        except RuntimeError:
            pass


hub = Hub()
