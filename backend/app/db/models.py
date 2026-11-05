"""ZERO ROT relational schema (PostgreSQL in production, SQLite for local development).
All times are UTC. Every reading/record that can be simulated, live or manual carries an `origin`."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (JSON, Boolean, CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, String, Text,
                        UniqueConstraint)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.utcnow()


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


# ---------------- people ----------------
class User(TimestampMixin, Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16), default="operator")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    __table_args__ = (CheckConstraint("role in ('admin','operator','farmer')", name="ck_users_role"),)


class FarmerProfile(TimestampMixin, Base):
    __tablename__ = "farmer_profiles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, unique=True)
    managed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    village: Mapped[str | None] = mapped_column(String(120), nullable=True)
    location_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    language: Mapped[str] = mapped_column(String(8), default="kn")


# ---------------- commodities ----------------
class Commodity(TimestampMixin, Base):
    __tablename__ = "commodities"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    name_kn: Mapped[str | None] = mapped_column(String(64), nullable=True)
    prediction_supported: Mapped[bool] = mapped_column(Boolean, default=True)
    prediction_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    ethylene: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ethylene_sensitive: Mapped[bool] = mapped_column(Boolean, default=False)
    registry_version: Mapped[str] = mapped_column(String(16))
    parameters: Mapped[list["CommodityStorageParameter"]] = relationship(back_populates="commodity", cascade="all, delete-orphan")


class CommodityStorageParameter(TimestampMixin, Base):
    __tablename__ = "commodity_storage_parameters"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    commodity_id: Mapped[str] = mapped_column(ForeignKey("commodities.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(200))
    value: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(48))
    range_low: Mapped[float | None] = mapped_column(Float, nullable=True)
    range_high: Mapped[float | None] = mapped_column(Float, nullable=True)
    classification: Mapped[str] = mapped_column(String(32))
    source: Mapped[dict] = mapped_column(JSON)
    derivation: Mapped[str | None] = mapped_column(Text, nullable=True)
    limitations: Mapped[str | None] = mapped_column(Text, nullable=True)
    commodity: Mapped[Commodity] = relationship(back_populates="parameters")
    __table_args__ = (UniqueConstraint("commodity_id", "key", name="uq_param_commodity_key"),)


# ---------------- batches & inspection ----------------
class ProduceBatch(TimestampMixin, Base):
    __tablename__ = "produce_batches"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    farmer_id: Mapped[int | None] = mapped_column(ForeignKey("farmer_profiles.id", ondelete="SET NULL"), nullable=True, index=True)
    commodity_id: Mapped[str] = mapped_column(ForeignKey("commodities.id"), index=True)
    variety: Mapped[str | None] = mapped_column(String(64), nullable=True)
    quantity_kg: Mapped[float] = mapped_column(Float)
    harvest_time: Mapped[datetime] = mapped_column(DateTime)
    initial_quality: Mapped[float] = mapped_column(Float)
    maturity: Mapped[str | None] = mapped_column(String(24), nullable=True)
    location_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    storage_path: Mapped[str | None] = mapped_column(String(16), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="registered", index=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    __table_args__ = (CheckConstraint("quantity_kg > 0", name="ck_batch_qty"),
                      CheckConstraint("initial_quality >= 0 and initial_quality <= 100", name="ck_batch_quality"),
                      CheckConstraint("status in ('registered','inspected','in_storage','in_transit','sold','discarded')", name="ck_batch_status"))


class Inspection(TimestampMixin, Base):
    __tablename__ = "inspections"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("produce_batches.id", ondelete="SET NULL"), nullable=True, index=True)
    commodity_id: Mapped[str] = mapped_column(ForeignKey("commodities.id"))
    method: Mapped[str] = mapped_column(String(48))
    model_version: Mapped[str] = mapped_column(String(64))
    images_count: Mapped[int] = mapped_column(Integer, default=0)
    objects_detected: Mapped[int] = mapped_column(Integer, default=0)
    summary: Mapped[dict] = mapped_column(JSON, default=dict)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    results: Mapped[list["InspectionResult"]] = relationship(cascade="all, delete-orphan")


class InspectionResult(TimestampMixin, Base):
    __tablename__ = "inspection_results"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    inspection_id: Mapped[int] = mapped_column(ForeignKey("inspections.id", ondelete="CASCADE"), index=True)
    image_name: Mapped[str] = mapped_column(String(255))
    object_index: Mapped[int] = mapped_column(Integer)
    bbox: Mapped[list] = mapped_column(JSON)
    category: Mapped[str] = mapped_column(String(16))
    confidence: Mapped[float] = mapped_column(Float)
    features: Mapped[dict] = mapped_column(JSON, default=dict)
    __table_args__ = (CheckConstraint("category in ('good','damaged','rejected','uncertain')", name="ck_insp_category"),)


# ---------------- storage ----------------
class StorageFacility(TimestampMixin, Base):
    __tablename__ = "storage_facilities"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(16))
    location_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    zones: Mapped[list["StorageZone"]] = relationship(back_populates="facility", cascade="all, delete-orphan")
    __table_args__ = (CheckConstraint("kind in ('traditional','cold')", name="ck_facility_kind"),)


class StorageZone(TimestampMixin, Base):
    __tablename__ = "storage_zones"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    facility_id: Mapped[int] = mapped_column(ForeignKey("storage_facilities.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    temp_min: Mapped[float] = mapped_column(Float)
    temp_max: Mapped[float] = mapped_column(Float)
    setpoint: Mapped[float] = mapped_column(Float)
    rh_setpoint: Mapped[float] = mapped_column(Float)
    capacity_kg: Mapped[float] = mapped_column(Float)
    cooling_capacity_kw: Mapped[float] = mapped_column(Float, default=0)
    ua_w_per_k: Mapped[float] = mapped_column(Float)
    volume_m3: Mapped[float] = mapped_column(Float)
    air_changes_per_hour: Mapped[float] = mapped_column(Float, default=0.3)
    cost_per_kg_day: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(16), default="operational")
    facility: Mapped[StorageFacility] = relationship(back_populates="zones")
    __table_args__ = (CheckConstraint("capacity_kg > 0", name="ck_zone_capacity"), CheckConstraint("temp_min <= temp_max", name="ck_zone_temps"))


class StorageAllocation(TimestampMixin, Base):
    __tablename__ = "storage_allocations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("produce_batches.id", ondelete="CASCADE"), index=True)
    zone_id: Mapped[int] = mapped_column(ForeignKey("storage_zones.id", ondelete="CASCADE"), index=True)
    quantity_kg: Mapped[float] = mapped_column(Float)
    setpoint: Mapped[float] = mapped_column(Float)
    rh_setpoint: Mapped[float] = mapped_column(Float)
    expected_shelf_life_days: Mapped[float | None] = mapped_column(Float, nullable=True)
    estimated_cost: Mapped[float] = mapped_column(Float, default=0)
    planned_days: Mapped[float] = mapped_column(Float, default=7)
    status: Mapped[str] = mapped_column(String(16), default="active")
    rationale: Mapped[dict] = mapped_column(JSON, default=dict)


# ---------------- transport ----------------
class Truck(TimestampMixin, Base):
    __tablename__ = "trucks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    cooling_capacity_kw: Mapped[float] = mapped_column(Float)
    ua_w_per_k: Mapped[float] = mapped_column(Float)
    cargo_volume_m3: Mapped[float] = mapped_column(Float)
    capacity_kg: Mapped[float] = mapped_column(Float)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class TransportationRoute(TimestampMixin, Base):
    __tablename__ = "transportation_routes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    origin_name: Mapped[str] = mapped_column(String(200))
    origin_lat: Mapped[float] = mapped_column(Float)
    origin_lng: Mapped[float] = mapped_column(Float)
    dest_name: Mapped[str] = mapped_column(String(200))
    dest_lat: Mapped[float] = mapped_column(Float)
    dest_lng: Mapped[float] = mapped_column(Float)
    distance_m: Mapped[float] = mapped_column(Float)
    duration_s: Mapped[float] = mapped_column(Float)
    geometry: Mapped[list] = mapped_column(JSON)
    source: Mapped[str] = mapped_column(String(32))
    retrieved_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


# ---------------- simulation ----------------
class Simulation(TimestampMixin, Base):
    __tablename__ = "simulations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(24), index=True)
    name: Mapped[str] = mapped_column(String(160))
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("produce_batches.id", ondelete="SET NULL"), nullable=True, index=True)
    zone_id: Mapped[int | None] = mapped_column(ForeignKey("storage_zones.id", ondelete="SET NULL"), nullable=True)
    truck_id: Mapped[int | None] = mapped_column(ForeignKey("trucks.id", ondelete="SET NULL"), nullable=True)
    route_id: Mapped[int | None] = mapped_column(ForeignKey("transportation_routes.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="created", index=True)
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    sim_seconds: Mapped[float] = mapped_column(Float, default=0)
    speed: Mapped[float] = mapped_column(Float, default=60)
    scenario: Mapped[str | None] = mapped_column(String(48), nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    __table_args__ = (CheckConstraint("kind in ('traditional_storage','cold_storage','cold_chain')", name="ck_sim_kind"),
                      CheckConstraint("status in ('created','running','paused','completed','failed')", name="ck_sim_status"))


class SimulationState(TimestampMixin, Base):
    __tablename__ = "simulation_states"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    simulation_id: Mapped[int] = mapped_column(ForeignKey("simulations.id", ondelete="CASCADE"), index=True)
    sim_seconds: Mapped[float] = mapped_column(Float)
    state: Mapped[dict] = mapped_column(JSON)


class VirtualSensorReading(Base):
    __tablename__ = "virtual_sensor_readings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    simulation_id: Mapped[int] = mapped_column(ForeignKey("simulations.id", ondelete="CASCADE"))
    sensor_id: Mapped[str] = mapped_column(String(48))
    kind: Mapped[str] = mapped_column(String(24))
    value: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(16))
    sim_seconds: Mapped[float] = mapped_column(Float)
    origin: Mapped[str] = mapped_column(String(16), default="simulated")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    __table_args__ = (Index("ix_readings_sim_time", "simulation_id", "sim_seconds"),)


class Prediction(TimestampMixin, Base):
    __tablename__ = "predictions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    simulation_id: Mapped[int | None] = mapped_column(ForeignKey("simulations.id", ondelete="CASCADE"), nullable=True, index=True)
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("produce_batches.id", ondelete="CASCADE"), nullable=True, index=True)
    sim_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    quality: Mapped[float] = mapped_column(Float)
    shelf_life_days: Mapped[float | None] = mapped_column(Float, nullable=True)
    shelf_life_p10: Mapped[float | None] = mapped_column(Float, nullable=True)
    shelf_life_p90: Mapped[float | None] = mapped_column(Float, nullable=True)
    spoilage_risk: Mapped[float] = mapped_column(Float, default=0)
    model_version: Mapped[str] = mapped_column(String(32))
    inputs: Mapped[dict] = mapped_column(JSON, default=dict)


class Alert(TimestampMixin, Base):
    __tablename__ = "alerts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    simulation_id: Mapped[int | None] = mapped_column(ForeignKey("simulations.id", ondelete="CASCADE"), nullable=True, index=True)
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("produce_batches.id", ondelete="SET NULL"), nullable=True, index=True)
    truck_id: Mapped[int | None] = mapped_column(ForeignKey("trucks.id", ondelete="SET NULL"), nullable=True)
    zone_id: Mapped[int | None] = mapped_column(ForeignKey("storage_zones.id", ondelete="SET NULL"), nullable=True)
    severity: Mapped[str] = mapped_column(String(10), index=True)
    code: Mapped[str] = mapped_column(String(48))
    title: Mapped[str] = mapped_column(String(200))
    message: Mapped[str] = mapped_column(Text)
    reading: Mapped[dict] = mapped_column(JSON, default=dict)
    expected: Mapped[dict] = mapped_column(JSON, default=dict)
    risk: Mapped[str] = mapped_column(Text)
    recommendation: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)
    sim_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    acknowledged_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    __table_args__ = (CheckConstraint("severity in ('INFO','WARNING','CRITICAL')", name="ck_alert_severity"),
                      CheckConstraint("status in ('open','acknowledged','resolved')", name="ck_alert_status"))


class CorrectiveAction(TimestampMixin, Base):
    __tablename__ = "corrective_actions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    alert_id: Mapped[int | None] = mapped_column(ForeignKey("alerts.id", ondelete="SET NULL"), nullable=True, index=True)
    simulation_id: Mapped[int | None] = mapped_column(ForeignKey("simulations.id", ondelete="CASCADE"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(64))
    reason: Mapped[str] = mapped_column(Text)
    parameters: Mapped[dict] = mapped_column(JSON, default=dict)
    automatic: Mapped[bool] = mapped_column(Boolean, default=False)
    applied: Mapped[bool] = mapped_column(Boolean, default=False)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


# ---------------- market ----------------
class MarketPrice(TimestampMixin, Base):
    __tablename__ = "market_prices"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    commodity_id: Mapped[str] = mapped_column(ForeignKey("commodities.id"), index=True)
    market: Mapped[str] = mapped_column(String(120), index=True)
    district: Mapped[str | None] = mapped_column(String(120), nullable=True)
    state: Mapped[str | None] = mapped_column(String(120), nullable=True)
    variety: Mapped[str | None] = mapped_column(String(120), nullable=True)
    price_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_modal: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(24), default="Rs/quintal")
    observation_date: Mapped[datetime] = mapped_column(DateTime, index=True)
    source: Mapped[str] = mapped_column(String(200))
    origin: Mapped[str] = mapped_column(String(16), default="live")
    retrieved_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    __table_args__ = (UniqueConstraint("commodity_id", "market", "variety", "observation_date", "source", name="uq_price_obs"),)


class PriceForecast(TimestampMixin, Base):
    __tablename__ = "price_forecasts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    commodity_id: Mapped[str] = mapped_column(ForeignKey("commodities.id"), index=True)
    market: Mapped[str] = mapped_column(String(120))
    model: Mapped[str] = mapped_column(String(64))
    horizon_days: Mapped[int] = mapped_column(Integer)
    trained_points: Mapped[int] = mapped_column(Integer)
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    points: Mapped[list] = mapped_column(JSON, default=list)


class MarketEvent(TimestampMixin, Base):
    __tablename__ = "market_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    commodity_id: Mapped[str | None] = mapped_column(ForeignKey("commodities.id"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(300))
    summary: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(48))
    source_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    event_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    extracted_by: Mapped[str] = mapped_column(String(48))


class ProfitScenario(TimestampMixin, Base):
    __tablename__ = "profit_scenarios"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("produce_batches.id", ondelete="CASCADE"), nullable=True, index=True)
    inputs: Mapped[dict] = mapped_column(JSON)
    results: Mapped[dict] = mapped_column(JSON)
    recommendation: Mapped[str] = mapped_column(String(32))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


# ---------------- field flow (phone app -> laptop simulation) ----------------
class Lot(TimestampMixin, Base):
    """One intake of produce entered on the phone, followed through godown, grading, sale and delivery."""
    __tablename__ = "lots"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("produce_batches.id", ondelete="CASCADE"), index=True)
    station_id: Mapped[int | None] = mapped_column(ForeignKey("qr_access_sessions.id", ondelete="SET NULL"), nullable=True, index=True)
    mode: Mapped[str] = mapped_column(String(16))
    stage: Mapped[str] = mapped_column(String(16), default="intake", index=True)
    storage_sim_id: Mapped[int | None] = mapped_column(ForeignKey("simulations.id", ondelete="SET NULL"), nullable=True)
    speed: Mapped[float] = mapped_column(Float, default=60.0)
    paused: Mapped[bool] = mapped_column(Boolean, default=False)
    grading: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    decision: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    events: Mapped[list] = mapped_column(JSON, default=list)
    script: Mapped[dict | None] = mapped_column(JSON, nullable=True)   # playable sample situation progress
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    __table_args__ = (CheckConstraint("mode in ('traditional','advanced')", name="ck_lot_mode"),
                      CheckConstraint("stage in ('intake','storage','grading','graded','dispatched','arrived','delivered')", name="ck_lot_stage"))


class Shipment(TimestampMixin, Base):
    __tablename__ = "shipments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lot_id: Mapped[int] = mapped_column(ForeignKey("lots.id", ondelete="CASCADE"), index=True)
    simulation_id: Mapped[int | None] = mapped_column(ForeignKey("simulations.id", ondelete="SET NULL"), nullable=True)
    grade: Mapped[str] = mapped_column(String(8))
    quantity_kg: Mapped[float] = mapped_column(Float)
    destination_name: Mapped[str] = mapped_column(String(160))
    dest_lat: Mapped[float] = mapped_column(Float)
    dest_lng: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(16), default="in_transit")
    checkpoints: Mapped[list] = mapped_column(JSON, default=list)
    reroutes: Mapped[list] = mapped_column(JSON, default=list)
    unload_progress: Mapped[float] = mapped_column(Float, default=0.0)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    __table_args__ = (CheckConstraint("grade in ('A1','A2','A3','ALL')", name="ck_ship_grade"),
                      CheckConstraint("status in ('in_transit','arrived','delivered','cancelled')", name="ck_ship_status"))


# ---------------- access & audit ----------------
class QRAccessSession(TimestampMixin, Base):
    __tablename__ = "qr_access_sessions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    pin_hash: Mapped[str] = mapped_column(String(255))
    resource_type: Mapped[str] = mapped_column(String(16))
    resource_id: Mapped[int] = mapped_column(Integer)
    permissions: Mapped[list] = mapped_column(JSON, default=list)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    uses: Mapped[int] = mapped_column(Integer, default=0)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    __table_args__ = (CheckConstraint("resource_type in ('batch','simulation','zone','truck','station')", name="ck_qr_resource"),)


class NotificationSubscription(TimestampMixin, Base):
    __tablename__ = "notification_subscriptions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    qr_session_id: Mapped[int | None] = mapped_column(ForeignKey("qr_access_sessions.id", ondelete="CASCADE"), nullable=True, index=True)
    endpoint: Mapped[str] = mapped_column(String(1000), unique=True)
    p256dh: Mapped[str] = mapped_column(String(255))
    auth: Mapped[str] = mapped_column(String(255))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    actor_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    action: Mapped[str] = mapped_column(String(64), index=True)
    entity: Mapped[str] = mapped_column(String(48))
    entity_id: Mapped[str | None] = mapped_column(String(48), nullable=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
