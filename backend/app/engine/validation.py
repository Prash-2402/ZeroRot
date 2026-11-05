"""Input validation shared by the API and the engine. Invalid inputs are rejected, never silently fixed."""
from __future__ import annotations

from datetime import datetime

from .registry import SUPPORTED, load_registry

MATURITIES = ("mature_green", "turning", "ripe")
STORAGE_TYPES = ("open_shed", "cold_storage", "reefer")


def validate_batch(*, produce: str, quantity_kg: float, harvest_time: datetime, now: datetime,
                   storage_start: datetime | None = None, maturity: str | None = None,
                   initial_quality: float | None = None, humidity: float | None = None, temperature: float | None = None,
                   storage_type: str | None = None) -> list[str]:
    errors = []
    if produce not in load_registry():
        errors.append(f"Unsupported produce '{produce}'. Supported: {', '.join(SUPPORTED)}")
    if quantity_kg is None or quantity_kg <= 0:
        errors.append("Quantity must be greater than 0 kg")
    elif quantity_kg > 100000:
        errors.append("Quantity above 100 t is outside the supported range")
    if harvest_time is None:
        errors.append("Harvest time is required")
    elif harvest_time > now:
        errors.append("Harvest time cannot be in the future")
    if storage_start is not None and harvest_time is not None and storage_start < harvest_time:
        errors.append("Storage cannot start before harvest")
    if maturity is not None and maturity not in MATURITIES:
        errors.append(f"Maturity must be one of {', '.join(MATURITIES)}")
    if initial_quality is not None and not (0 <= initial_quality <= 100):
        errors.append("Initial quality must be between 0 and 100")
    if humidity is not None and not (0 <= humidity <= 100):
        errors.append("Humidity must be between 0 and 100%")
    if temperature is not None and not (-10 <= temperature <= 60):
        errors.append("Temperature must be between -10 and 60 degC")
    if storage_type is not None and storage_type not in STORAGE_TYPES:
        errors.append(f"Storage type must be one of {', '.join(STORAGE_TYPES)}")
    return errors
