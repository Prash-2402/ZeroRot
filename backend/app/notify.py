"""Notification service: in-app (always), Telegram (real messages when configured), WhatsApp (preview only)."""
from __future__ import annotations

import threading
from datetime import datetime

from sqlalchemy.orm import Session

from app.db.models import Notification
from app.engine.registry import get_produce
from app.ws.hub import hub

KN = {
    "temp_excursion": "ನಿಮ್ಮ {produce_kn} ಬ್ಯಾಚ್‌ನಲ್ಲಿ ತಾಪಮಾನ ಹೆಚ್ಚಳ ಕಂಡುಬಂದಿದೆ. ಉತ್ಪನ್ನದ ಗುಣಮಟ್ಟ ಮತ್ತು ಉಳಿದ ಶೆಲ್ಫ್ ಲೈಫ್ ಮೇಲೆ ಪರಿಣಾಮ ಬೀರುವ ಸಾಧ್ಯತೆ ಇದೆ. ದಯವಿಟ್ಟು ಸಂಗ್ರಹಣಾ ಪರಿಸ್ಥಿತಿಯನ್ನು ಪರಿಶೀಲಿಸಿ.",
    "reefer_failure": "ಎಚ್ಚರಿಕೆ: ನಿಮ್ಮ {produce_kn} ಸಾಗಣೆಯ ಶೀತಲೀಕರಣ ಘಟಕ ವಿಫಲವಾಗಿದೆ. ತಾಪಮಾನ ಏರುತ್ತಿದೆ. ಪರ್ಯಾಯ ಮಾರ್ಗದ ಶಿಫಾರಸು ಸಿದ್ಧವಾಗುತ್ತಿದೆ.",
    "reroute_proposal": "ಶಿಫಾರಸು: ನಿಮ್ಮ {produce_kn} ಲಾರಿಯನ್ನು {target} ಕಡೆಗೆ ತಿರುಗಿಸಿ. ಅಂದಾಜು ನಿವ್ವಳ ಮೌಲ್ಯ {net}. ಅನುಮೋದಿಸಲು 'Approve reroute' ಒತ್ತಿರಿ.",
    "reroute_approved": "ಮಾರ್ಗ ಬದಲಾವಣೆ ಅನುಮೋದಿಸಲಾಗಿದೆ. ಲಾರಿ {target} ಕಡೆಗೆ ಹೋಗುತ್ತಿದೆ.",
    "shelf_life": "ನಿಮ್ಮ {produce_kn} ಬ್ಯಾಚ್‌ನ ಉಳಿದ ಶೆಲ್ಫ್ ಲೈಫ್ ಸುಮಾರು {days} ದಿನಗಳು. ಬೇಗ ಮಾರಾಟ ಅಥವಾ ಶೀತಲ ಸಂಗ್ರಹಣೆ ಪರಿಗಣಿಸಿ.",
    "quality_warning": "ನಿಮ್ಮ {produce_kn} ಬ್ಯಾಚ್‌ನ ಗುಣಮಟ್ಟ ಕುಸಿಯುತ್ತಿದೆ ({quality}%). ದಯವಿಟ್ಟು ಶಿಫಾರಸು ಪರಿಶೀಲಿಸಿ.",
    "recommendation": "ಶಿಫಾರಸು: {action}. ಅಂದಾಜು ನಿವ್ವಳ ಮೌಲ್ಯ {net}.",
    "price_warning": "ಮಾರುಕಟ್ಟೆ ಎಚ್ಚರಿಕೆ: {market} ನಲ್ಲಿ ಬೆಲೆ ಇಳಿಕೆಯ ಸಾಧ್ಯತೆ ({label}).",
}


def kannada(kind: str, **kw) -> str | None:
    t = KN.get(kind)
    if not t:
        return None
    try:
        return t.format(**kw)
    except KeyError:
        return t


def notify(db: Session, *, now: datetime, kind: str, severity: str, title: str, body: str, batch=None, trip_id: str | None = None,
           actions: list | None = None, external: bool = False, kn_args: dict | None = None) -> Notification:
    """Creates the in-app notification, a WhatsApp preview, and (if configured and external=True) a real Telegram message."""
    kn = None
    if batch is not None:
        kw = {"produce_kn": get_produce(batch.produce).kannada, **(kn_args or {})}
        kn = kannada(kind, **kw)
    n = Notification(ts=now, batch_id=batch.id if batch is not None else None, trip_id=trip_id, kind=kind, severity=severity,
                     title=title, body=body, body_kn=kn, channel="in_app", delivered=True, actions=actions or [],
                     origin="simulated" if (batch is None or batch.origin == "simulated") else "manual")
    db.add(n)
    db.flush()
    payload = notification_dict(n)
    hub.publish({"type": "alert.new", "data": payload})
    if external and kn:
        db.add(Notification(ts=now, batch_id=n.batch_id, trip_id=trip_id, kind=kind, severity=severity, title=title, body=body,
                            body_kn=kn, channel="whatsapp_preview", delivered=False, delivery_note="Preview — WhatsApp Cloud API pending",
                            actions=actions or [], origin=n.origin))
        from app.providers.notify import telegram
        if telegram.configured():
            threading.Thread(target=telegram.send_alert, args=(title, body, kn, actions or [], trip_id, n.batch_id), daemon=True).start()
    return n


def notification_dict(n: Notification) -> dict:
    return {"id": n.id, "ts": n.ts.isoformat(timespec="minutes"), "batch_id": n.batch_id, "trip_id": n.trip_id, "kind": n.kind,
            "severity": n.severity, "title": n.title, "body": n.body, "body_kn": n.body_kn, "channel": n.channel,
            "delivered": n.delivered, "delivery_note": n.delivery_note, "read": n.read, "actions": n.actions, "origin": n.origin}
