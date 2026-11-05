"""API + integration tests on a throwaway database. External services are replaced by stubs that either fail
(to test the 'unavailable' paths) or return fixed fixtures; no network is used."""
import os
import pathlib
import tempfile
from datetime import date, datetime, timedelta

_tmp = pathlib.Path(tempfile.mkdtemp()) / "api.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp.as_posix()}"
os.environ["GROQ_API_KEY"] = ""
os.environ["DATA_GOV_API_KEY"] = ""

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import settings  # noqa: E402

settings.groq_api_key = ""
settings.data_gov_api_key = ""
settings.rate_limit_per_minute = 100000

from app.core import deps  # noqa: E402

deps.limiter.per_minute = 100000
from app.db.bootstrap import sync_commodities  # noqa: E402
from app.db.models import MarketPrice  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.integrations import routing, weather  # noqa: E402
from app.main import app, migrate  # noqa: E402
from app.simulation.manager import manager  # noqa: E402

PHOTOS = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "public" / "produce"
client = TestClient(app)


def _no_weather(*a, **k):
    raise weather.Unavailable("stubbed outage")


def _route(o, d):
    return {"distance_m": 100000.0, "duration_s": 7200.0, "geometry": [[o[1], o[0]], [(o[1] + d[1]) / 2, (o[0] + d[0]) / 2], [d[1], d[0]]],
            "source": "osrm_live", "provider": "stub", "retrieved_at": datetime.utcnow().isoformat()}


@pytest.fixture(scope="module", autouse=True)
def setup():
    migrate()
    with SessionLocal() as db:
        sync_commodities(db)
    weather.forecast = _no_weather
    routing.route = _route
    yield


