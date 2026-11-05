"""SQLAlchemy 2 models. SQLite for the hackathon; Postgres-compatible types via DATABASE_URL.
Times are naive local (Asia/Kolkata) simulation times."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def ts_col():
    return mapped_column(DateTime, default=datetime.now)


class AppState(Base):
    __tablename__ = "app_state"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)


class Farmer(Base):
    __tablename__ = "farmers"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    district: Mapped[str] = mapped_column(String(64))
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)  # never exposed publicly
    language: Mapped[str] = mapped_column(String(8), default="kn")
    origin: Mapped[str] = mapped_column(String(24), default="simulated")
    created_at: Mapped[datetime] = ts_col()


class ProduceType(Base):
    __tablename__ = "produce_types"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(64))
    kannada: Mapped[str] = mapped_column(String(64))
    version: Mapped[str] = mapped_column(String(16))
    meta: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = ts_col()


class ProduceParameter(Base):
    __tablename__ = "produce_parameters"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    produce: Mapped[str] = mapped_column(String(32), index=True)
    version: Mapped[str] = mapped_column(String(16))
    classification: Mapped[str] = mapped_column(String(32))
    data: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = ts_col()


class Facility(Base):
    __tablename__ = "facilities"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    type: Mapped[str] = mapped_column(String(16))  # mandi | cold_storage
    name: Mapped[str] = mapped_column(String(120))
    district: Mapped[str] = mapped_column(String(64))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    accepts: Mapped[list] = mapped_column(JSON, default=list)
    capacity_t: Mapped[float] = mapped_column(Float, default=0)
    used_t: Mapped[float] = mapped_column(Float, default=0)
    rent_per_kg_day: Mapped[float] = mapped_column(Float, default=0)
    origin: Mapped[str] = mapped_column(String(24), default="simulated")
    created_at: Mapped[datetime] = ts_col()


class Batch(Base):
    __tablename__ = "batches"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    farmer_id: Mapped[str | None] = mapped_column(ForeignKey("farmers.id"), nullable=True)
    produce: Mapped[str] = mapped_column(String(32))
    variety: Mapped[str | None] = mapped_column(String(64), nullable=True)
    quantity_kg: Mapped[float] = mapped_column(Float)
    harvest_time: Mapped[datetime] = mapped_column(DateTime)
    maturity: Mapped[str | None] = mapped_column(String(24), nullable=True)
    initial_quality: Mapped[float | None] = mapped_column(Float, nullable=True)
    district: Mapped[str] = mapped_column(String(64))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    storage_type: Mapped[str] = mapped_column(String(24))  # open_shed | cold_storage | reefer
    facility_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="stored")  # stored | in_transit | delivered
    q: Mapped[float] = mapped_column(Float)
    w: Mapped[float] = mapped_column(Float, default=0)
    r: Mapped[float] = mapped_column(Float, default=0)
    e: Mapped[float] = mapped_column(Float, default=0)
    state_at: Mapped[datetime] = mapped_column(DateTime)
    risk: Mapped[str] = mapped_column(String(16), default="healthy")
    shelf_life_days: Mapped[float | None] = mapped_column(Float, nullable=True)
    value_inr: Mapped[float | None] = mapped_column(Float, nullable=True)
    manual_bias_t: Mapped[float] = mapped_column(Float, default=0)
    manual_bias_rh: Mapped[float] = mapped_column(Float, default=0)
    manual_bias_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    passport_token: Mapped[str | None] = mapped_column(String(48), nullable=True, index=True)
    lane_id: Mapped[str | None] = mapped_column(String(16), nullable=True)
    is_judge: Mapped[bool] = mapped_column(Boolean, default=False)
    origin: Mapped[str] = mapped_column(String(24), default="simulated")  # simulated | manual
    mode: Mapped[str] = mapped_column(String(8), default="demo")
    created_at: Mapped[datetime] = ts_col()


class StorageRecord(Base):
    __tablename__ = "storage_records"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[str] = mapped_column(ForeignKey("batches.id"), index=True)
    facility_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    storage_type: Mapped[str] = mapped_column(String(24))
    label: Mapped[str] = mapped_column(String(160))
    start: Mapped[datetime] = mapped_column(DateTime)
    end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    origin: Mapped[str] = mapped_column(String(24), default="simulated")


class Reading(Base):
    __tablename__ = "readings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[str] = mapped_column(String(32), index=True)
    trip_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ts: Mapped[datetime] = mapped_column(DateTime, index=True)
    temp_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    rh: Mapped[float | None] = mapped_column(Float, nullable=True)
    origin: Mapped[str] = mapped_column(String(24))  # manual | simulated | external_api | cached | image_derived


class Prediction(Base):
    __tablename__ = "predictions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[str] = mapped_column(String(32), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime)
    quality: Mapped[float] = mapped_column(Float)
    shelf_life_days: Mapped[float | None] = mapped_column(Float, nullable=True)
    shelf_p10: Mapped[float | None] = mapped_column(Float, nullable=True)
    shelf_p90: Mapped[float | None] = mapped_column(Float, nullable=True)
    value_inr: Mapped[float | None] = mapped_column(Float, nullable=True)
    confidence_score: Mapped[float] = mapped_column(Float)
    confidence_category: Mapped[str] = mapped_column(String(16))
    model_version: Mapped[str] = mapped_column(String(32))
    parameter_version: Mapped[str] = mapped_column(String(16))
    input_snapshot: Mapped[dict] = mapped_column(JSON)
    data_origins: Mapped[list] = mapped_column(JSON)
    mode: Mapped[str] = mapped_column(String(8))
    origin: Mapped[str] = mapped_column(String(24), default="model_prediction")


class MarketPrice(Base):
    __tablename__ = "market_prices"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    commodity: Mapped[str] = mapped_column(String(32), index=True)
    mandi_id: Mapped[str] = mapped_column(String(32), index=True)
    variety: Mapped[str | None] = mapped_column(String(64), nullable=True)
    date: Mapped[datetime] = mapped_column(DateTime)
    min_price: Mapped[float] = mapped_column(Float)
    max_price: Mapped[float] = mapped_column(Float)
    modal_price: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(16), default="Rs/quintal")
    arrivals_t: Mapped[float | None] = mapped_column(Float, nullable=True)
    origin: Mapped[str] = mapped_column(String(24))
    source: Mapped[str] = mapped_column(String(200))
    retrieved_at: Mapped[datetime] = mapped_column(DateTime)


class PriceForecast(Base):
    __tablename__ = "price_forecasts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    commodity: Mapped[str] = mapped_column(String(32))
    mandi_id: Mapped[str] = mapped_column(String(32))
    created: Mapped[datetime] = mapped_column(DateTime)
    data: Mapped[dict] = mapped_column(JSON)
    origin: Mapped[str] = mapped_column(String(24), default="model_prediction")


class Decision(Base):
    __tablename__ = "decisions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[str] = mapped_column(String(32), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime)
    action: Mapped[str] = mapped_column(String(32))
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    recommended: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    alternatives: Mapped[list] = mapped_column(JSON, default=list)
    rejected: Mapped[list] = mapped_column(JSON, default=list)
    farmer_choice: Mapped[str | None] = mapped_column(String(64), nullable=True)
    choice_difference: Mapped[float | None] = mapped_column(Float, nullable=True)
    mode: Mapped[str] = mapped_column(String(8), default="demo")


class MarketShiftPlan(Base):
    __tablename__ = "market_shift_plans"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[str] = mapped_column(String(32), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime)
    condition: Mapped[str] = mapped_column(String(24))
    periods: Mapped[list] = mapped_column(JSON)
    recommended: Mapped[str] = mapped_column(String(16))
    chosen: Mapped[str | None] = mapped_column(String(16), nullable=True)
    difference: Mapped[float | None] = mapped_column(Float, nullable=True)
    mode: Mapped[str] = mapped_column(String(8), default="demo")


class Trip(Base):
    __tablename__ = "trips"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(32), index=True)
    lane_id: Mapped[str | None] = mapped_column(String(16), nullable=True)
    origin_id: Mapped[str] = mapped_column(String(32))
    dest_id: Mapped[str] = mapped_column(String(32))
    dest_name: Mapped[str] = mapped_column(String(120))
    route: Mapped[list] = mapped_column(JSON)  # [[lng, lat], ...]
    route_source: Mapped[str] = mapped_column(String(32), default="osrm_cached")
    distance_m: Mapped[float] = mapped_column(Float)
    duration_s: Mapped[float] = mapped_column(Float)
    progress_s: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(16), default="in_transit")  # in_transit | arrived
    reefer: Mapped[bool] = mapped_column(Boolean, default=False)
    reefer_status: Mapped[str] = mapped_column(String(16), default="na")  # ok | failed | na
    failed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cargo_temp: Mapped[float | None] = mapped_column(Float, nullable=True)
    cargo_rh: Mapped[float | None] = mapped_column(Float, nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime)
    pending_reroute: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    rerouted: Mapped[bool] = mapped_column(Boolean, default=False)
    ghost_route: Mapped[list | None] = mapped_column(JSON, nullable=True)
    ghost_progress_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    ghost_duration_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_scenario: Mapped[bool] = mapped_column(Boolean, default=False)
    loop: Mapped[bool] = mapped_column(Boolean, default=True)
    origin: Mapped[str] = mapped_column(String(24), default="simulated")
    created_at: Mapped[datetime] = ts_col()


class ReeferEvent(Base):
    __tablename__ = "reefer_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    trip_id: Mapped[str] = mapped_column(String(32), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime)
    kind: Mapped[str] = mapped_column(String(24))
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    origin: Mapped[str] = mapped_column(String(24), default="simulated")


class WorkflowRun(Base):
    __tablename__ = "workflow_runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    trip_id: Mapped[str] = mapped_column(String(32), index=True)
    batch_id: Mapped[str] = mapped_column(String(32))
    kind: Mapped[str] = mapped_column(String(24))  # agentic | rule_based
    status: Mapped[str] = mapped_column(String(16), default="running")
    started: Mapped[datetime] = mapped_column(DateTime)
    finished: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class WorkflowStep(Base):
    __tablename__ = "workflow_steps"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("workflow_runs.id"), index=True)
    idx: Mapped[int] = mapped_column(Integer)
    stage: Mapped[str] = mapped_column(String(24))
    tool: Mapped[str] = mapped_column(String(48))
    summary: Mapped[str] = mapped_column(Text)
    output: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ts: Mapped[datetime] = mapped_column(DateTime)


class GhostComparison(Base):
    __tablename__ = "ghost_comparisons"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    trip_id: Mapped[str] = mapped_column(String(32), index=True)
    batch_id: Mapped[str] = mapped_column(String(32))
    ts: Mapped[datetime] = mapped_column(DateTime)
    ghost: Mapped[dict] = mapped_column(JSON)
    reroute: Mapped[dict] = mapped_column(JSON)
    start_state: Mapped[dict] = mapped_column(JSON)
    value_protected: Mapped[float] = mapped_column(Float)
    food_protected_kg: Mapped[float] = mapped_column(Float, default=0)
    label: Mapped[str] = mapped_column(String(120))
    origin: Mapped[str] = mapped_column(String(24), default="simulated")


class GroupShipment(Base):
    __tablename__ = "group_shipments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dest_id: Mapped[str] = mapped_column(String(32))
    created: Mapped[datetime] = mapped_column(DateTime)
    total_cost: Mapped[float] = mapped_column(Float)
    data: Mapped[dict] = mapped_column(JSON)
    origin: Mapped[str] = mapped_column(String(24), default="simulated")


class ShipmentMember(Base):
    __tablename__ = "shipment_members"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    shipment_id: Mapped[int] = mapped_column(ForeignKey("group_shipments.id"))
    batch_id: Mapped[str] = mapped_column(String(32))
    share_inr: Mapped[float] = mapped_column(Float)
    savings_inr: Mapped[float] = mapped_column(Float)


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime, index=True)
    batch_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    trip_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    kind: Mapped[str] = mapped_column(String(32))
    severity: Mapped[str] = mapped_column(String(16))  # info | warning | critical | success
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    body_kn: Mapped[str | None] = mapped_column(Text, nullable=True)
    channel: Mapped[str] = mapped_column(String(24), default="in_app")  # in_app | telegram | whatsapp_preview
    delivered: Mapped[bool] = mapped_column(Boolean, default=True)
    delivery_note: Mapped[str | None] = mapped_column(String(200), nullable=True)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    actions: Mapped[list] = mapped_column(JSON, default=list)
    origin: Mapped[str] = mapped_column(String(24), default="simulated")


class HarvestPassport(Base):
    __tablename__ = "harvest_passports"
    token: Mapped[str] = mapped_column(String(48), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(32), index=True)
    created: Mapped[datetime] = mapped_column(DateTime)


class ValidationRecord(Base):
    __tablename__ = "validation_records"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[str] = mapped_column(String(32))
    produce: Mapped[str] = mapped_column(String(32))
    prediction_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    predicted_quality: Mapped[float | None] = mapped_column(Float, nullable=True)
    predicted_shelf_life: Mapped[float | None] = mapped_column(Float, nullable=True)
    observed_quality: Mapped[float | None] = mapped_column(Float, nullable=True)
    observed_shelf_life: Mapped[float | None] = mapped_column(Float, nullable=True)
    observed_at: Mapped[datetime] = mapped_column(DateTime)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    origin: Mapped[str] = mapped_column(String(24), default="manual")


class ImpactEvent(Base):
    __tablename__ = "impact_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime)
    kind: Mapped[str] = mapped_column(String(32))  # value_protected | alert_handled | batch_monitored | loss
    batch_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    trip_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    produce: Mapped[str | None] = mapped_column(String(32), nullable=True)
    district: Mapped[str | None] = mapped_column(String(64), nullable=True)
    value_inr: Mapped[float] = mapped_column(Float, default=0)
    kg: Mapped[float] = mapped_column(Float, default=0)
    origin: Mapped[str] = mapped_column(String(24), default="simulated")


class Scenario(Base):
    __tablename__ = "scenarios"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text)
    expected: Mapped[dict] = mapped_column(JSON, default=dict)


class IntegrationStatus(Base):
    __tablename__ = "integration_status"
    name: Mapped[str] = mapped_column(String(32), primary_key=True)
    status: Mapped[str] = mapped_column(String(16))  # ok | demo | unavailable
    provider: Mapped[str] = mapped_column(String(48))
    detail: Mapped[str] = mapped_column(Text)
    checked_at: Mapped[datetime] = mapped_column(DateTime)
