"""Simulation engine tests: physics, scenarios, alerts, determinism (no external services)."""
from datetime import datetime, timedelta

import pytest

from app.simulation import environment as env
from app.simulation.engine import Runtime, initial_state, run_headless
from app.simulation.truck_model import N_ZONES

START = datetime(2026, 11, 5, 0, 0)


def weather(t=30.0, rh=60.0, p=91000.0, days=20, amplitude=0.0, points=1):
    times = [(START + timedelta(hours=h)).timestamp() for h in range(days * 24)]
    import math
    temps = [t + amplitude * math.sin(2 * math.pi * (h - 9) / 24) for h in range(len(times))]
    pt = {"times": times, "t": temps, "rh": [rh] * len(times), "p": [p] * len(times)}
    return {"source": "test", "points": [dict(pt) for _ in range(points)]}


def storage_cfg(kind="traditional_storage", **kw):
    cfg = {"start_time": START.isoformat(), "weather": weather(), "duration_days": 3,
           "batch": {"commodity": "tomato", "maturity": "mature_green", "quantity_kg": 2000, "initial_quality": 95},
           "volume_m3": 150.0, "ua_w_per_k": 300.0, "ach": 1.5, "c_struct_j_per_k": 2.0e7, "reading_interval_s": 600}
    if kind == "cold_storage":
        cfg.update(setpoint=12.5, rh_setpoint=92.0, cooling_kw=12.0, ua_w_per_k=60.0, ach=0.2, c_struct_j_per_k=3.0e6)
    cfg.update(kw)
    return cfg


def truck_cfg(**kw):
    cfg = {"start_time": START.isoformat(), "weather": weather(points=3), "batch": {"commodity": "banana", "maturity": "mature_green",
           "quantity_kg": 5000, "initial_quality": 94}, "setpoint": 14.0, "cooling_kw": 8.0, "ua_w_per_k": 120.0, "cargo_volume_m3": 40.0,
           "c_struct_j_per_k": 4.0e5, "ach": 0.3, "route_distance_m": 300000.0, "route_duration_s": 6 * 3600, "planned_speed_kmh": 50.0,
           "route_geometry": [[77.6, 12.97], [76.9, 12.5]], "reading_interval_s": 300}
    cfg.update(kw)
    return cfg


# ---------------- Dalton & psychrometrics ----------------
def test_dalton_ambient_oxygen_partial_pressure():
    p, t, rh = 101325.0, 25.0, 50.0
    pw = env.vapour_pressure(t, rh)
    assert pw == pytest.approx(1584, rel=0.01)
    assert env.ambient_o2_partial_pressure(p, t, rh) == pytest.approx(0.2095 * (p - pw))
    assert env.ambient_o2_partial_pressure(p, t, rh) == pytest.approx(20895, rel=0.002)


def test_psychrometric_roundtrip():
    for t, rh in [(5, 95), (14, 90), (30, 40)]:
        w = env.humidity_ratio(t, rh, 95000)
        assert env.rh_from_ratio(t, w, 95000) == pytest.approx(rh, abs=1e-6)
    assert env.dew_point(20, 100) == pytest.approx(20, abs=0.05)


# ---------------- thermal ----------------
def test_traditional_room_lags_ambient_and_never_copies_it():
    cfg = storage_cfg(weather=weather(t=30, amplitude=6), duration_days=5)
    rt = Runtime(1, "traditional_storage", cfg, initial_state("traditional_storage", cfg))
    temps = []
    for _ in range(96):
        rt.advance(3600, predictions=False)
        temps.append(rt.s.air.t)
    inside_swing = max(temps[72:]) - min(temps[72:])
    assert 30 < sum(temps[72:]) / 24 < 33      # mean slightly above ambient mean: respiration heat
    assert inside_swing < 12                    # thermal mass damps the 12 K outdoor swing


def test_cold_room_holds_setpoint_then_warms_gradually_after_failure():
    cfg = storage_cfg("cold_storage")
    rt = Runtime(2, "cold_storage", cfg, initial_state("cold_storage", cfg))
    rt.advance(12 * 3600, predictions=False)
    assert rt.s.air.t == pytest.approx(12.5, abs=1.5)
    rt.scenario("cooling_failure")
    last = rt.s.air.t
    for _ in range(120):                         # 1 hour in 30 s steps
        rt.advance(30, predictions=False)
        assert abs(rt.s.air.t - last) < 0.5      # no jumps
        last = rt.s.air.t
    rt.advance(24 * 3600, predictions=False)
    assert rt.s.air.t > 20                       # relaxes toward the 30 degC ambient


