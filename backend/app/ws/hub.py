"""Topic-based WebSocket broadcast hub (topics: 'sim:{id}', 'alerts'). publish() is thread-safe."""
from __future__ import annotations

import asyncio
import json
from collections import defaultdict

from fastapi import WebSocket


class Hub:
    def __init__(self):
        self.topics: dict[str, set[WebSocket]] = defaultdict(set)
        self.loop: asyncio.AbstractEventLoop | None = None

    def subscribe(self, topic: str, ws: WebSocket):
        self.topics[topic].add(ws)

    def unsubscribe(self, ws: WebSocket):
        for subs in self.topics.values():
            subs.discard(ws)

    def has_subscribers(self, topic: str) -> bool:
        return bool(self.topics.get(topic))

    async def broadcast(self, topic: str, msg: dict):
        subs = list(self.topics.get(topic, ()))
        if not subs:
            return
        data = json.dumps(msg, default=str)
        dead = []
        for ws in subs:
            try:
                await asyncio.wait_for(ws.send_text(data), timeout=2)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.unsubscribe(ws)

    def publish(self, topic: str, msg: dict):
        if self.loop is None:
            return
        try:
            asyncio.run_coroutine_threadsafe(self.broadcast(topic, msg), self.loop)
        except RuntimeError:
            pass


hub = Hub()