@pytest.fixture(scope="module")
def H():
    r = client.post("/api/v1/auth/register", json={"email": "admin@zerorotfarm.in", "name": "Admin", "password": "s3cure-pass"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_auth_flow(H):
    assert client.get("/api/v1/auth/setup").json()["needs_admin"] is False
    assert client.post("/api/v1/auth/register", json={"email": "x@zerorotfarm.in", "name": "Xavier", "password": "s3cure-pass"}).status_code == 403
    assert client.post("/api/v1/auth/login", json={"email": "admin@zerorotfarm.in", "password": "wrong-pass"}).status_code == 401
    assert client.get("/api/v1/batches").status_code == 401
    assert client.get("/api/v1/auth/me", headers=H).json()["user"]["role"] == "admin"
    r = client.post("/api/v1/auth/users", headers=H, json={"email": "op@zerorotfarm.in", "name": "Op", "password": "s3cure-pass", "role": "operator"})
    assert r.status_code == 201
    op = client.post("/api/v1/auth/login", json={"email": "op@zerorotfarm.in", "password": "s3cure-pass"}).json()["access_token"]
    assert client.get("/api/v1/audit", headers={"Authorization": f"Bearer {op}"}).status_code == 403


def test_commodity_catalog_flags_onion():
    c = {x["id"]: x for x in client.get("/api/v1/commodities").json()["commodities"]}
    assert set(c) == {"tomato", "mango", "banana", "potato", "onion"}
    assert c["onion"]["prediction_supported"] is False and "dormancy" in c["onion"]["prediction_note"]


@pytest.fixture(scope="module")
def batch(H):
    f = client.post("/api/v1/farmers", headers=H, json={"name": "Ramesh", "location_name": "Kolar", "lat": 13.14, "lng": 78.13}).json()
    bad = client.post("/api/v1/batches", headers=H, json={"commodity_id": "onion", "quantity_kg": 100, "harvest_time": datetime.utcnow().isoformat(),
                                                          "initial_quality": 90})
    assert bad.status_code == 422
    fut = client.post("/api/v1/batches", headers=H, json={"commodity_id": "tomato", "quantity_kg": 100, "initial_quality": 90,
                                                          "harvest_time": (datetime.utcnow() + timedelta(days=1)).isoformat()})
    assert fut.status_code == 422
    r = client.post("/api/v1/batches", headers=H, json={"farmer_id": f["id"], "commodity_id": "tomato", "quantity_kg": 2000, "initial_quality": 94,
                                                        "maturity": "mature_green", "harvest_time": (datetime.utcnow() - timedelta(hours=8)).isoformat(),
                                                        "location_name": "Kolar", "lat": 13.14, "lng": 78.13})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture(scope="module")
def zone(H):
    fid = client.post("/api/v1/storage/facilities", headers=H, json={"name": "Malur Cold Store", "kind": "cold", "location_name": "Malur", "lat": 13.0, "lng": 77.94}).json()["id"]
    z = client.post(f"/api/v1/storage/facilities/{fid}/zones", headers=H, json={"name": "Room A", "temp_min": 8, "temp_max": 16, "setpoint": 12.5,
                                                                              "capacity_kg": 3000, "cooling_capacity_kw": 12, "ua_w_per_k": 60, "volume_m3": 150,
                                                                              "cost_per_kg_day": 0.45})
    assert z.status_code == 201, z.text
    return z.json()


def test_allocation_respects_capacity(H, batch, zone):
    rec = client.post("/api/v1/storage/allocations/recommend", headers=H, json={"batch_id": batch["id"], "planned_days": 5}).json()
    assert rec["recommended"]["zone_id"] == zone["id"] and rec["recommended"]["setpoint_c"] == 12.5
    r = client.post("/api/v1/storage/allocations", headers=H, json={"batch_id": batch["id"], "planned_days": 5})
    assert r.status_code == 201
    big = client.post("/api/v1/batches", headers=H, json={"commodity_id": "tomato", "quantity_kg": 2000, "initial_quality": 90,
                                                          "harvest_time": datetime.utcnow().isoformat()}).json()
    over = client.post("/api/v1/storage/allocations", headers=H, json={"batch_id": big["id"], "zone_id": zone["id"], "planned_days": 5})
    assert over.status_code == 409 and "free" in over.json()["detail"]["message"]


def test_weather_outage_is_reported_not_invented(H, batch):
    r = client.post("/api/v1/simulations", headers=H, json={"kind": "traditional_storage", "batch_id": batch["id"], "duration_days": 3})
    assert r.status_code == 503 and "manual" in r.json()["detail"]["message"].lower()


def test_storage_simulation_alerts_and_actions(H, batch):
    r = client.post("/api/v1/simulations", headers=H, json={"kind": "cold_storage", "batch_id": batch["id"], "duration_days": 3,
                                                            "manual_ambient": {"t": 31, "rh": 60}, "speed": 3600})
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    assert client.post(f"/api/v1/simulations/{sid}/start", headers=H).json()["status"] == "running"
    for _ in range(3):
        manager.tick_once()
    client.post(f"/api/v1/simulations/{sid}/scenario", headers=H, json={"scenario": "cooling_failure"})
    for _ in range(2):
        manager.tick_once()
    live = client.get(f"/api/v1/simulations/{sid}", headers=H).json()["live"]
    assert live["labels"]["sensors"] == "SIMULATED" and live["ambient"]["source"] == "manual"
    alerts = client.get(f"/api/v1/simulations/{sid}/alerts", headers=H).json()["alerts"]
    cf = [a for a in alerts if a["code"] == "COOLING_FAILURE"]
    assert cf and cf[0]["severity"] == "CRITICAL" and cf[0]["recommendation"] and cf[0]["expected"]
    assert client.post(f"/api/v1/alerts/{cf[0]['id']}/acknowledge", headers=H).json()["status"] == "acknowledged"
    acts = client.get(f"/api/v1/corrective-actions?simulation_id={sid}", headers=H).json()["actions"]
    backup = next(a for a in acts if a["action"] == "activate_backup_cooling")
    assert client.post(f"/api/v1/corrective-actions/{backup['id']}/apply", headers=H).json()["ok"]
    hist = client.get(f"/api/v1/simulations/{sid}/history", headers=H).json()
    assert len(hist["series"]) >= 10 and hist["predictions"]
    rd = client.get(f"/api/v1/simulations/{sid}/readings?sensor_id=T1", headers=H).json()["readings"]
    assert rd and all(x["origin"] == "simulated" for x in rd)
    client.post(f"/api/v1/simulations/{sid}/pause", headers=H)
    pytest.sim_id = sid


def test_qr_session_scoping_and_revocation(H, batch):
    sid = pytest.sim_id
    s = client.post("/api/v1/qr/sessions", headers=H, json={"resource_type": "simulation", "resource_id": sid, "ttl_minutes": 60}).json()
    assert "/m/" in s["url"] and len(s["pin"]) == 6
    wrong = "000000" if s["pin"] != "000000" else "111111"
    assert client.post("/api/v1/qr/verify", json={"token": s["token"], "pin": wrong}).status_code == 401
    ok = client.post("/api/v1/qr/verify", json={"token": s["token"], "pin": s["pin"]})
    assert ok.status_code == 200
    M = {"Authorization": f"Bearer {ok.json()['access_token']}"}
    ov = client.get("/api/v1/mobile/overview", headers=M).json()
    assert ov["simulations"][0]["id"] == sid and ov["simulations"][0]["live"]["labels"]["sensors"] == "SIMULATED"
    assert client.get(f"/api/v1/simulations/{sid + 999}", headers=M).status_code == 404
    assert client.post(f"/api/v1/simulations/{sid}/start", headers=M).status_code == 403   # view-only link
    assert client.post("/api/v1/batches", headers=M, json={}).status_code in (403, 422)
    client.post(f"/api/v1/qr/sessions/{s['id']}/revoke", headers=H)
    assert client.get("/api/v1/mobile/overview", headers=M).status_code == 401
    assert client.post("/api/v1/qr/verify", json={"token": "x" * 40, "pin": "123456"}).status_code == 403


def test_profit_never_recommends_unprofitable_waiting(H, batch):
    r = client.post("/api/v1/profit/evaluate", headers=H, json={"batch_id": batch["id"], "price_per_kg": 20, "storage": "traditional",
                                                                "storage_temp_c": 30, "storage_rh_pct": 60, "storage_cost_per_kg_day": 0.5}).json()
    assert r["recommendation"] == "sell_now"
    assert any("assumed equal to today's" in a for a in r["assumptions"])
    row0 = r["rows"][0]
    assert row0["net_profit"] == pytest.approx(row0["revenue"] - row0["storage_cost"] - row0["transport_cost"] - row0["commission"] - row0["other_costs"], abs=0.05)


def test_market_unavailable_and_forecast(H):
    assert client.get("/api/v1/market/prices?commodity=tomato", headers=H).json()["status"] == "data_unavailable"
    assert client.post("/api/v1/market/refresh?commodity=tomato", headers=H).status_code == 503
    import math
    with SessionLocal() as db:   # fixture history (test data only) to exercise the model
        for d in range(150):
            day = datetime(2026, 1, 1) + timedelta(days=d)
            db.add(MarketPrice(commodity_id="tomato", market="TestMandi", price_modal=2000 + 400 * math.sin(d / 9) + d * 2, observation_date=day,
                               source="test fixture", origin="test"))
        db.commit()
    short = client.post("/api/v1/market/forecast?commodity=tomato&market_name=Nowhere", headers=H).json()
    assert short["status"] == "insufficient_data"
    fc = client.post("/api/v1/market/forecast?commodity=tomato&market_name=TestMandi&horizon=7", headers=H).json()
    assert fc["status"] == "ok" and len(fc["points"]) == 7 and fc["metrics"]
    assert all(p["low"] <= p["price"] <= p["high"] for p in fc["points"])


def test_inspection_real_inference_and_invalid_upload(H, batch):
    files = [("files", ("tomato_fresh.jpg", (PHOTOS / "tomato_fresh.jpg").read_bytes(), "image/jpeg"))]
    r = client.post("/api/v1/inspections", headers=H, data={"commodity_id": "tomato", "batch_id": str(batch["id"])}, files=files)
    assert r.status_code == 201, r.text
    j = r.json()
    assert j["method"] == "opencv_classical" and j["summary"]["objects_detected"] >= 1
    assert "Only the objects visible" in j["summary"]["scope"]
    bad = client.post("/api/v1/inspections", headers=H, data={"commodity_id": "tomato"}, files=[("files", ("x.jpg", b"not an image", "image/jpeg"))])
    assert bad.status_code == 422


def test_cold_chain_with_route_and_comparison(H):
    b = client.post("/api/v1/batches", headers=H, json={"commodity_id": "banana", "quantity_kg": 4000, "initial_quality": 93, "maturity": "mature_green",
                                                        "harvest_time": datetime.utcnow().isoformat()}).json()
    t = client.post("/api/v1/trucks", headers=H, json={"code": "KA-01-RF-1", "name": "Reefer 1", "cooling_capacity_kw": 8, "ua_w_per_k": 120,
                                                       "cargo_volume_m3": 40, "capacity_kg": 8000}).json()
    rt = client.post("/api/v1/routes", headers=H, json={"origin_name": "Bengaluru", "origin_lat": 12.97, "origin_lng": 77.59, "dest_name": "Mandya",
                                                        "dest_lat": 12.52, "dest_lng": 76.90}).json()
    assert rt["distance_km"] == 100.0 and rt["source"] == "osrm_live"
    r = client.post("/api/v1/simulations", headers=H, json={"kind": "cold_chain", "batch_id": b["id"], "truck_id": t["id"], "route_id": rt["id"],
                                                            "target_temp_c": 14, "manual_ambient": {"t": 33, "rh": 55}, "speed": 600})
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    live = client.get(f"/api/v1/simulations/{sid}", headers=H).json()["live"]
    assert len(live["readings"]["zone_temperatures_c"]) == 6 and live["route"]["distance_m"] == 100000.0
    cmp_ = client.post("/api/v1/analytics/compare", headers=H, json={"mode": "cold_chain", "simulation_id": sid, "fault_scenario": "refrigeration_failure",
                                                                     "price_per_kg": 28}).json()
    assert cmp_["baseline"]["final_quality"] < cmp_["improved"]["final_quality"]
    assert cmp_["loss_prevented_kg"] == pytest.approx(cmp_["baseline"]["lost_kg"] - cmp_["improved"]["lost_kg"], abs=0.11)
    assert "counterfactual" in cmp_["label"]
    pdf = client.post("/api/v1/analytics/compare/export?fmt=pdf", headers=H, json={"mode": "cold_chain", "simulation_id": sid})
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    csv = client.post("/api/v1/analytics/compare/export?fmt=csv", headers=H, json={"mode": "cold_chain", "simulation_id": sid})
    assert "Loss prevented" in csv.text


def test_groq_unavailable_reports_error(H):
    r = client.post("/api/v1/ai/explain", headers=H, json={"task": "simulation", "simulation_id": pytest.sim_id})
    assert r.status_code == 503 and "unaffected" in r.json()["detail"]["message"]


def test_dashboard_summary_from_records(H):
    s = client.get("/api/v1/analytics/summary", headers=H).json()
    assert s["active_batches"] >= 1 and s["storage_facilities"] == 1 and s["trucks"] == 1
