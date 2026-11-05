"""QR access sessions: opaque random token in the QR (never an API key), a 6-digit PIN shown only on the dashboard,
expiry, revocation, scope to exactly one resource, and lockout after repeated wrong PINs."""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import create_token, hash_password, new_opaque_token, new_pin, sha256, verify_password
from app.db.models import QRAccessSession

MAX_FAILED = 5
DEFAULT_PERMISSIONS = ["view", "acknowledge_alerts"]


def create(db: Session, resource_type: str, resource_id: int, ttl_minutes: int, permissions: list[str] | None, created_by: int | None) -> dict:
    token, pin = new_opaque_token(), new_pin()
    q = QRAccessSession(token_hash=sha256(token), pin_hash=hash_password(pin), resource_type=resource_type, resource_id=resource_id,
                        permissions=permissions or DEFAULT_PERMISSIONS, expires_at=datetime.utcnow() + timedelta(minutes=ttl_minutes),
                        created_by=created_by)
    db.add(q)
    db.commit()
    return {"id": q.id, "token": token, "pin": pin, "expires_at": q.expires_at.isoformat(timespec="seconds"), "permissions": q.permissions}


def lookup(db: Session, token: str) -> QRAccessSession | None:
    return db.scalars(select(QRAccessSession).where(QRAccessSession.token_hash == sha256(token))).first()


def verify(db: Session, token: str, pin: str) -> tuple[QRAccessSession | None, str | None]:
    q = lookup(db, token)
    if q is None:
        return None, "invalid_token"
    if q.revoked:
        return None, "revoked"
    if q.expires_at < datetime.utcnow():
        return None, "expired"
    if q.failed_attempts >= MAX_FAILED:
        return None, "locked"
    if not verify_password(pin, q.pin_hash):
        q.failed_attempts += 1
        db.commit()
        return None, "wrong_pin"
    q.uses += 1
    q.last_used_at = datetime.utcnow()
    db.commit()
    return q, None


def session_token(q: QRAccessSession) -> str:
    minutes = max(1, int((q.expires_at - datetime.utcnow()).total_seconds() // 60))
    return create_token(f"qr:{q.id}", "farmer", {"typ": "qr", "sid": q.id}, minutes=minutes)
