"""Settings from environment / .env. Secrets stay on the server; validated at startup."""
from __future__ import annotations

import logging
import os
import pathlib
import secrets
from dataclasses import dataclass, field

ROOT = pathlib.Path(__file__).resolve().parents[3]
BACKEND = ROOT / "backend"
log = logging.getLogger("zerorot.config")


def _load_env():
    for f in (ROOT / ".env", BACKEND / ".env"):
        if f.exists():
            for line in f.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


_load_env()


def env(key: str, default: str = "") -> str:
    return os.environ.get(key, default) or default


@dataclass
class Settings:
    environment: str = field(default_factory=lambda: env("ENVIRONMENT", "development"))
    database_url: str = field(default_factory=lambda: env("DATABASE_URL", f"sqlite:///{(BACKEND / 'zerorot.db').as_posix()}"))
    jwt_secret: str = field(default_factory=lambda: env("JWT_SECRET"))
    access_token_minutes: int = field(default_factory=lambda: int(env("ACCESS_TOKEN_MINUTES", "720")))
    cors_origins: list[str] = field(default_factory=lambda: [o.strip() for o in env("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000").split(",") if o.strip()])
    public_base_url: str = field(default_factory=lambda: env("PUBLIC_BASE_URL", ""))
    admin_email: str = field(default_factory=lambda: env("ADMIN_EMAIL", "admin@zerorot.local"))
    admin_password: str = field(default_factory=lambda: env("ADMIN_PASSWORD"))
    groq_api_key: str = field(default_factory=lambda: env("GROQ_API_KEY"))
    groq_model: str = field(default_factory=lambda: env("GROQ_MODEL", "openai/gpt-oss-120b"))
    groq_timeout: float = field(default_factory=lambda: float(env("GROQ_TIMEOUT_SECONDS", "20")))
    data_gov_api_key: str = field(default_factory=lambda: env("DATA_GOV_API_KEY"))
    agmarknet_resource_id: str = field(default_factory=lambda: env("AGMARKNET_RESOURCE_ID", "9ef84268-d588-465a-a308-a864a43d0070"))
    agmarknet_history_resource_id: str = field(default_factory=lambda: env("AGMARKNET_HISTORY_RESOURCE_ID", ""))
    open_meteo_url: str = field(default_factory=lambda: env("OPEN_METEO_BASE_URL", "https://api.open-meteo.com/v1/forecast"))
    geocoding_url: str = field(default_factory=lambda: env("OPEN_METEO_GEOCODING_URL", "https://geocoding-api.open-meteo.com/v1/search"))
    osrm_url: str = field(default_factory=lambda: env("OSRM_BASE_URL", "https://router.project-osrm.org"))
    vapid_private_key: str = field(default_factory=lambda: env("VAPID_PRIVATE_KEY"))
    vapid_public_key: str = field(default_factory=lambda: env("VAPID_PUBLIC_KEY"))
    vapid_subject: str = field(default_factory=lambda: env("VAPID_SUBJECT", "mailto:admin@zerorot.local"))
    cv_model_path: str = field(default_factory=lambda: env("CV_MODEL_PATH", str(BACKEND / "models" / "produce_classifier.onnx")))
    rate_limit_per_minute: int = field(default_factory=lambda: int(env("RATE_LIMIT_PER_MINUTE", "120")))

    def validate(self):
        problems = []
        if not self.jwt_secret:
            if self.environment == "production":
                problems.append("JWT_SECRET must be set in production")
            self.jwt_secret = secrets.token_urlsafe(48)
            log.warning("JWT_SECRET not set: generated an ephemeral secret (sessions reset on restart)")
        if self.environment == "production" and not self.database_url.startswith("postgresql"):
            problems.append("Production requires a PostgreSQL DATABASE_URL")
        if problems:
            raise RuntimeError("; ".join(problems))
        return self


settings = Settings().validate()
