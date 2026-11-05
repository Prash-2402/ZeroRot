"""Settings from environment / .env. Keys are never sent to the frontend or logged."""
from __future__ import annotations

import os
import pathlib
from dataclasses import dataclass, field
from datetime import datetime

ROOT = pathlib.Path(__file__).resolve().parents[3]
BACKEND = ROOT / "backend"


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
    app_mode: str = field(default_factory=lambda: env("APP_MODE", "demo"))
    database_url: str = field(default_factory=lambda: env("DATABASE_URL", f"sqlite:///{(BACKEND / 'zerorot.db').as_posix()}"))
    frontend_url: str = field(default_factory=lambda: env("FRONTEND_URL", "http://localhost:5173"))
    sim_tick_seconds: float = field(default_factory=lambda: float(env("SIM_TICK_SECONDS", "1")))
    sim_minutes_per_tick: float = field(default_factory=lambda: float(env("SIM_MINUTES_PER_TICK", "2")))
    groq_api_key: str = field(default_factory=lambda: env("GROQ_API_KEY"))
    groq_model: str = field(default_factory=lambda: env("GROQ_MODEL", "openai/gpt-oss-120b"))
    groq_timeout: float = field(default_factory=lambda: float(env("GROQ_TIMEOUT_SECONDS", "3")))
    data_gov_api_key: str = field(default_factory=lambda: env("DATA_GOV_API_KEY"))
    agmarknet_resource_id: str = field(default_factory=lambda: env("AGMARKNET_RESOURCE_ID", "9ef84268-d588-465a-a308-a864a43d0070"))
    open_meteo_url: str = field(default_factory=lambda: env("OPEN_METEO_BASE_URL", "https://api.open-meteo.com/v1/forecast"))
    osrm_url: str = field(default_factory=lambda: env("OSRM_BASE_URL", "https://router.project-osrm.org"))
    telegram_bot_token: str = field(default_factory=lambda: env("TELEGRAM_BOT_TOKEN"))
    telegram_chat_id: str = field(default_factory=lambda: env("TELEGRAM_CHAT_ID"))
    whatsapp_token: str = field(default_factory=lambda: env("WHATSAPP_ACCESS_TOKEN"))
    whatsapp_phone_id: str = field(default_factory=lambda: env("WHATSAPP_PHONE_NUMBER_ID"))


settings = Settings()

# Fixed demo epoch so scenarios are deterministic and align with the cached weather window.
DEMO_EPOCH = datetime(2026, 11, 5, 6, 0)
