"""Authentication: the first account created becomes admin; after that only admins add accounts."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import Principal, audit, current_principal, err, limiter, require_role
from app.core.security import create_token, hash_password, verify_password
from app.db.models import User
from app.db.session import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterIn(BaseModel):
    email: EmailStr
    name: str = Field(..., min_length=2, max_length=120)
    password: str = Field(..., min_length=8, max_length=128)


class LoginIn(BaseModel):
    email: str = Field(..., min_length=1, max_length=254)   # an email address or a plain username such as "admin"
    password: str = Field(..., min_length=1, max_length=128)


class UserIn(RegisterIn):
    role: str = Field("operator", pattern="^(admin|operator|farmer)$")


def user_dict(u: User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name, "role": u.role, "is_active": u.is_active, "created_at": u.created_at.isoformat()}


@router.get("/setup")
def setup_state(db: Session = Depends(get_db)):
    return {"needs_admin": (db.scalar(select(func.count(User.id))) or 0) == 0}


@router.post("/register", status_code=201)
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    if (db.scalar(select(func.count(User.id))) or 0) > 0:
        err(403, "registration_closed", "An admin already exists. Ask an admin to create your account.")
    u = User(email=body.email.lower(), name=body.name, password_hash=hash_password(body.password), role="admin")
    db.add(u)
    db.flush()
    audit(db, Principal("user", user=u, role="admin"), "register_admin", "user", u.id, request=request)
    db.commit()
    return {"user": user_dict(u), "access_token": create_token(str(u.id), u.role)}


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    if not limiter.check(f"login:{request.client.host if request.client else '?'}", cost=6):
        err(429, "rate_limited", "Too many sign-in attempts; wait a minute")
    u = db.scalars(select(User).where(User.email == body.email.lower())).first()
    if u is None or not u.is_active or not verify_password(body.password, u.password_hash):
        err(401, "invalid_credentials", "Email or password is incorrect")
    audit(db, Principal("user", user=u, role=u.role), "login", "user", u.id, request=request)
    db.commit()
    return {"user": user_dict(u), "access_token": create_token(str(u.id), u.role)}


@router.get("/me")
def me(p: Principal = Depends(current_principal)):
    if p.kind == "qr":
        return {"kind": "qr", "scope": p.scope, "role": "farmer"}
    return {"kind": "user", "user": user_dict(p.user)}


@router.get("/users")
def users(p: Principal = Depends(require_role("admin")), db: Session = Depends(get_db)):
    return {"users": [user_dict(u) for u in db.scalars(select(User).order_by(User.id)).all()]}


@router.post("/users", status_code=201)
def create_user(body: UserIn, request: Request, p: Principal = Depends(require_role("admin")), db: Session = Depends(get_db)):
    if db.scalars(select(User).where(User.email == body.email.lower())).first():
        err(409, "exists", "An account with this email already exists")
    u = User(email=body.email.lower(), name=body.name, password_hash=hash_password(body.password), role=body.role)
    db.add(u)
    db.flush()
    audit(db, p, "create_user", "user", u.id, {"role": body.role}, request)
    db.commit()
    return user_dict(u)
