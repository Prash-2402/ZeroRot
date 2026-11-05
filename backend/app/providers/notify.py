"""Notification providers: InApp (always), Telegram (real, when configured), WhatsApp (preview only)."""
from __future__ import annotations

import logging
import threading
import time

import httpx

from app.core.config import settings

log = logging.getLogger("zerorot.notify")


class TelegramProvider:
    name = "telegram"

    def __init__(self):
        self.last_error: str | None = None
        self.sent = 0
        self._offset = 0
        self._poller: threading.Thread | None = None

    def configured(self) -> bool:
        return bool(settings.telegram_bot_token and settings.telegram_chat_id)

    def _url(self, method: str) -> str:
        return f"https://api.telegram.org/bot{settings.telegram_bot_token}/{method}"

    def check(self) -> tuple[str, str]:
        if not self.configured():
            return "unavailable", "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set"
        try:
            r = httpx.get(self._url("getMe"), timeout=3)
            if r.status_code == 200 and r.json().get("ok"):
                return "ok", f"Bot @{r.json()['result'].get('username')} connected"
            return "unavailable", f"Telegram returned {r.status_code}"
        except Exception as e:
            return "unavailable", f"Telegram unreachable ({type(e).__name__})"

    def send_alert(self, title: str, body: str, body_kn: str | None, actions: list, trip_id: str | None, batch_id: str | None):
        text = f"<b>ZERO ROT · {title}</b>\n\n{body_kn + chr(10) + chr(10) if body_kn else ''}{body}"
        kb = []
        for a in actions:
            kb.append({"text": a["label"], "callback_data": f"{a['action']}|{trip_id or ''}|{batch_id or ''}"[:64]})
        payload = {"chat_id": settings.telegram_chat_id, "text": text, "parse_mode": "HTML"}
        if kb:
            payload["reply_markup"] = {"inline_keyboard": [kb]}
        try:
            r = httpx.post(self._url("sendMessage"), json=payload, timeout=4)
            ok = r.status_code == 200 and r.json().get("ok")
            self.last_error = None if ok else f"status {r.status_code}"
            self.sent += 1 if ok else 0
            self._record(title, ok)
        except Exception as e:
            self.last_error = type(e).__name__
            self._record(title, False)

    def _record(self, title: str, ok: bool):
        from app.db.models import Notification
        from app.db.session import session_scope
        from app import domain
        try:
            with session_scope() as db:
                db.add(Notification(ts=domain.sim_now(db), kind="telegram", severity="info", title=title,
                                    body="Sent to Telegram" if ok else f"Telegram send failed: {self.last_error}",
                                    channel="telegram", delivered=ok, delivery_note=None if ok else self.last_error, origin="manual"))
        except Exception:
            log.exception("record telegram")

    def answer_callback(self, callback_id: str, text: str):
        try:
            httpx.post(self._url("answerCallbackQuery"), json={"callback_query_id": callback_id, "text": text}, timeout=3)
        except Exception:
            pass

    def start_polling(self, handler):
        """Long-polling so button replies work without a public webhook URL."""
        if not self.configured() or self._poller:
            return

        def loop():
            while True:
                try:
                    r = httpx.get(self._url("getUpdates"), params={"timeout": 20, "offset": self._offset}, timeout=25)
                    for upd in r.json().get("result", []):
                        self._offset = upd["update_id"] + 1
                        handler(upd)
                except Exception:
                    time.sleep(5)

        self._poller = threading.Thread(target=loop, daemon=True)
        self._poller.start()


telegram = TelegramProvider()


class WhatsAppPreviewProvider:
    """Adapter only. WhatsApp Cloud API sending is future work; messages are shown as an in-app preview and never claimed as sent."""
    name = "whatsapp"

    def check(self) -> tuple[str, str]:
        return "preview", "Preview only. WhatsApp Cloud API pending (adapter in place)."