def test_door_open_warms_faster():
    def warm(door):
        cfg = storage_cfg("cold_storage")
        rt = Runtime(3, "cold_storage", cfg, initial_state("cold_storage", cfg))
        rt.scenario("cooling_failure")
        if door:
            rt.scenario("door_open")
        rt.advance(3600, predictions=False)
        return rt.s.air.t
    assert warm(True) > warm(False) + 1


# ---------------- gas ----------------
def test_sealed_store_accumulates_co2_and_ventilation_recovers():
    cfg = storage_cfg("cold_storage", ach=0.02, batch={"commodity": "banana", "maturity": "turning", "quantity_kg": 20000, "initial_quality": 95})
    rt = Runtime(4, "cold_storage", cfg, initial_state("cold_storage", cfg))
    rt.advance(24 * 3600, predictions=False)
    assert rt.s.air.x_co2 > 0.01 and rt.s.air.x_o2 < 0.20
    rt.control("fresh_air_ach", 5.0)
    rt.advance(6 * 3600, predictions=False)
    assert rt.s.air.x_co2 < 0.002


# ---------------- truck ----------------
def test_truck_zone_gradient_and_rear_door():
    cfg = truck_cfg()
    rt = Runtime(5, "cold_chain", cfg, initial_state("cold_chain", cfg))
    rt.advance(1800, predictions=False)
    assert len(rt.s.zones) == N_ZONES
    assert rt.s.zones[-1] > rt.s.zones[0]        # warmer away from the unit
    rt.scenario("door_open")
    rt.advance(900, predictions=False)
    assert rt.s.zones[-1] - rt.s.zones[0] > 1.0  # rear door heats the rear zones most


def test_refrigeration_failure_raises_cargo_temperature_and_quality_loss():
    ok = run_headless(6, "cold_chain", truck_cfg())
    fail = run_headless(7, "cold_chain", truck_cfg(), scenario="refrigeration_failure")
    assert fail["final_quality"] < ok["final_quality"]
    assert ok["distance_km"] == pytest.approx(300, abs=1)


def test_extended_delay_lengthens_trip():
    cfg = truck_cfg()
    rt = Runtime(8, "cold_chain", cfg, initial_state("cold_chain", cfg))
    rt.scenario("extended_delay")
    rt.advance(4 * 3600, predictions=False)
    assert rt.s.route_progress_m == 0.0 and rt.delay_s() > 3 * 3600


# ---------------- alerts & determinism ----------------
def test_cooling_failure_alert_opens_and_resolves():
    cfg = storage_cfg("cold_storage")
    rt = Runtime(9, "cold_storage", cfg, initial_state("cold_storage", cfg))
    rt.advance(3600, predictions=False)
    rt.scenario("cooling_failure")
    res = rt.advance(600, predictions=False)
    assert "COOLING_FAILURE" in {f.code for f in res["alerts_opened"]}
    rt.scenario("normal")
    res = rt.advance(600, predictions=False)
    assert "COOLING_FAILURE" in res["alerts_resolved"]


def test_auto_control_activates_backup_cooling_and_logs_reason():
    cfg = storage_cfg("cold_storage", auto_control=True)
    rt = Runtime(10, "cold_storage", cfg, initial_state("cold_storage", cfg))
    rt.scenario("cooling_failure")
    res = rt.advance(600, predictions=False)
    assert rt.s.equipment.backup_cooling
    assert any(a["action"] == "activate_backup_cooling" and a["reason"] for a in res["actions"])


def test_deterministic_and_prediction_fields():
    a = run_headless(11, "traditional_storage", storage_cfg())
    b = run_headless(11, "traditional_storage", storage_cfg())
    assert a == b
    cfg = storage_cfg()
    rt = Runtime(12, "traditional_storage", cfg, initial_state("traditional_storage", cfg))
    res = rt.advance(3600, predictions=True, mc_draws=40)
    p = res["prediction"]
    assert p["shelf_life_p10"] <= p["shelf_life_p90"] and 0 <= p["spoilage_probability"] <= 1


def test_missing_weather_requires_manual_ambient():
    cfg = storage_cfg(weather={"points": []})
    with pytest.raises(ValueError):
        initial_state("traditional_storage", cfg)
    cfg["manual_ambient"] = {"t": 28.0, "rh": 65.0}
    s = initial_state("traditional_storage", cfg)
    assert s.overrides.ambient_t == 28.0


def test_loss_summary_formula():
    s = run_headless(13, "traditional_storage", storage_cfg(duration_days=6))
    assert s["loss_pct"] == pytest.approx(s["lost_kg"] / s["initial_kg"] * 100, abs=0.01)
