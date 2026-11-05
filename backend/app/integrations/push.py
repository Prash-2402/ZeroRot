"""Web Push (VAPID). Keys come from env or are generated once into backend/.vapid.json (gitignored)."""
from __future__ import annotations

import base64
import json
import logging
import os
import pathlib

from app.core.config import BACKEND, settings

log = logging.getLogger("zerorot.push")
KEY_FILE = pathlib.Path(os.environ.get("VAPID_KEY_FILE") or (BACKEND / ".vapid.json"))
_keys: dict | None = None


def keys() -> dict:
    global _keys
    if _keys:
        return _keys
    if settings.vapid_private_key and settings.vapid_public_key:
        _keys = {"private": settings.vapid_private_key, "public": settings.vapid_public_key}
        return _keys
    if KEY_FILE.exists():
        _keys = json.loads(KEY_FILE.read_text())
        return _keys
    from cryptography.hazmat.primitives import serialization
    from py_vapid import Vapid01
    v = Vapid01()
    v.generate_keys()
    raw_pub = v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    priv_pem = v.private_pem().decode()
    _keys = {"private": priv_pem, "public": base64.urlsafe_b64encode(raw_pub).decode().rstrip("=")}
    KEY_FILE.write_text(json.dumps(_keys))
    log.info("generated VAPID keys in %s", KEY_FILE)
    return _keys


def send(sub: dict, payload: dict) -> tuple[bool, str]:
    from pywebpush import WebPushException, webpush
    k = keys()
    try:
        webpush(subscription_info=sub, data=json.dumps(payload), vapid_private_key=k["private"],
                vapid_claims={"sub": settings.vapid_subject}, timeout=8)
        return True, "sent"
    except WebPushException as e:
        status = getattr(e.response, "status_code", None)
        return False, f"push failed ({status or type(e).__name__})"
    except Exception as e:  # network etc.
        return False, f"push failed ({type(e).__name__})"
