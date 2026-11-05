"""System tests (brief section 18, tests 13-15). Run in DEMO MODE on a throwaway database with no API keys."""
import asyncio
import os
import pathlib
import tempfile

_tmp = pathlib.Path(tempfile.mkdtemp()) / "test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp.as_posix()}"
os.environ["APP_MODE"] = "demo"
for k in ("GROQ_API_KEY", "DATA_GOV_API_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"):
    os.environ[k] = ""

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core import config  # noqa: E402

config.settings.groq_api_key = ""
config.settings.telegram_bot_token = ""
config.settings.data_gov_api_key = ""

from app.db.models import Batch, Trip  # noqa: E402
from app.db.seed import seed  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.simulation.loop import tick  # noqa: E402
from app.workflows.rescue import run_rescue  # noqa: E402

client = TestClient(app)  # not used as a context manager: the background simulator stays off


@pytest.fixture(autouse=True)
def fresh():
    seed()
    yield


def advance(n):
    with SessionLocal() as db:
        for _ in range(n):
            tick(db)
        db.commit()


def snapshot():
    with SessionLocal() as db:
        return sorted((b.id, round(b.q, 6), round(b.w, 6), b.status, b.storage_type) for b in db.query(Batch).all()), \
            sorted((t.id, round(t.progress_s, 1), t.reefer_status, t.dest_id) for t in db.query(Trip).all())


# 13 — Scenario 1: prediction and decision
def test_scenario_1_prediction_and_decision():
    r = client.post("/api/v1/batches", json={"produce": "tomato", "quantity_kg": 500, "district": "kolar", "storage_type": "open_shed",
                                             "maturity": "mature_green", "initial_quality": 95, "variety": "Local hybrid"})
    assert r.status_code == 201, r.text
    bid = r.json()["id"]
    twin = client.get(f"/api/v1/batches/{bid}/twin").json()
    assert twin["conditions"]["weather_based"] and twin["conditions"]["banner"]
    assert twin["shelf_life"]["p10_days"] <= (twin["shelf_life"]["days"] or 99) <= twin["shelf_life"]["p90_days"] + 1e-6
    assert len(twin["trajectory"]) == 57 and twin["confidence"]["category"] in ("LOW", "MEDIUM")
    w = client.post("/api/v1/simulations/recalculate", json={"batch_id": bid, "temperature": 17.3, "humidity": 90, "request_id": 3}).json()
    assert w["request_id"] == 3 and w["whatif"]["shelf_life_days"] != w["baseline"]["shelf_life_days"]
    d = client.get(f"/api/v1/decide/{bid}").json()
    assert d["action"] in ("SELL", "STORE", "SHIP") and d["explanation"] and d["alternatives"]
    # a measured reading raises confidence and removes the weather-only source
    t2 = client.post(f"/api/v1/batches/{bid}/readings", json={"temperature": 24.0, "humidity": 80}).json()
    assert t2["confidence"]["score"] > twin["confidence"]["score"]


def test_invalid_batch_rejected():
    r = client.post("/api/v1/batches", json={"produce": "tomato", "quantity_kg": -1, "district": "kolar"})
    assert r.status_code == 422 and r.json()["detail"]["error"] == "invalid_input"
    r = client.post("/api/v1/batches", json={"produce": "durian", "quantity_kg": 10, "district": "kolar"})
    assert r.status_code == 422


# 13 — Scenario 2: reefer failure and rescue
def test_scenario_2_reefer_failure_and_rescue():
    advance(20)
    r = client.post("/api/v1/trips/TRIP-S2/inject-failure")
    assert r.status_code == 200, r.text
    advance(10)
    proposal = asyncio.run(run_rescue("TRIP-S2", step_delay=0))
    wf = client.get("/api/v1/workflows/TRIP-S2").json()
    assert wf["run"]["kind"] == "rule_based" and [s["stage"] for s in wf["steps"]][:1] == ["Detect"] and len(wf["steps"]) == 6
    assert proposal["recommend"] == "reroute" and proposal["requires_approval"]
    with SessionLocal() as db:
        assert db.get(Trip, "TRIP-S2").dest_id == "m_hubballi"  # nothing moves before approval
    a = client.post("/api/v1/trips/TRIP-S2/approve-reroute", json={}).json()
    g = a["ghost_comparison"]
    assert g["value_protected"] == round(g["reroute"]["net"] - g["ghost"]["net"])
    assert g["value_protected"] > 0 and a["trip"]["rerouted"] and a["trip"]["dest_id"] != "m_hubballi"
    imp = client.get("/api/v1/impact").json()
    assert imp["value_protected"] == round(g["value_protected"])
    prev = [n for n in client.get("/api/v1/notifications?channel=whatsapp_preview").json()["notifications"]]
    assert prev and all(not n["delivered"] for n in prev) and any(n["body_kn"] for n in prev)


# 13 — Scenario 3: market shift
def test_scenario_3_market_shift():
    r = client.post("/api/v1/demo/scenario/3").json()
    assert r["condition"] == "price_crash"
    crash = client.get("/api/v1/decide/ZR-TOM-101/market-shift").json()
    assert crash["condition"] == "price_crash" and crash["recommended"] == "DAY_0" and len(crash["periods"]) == 4
    other = next(p for p in crash["periods"] if not p["recommended"])
    c = client.post("/api/v1/decide/ZR-TOM-101/choice", json={"kind": "market_shift", "plan_id": crash["plan_id"], "chosen_key": other["key"]}).json()
    assert c["difference"] < 0 and "your call" in c["message"]
    fest = client.get("/api/v1/decide/ZR-TOM-101/market-shift?condition=festival").json()
    assert fest["recommended"] != crash["recommended"]


# 14
def test_reset_restores_exact_start_state():
    start = snapshot()
    advance(15)
    client.post("/api/v1/trips/TRIP-S2/inject-failure")
    assert snapshot() != start
    r = client.post("/api/v1/demo/reset").json()
    assert r["ok"] and r["seconds"] < 2.0
    assert snapshot() == start


# 15
def test_whatif_echoes_latest_request_and_is_live():
    a = client.post("/api/v1/simulations/recalculate", json={"batch_id": "ZR-TOM-101", "temperature": 10.0, "request_id": 41}).json()
    b = client.post("/api/v1/simulations/recalculate", json={"batch_id": "ZR-TOM-101", "temperature": 30.0, "request_id": 42}).json()
    assert a["request_id"] == 41 and b["request_id"] == 42
    assert b["whatif"]["quality_at"] < a["whatif"]["quality_at"]
    with SessionLocal() as db:  # what-if never changes the batch
        assert db.get(Batch, "ZR-TOM-101").quantity_kg == 2500


def test_dashboard_and_impact_from_records():
    d = client.get("/api/v1/dashboard").json()
    assert d["stats"]["active_batches"] == 21 and len(d["trips"]) == 15
    v = client.get("/api/v1/validation").json()
    assert v["message"] == "Validation data not yet available."
