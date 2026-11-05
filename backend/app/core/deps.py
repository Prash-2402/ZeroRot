"""Auth dependencies, role checks, scoped QR principals, audit logging and a simple per-IP rate limiter."""
from __future__ import annotations

import time
from collections import defaultdict, deque
from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import decode_token
from app.db.models import AuditLog, User
from app.db.session import get_db

bearer = HTTPBearer(auto_error=False)


def err(status: int, code: str, message: str, **extra):
    raise HTTPException(status, detail={"error": code, "message": message, **extra})


@dataclass
class Principal:
    kind: str                 # "user" | "qr"
    user: User | None = None
    role: str = "operator"
    scope: dict | None = None  # for QR: {"type": "batch", "id": 3, "permissions": [...]}
    qr_session_id: int | None = None

    @property
    def label(self) -> str:
        return self.user.email if self.user else f"qr:{self.qr_session_id}"

    def can_access(self, resource_type: str, resource_id: int) -> bool:
        if self.kind == "user":
            return True
        return bool(self.scope) and self.scope.get("type") == resource_type and int(self.scope.get("id")) == int(resource_id)


def _principal_from_token(token: str, db: Session) -> Principal:
    try:
        data = decode_token(token)
    except jwt.ExpiredSignatureError:
        err(401, "token_expired", "Session expired, sign in again")
    except jwt.PyJWTError:
        err(401, "invalid_token", "Invalid credentials")
    if data.get("typ") == "qr":
        from app.db.models import QRAccessSession
        q = db.get(QRAccessSession, int(data["sid"]))
        if q is None or q.revoked:
            err(401, "qr_revoked", "This mobile access link was revoked")
        return Principal("qr", role="farmer", scope={"type": q.resource_type, "id": q.resource_id, "permissions": q.permissions}, qr_session_id=q.id)
    user = db.get(User, int(data["sub"]))
    if user is None or not user.is_active:
        err(401, "invalid_user", "Account not found or disabled")
    return Principal("user", user=user, role=user.role)


def current_principal(creds: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> Principal:
    if creds is None:
        err(401, "not_authenticated", "Sign in required")
    return _principal_from_token(creds.credentials, db)


def current_user(p: Principal = Depends(current_principal)) -> Principal:
    if p.kind != "user":
        err(403, "forbidden", "This action needs a dashboard account")
    return p


def require_role(*roles: str):
    def dep(p: Principal = Depends(current_user)) -> Principal:
        if p.role not in roles:
            err(403, "forbidden", f"Requires role: {', '.join(roles)}")
        return p
    return dep


def principal_from_ws_token(token: str | None, db: Session) -> Principal:
    if not token:
        err(401, "not_authenticated", "Sign in required")
    return _principal_from_token(token, db)


def audit(db: Session, principal: Principal | None, action: str, entity: str, entity_id=None, details: dict | None = None, request: Request | None = None):
    db.add(AuditLog(actor_user_id=principal.user.id if principal and principal.user else None,
                    actor_label=principal.label if principal else "system", action=action, entity=entity,
                    entity_id=str(entity_id) if entity_id is not None else None, details=details or {},
                    ip=request.client.host if request and request.client else None))


class RateLimiter:
    """Sliding-window limiter per client IP (in-process; use a shared store when running several workers)."""

    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self.hits: dict[str, deque] = defaultdict(deque)

    def check(self, key: str, cost: int = 1) -> bool:
        now = time.monotonic()
        q = self.hits[key]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) + cost > self.per_minute:
            return False
        for _ in range(cost):
            q.append(now)
        return True


limiter = RateLimiter(settings.rate_limit_per_minute)
ai_limiter = RateLimiter(20)
