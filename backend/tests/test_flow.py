"""End-to-end field flow: QR pairing -> lot intake -> godown -> scan & bag -> decision -> dispatch -> checkpoints -> reroute ->
arrival -> delivery. Weather, routing and reverse geocoding are stubbed with fixed fixtures (no network)."""
import math
import os
import pathlib
import tempfile
import time
from datetime import datetime, timedelta, timezone

if "DATABASE_URL" not in os.environ:
    os.environ["DATABASE_URL"] = f"sqlite:///{(pathlib.Path(tempfile.mkdtemp()) / 'flow.db').as_posix()}"
os.environ["GROQ_API_KEY"] = ""

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core import deps  # noqa: E402
from app.core.config import settings  # noqa: E402

settings.groq_api_key = ""
deps.limiter.per_minute = 100000
deps.ai_limiter.per_minute = 100000
from app.db.bootstrap import sync_commodities  # noqa: E402
from app.db.models import Alert  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.integrations import groq_ai, places, routing, weather  # noqa: E402
from app.main import app, migrate  # noqa: E402

client = TestClient(app)
KOLAR = (13.1377, 78.13)
BLR = (12.9634, 77.5776)


def _forecast(lat, lng, days=16, name=None):
    t0 = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0) - timedelta(days=1)
    times = [(t0 + timedelta(hours=i)).timestamp() for i in range(24 * 18)]
    return {"source": "fixture", "status": "live", "retrieved_at": t0.isoformat(), "lat": lat, "lng": lng, "name": name, "elevation": 850,
            "current": {}, "times": times, "t": [27 + 5 * math.sin(i / 24 * 2 * math.pi) for i in range(len(times))], "rh": [65.0] * len(times),
            "p": [92000.0] * len(times), "precip_mm": [0.0] * len(times), "cloud_pct": [40.0] * len(times)}


def _line(a, b, n=40):
    return [[round(a[1] + (b[1] - a[1]) * i / n, 6), round(a[0] + (b[0] - a[0]) * i / n, 6)] for i in range(n + 1)]


def _routes(points, alternatives=False):
    geom = []
    for a, b in zip(points, points[1:]):
        seg = _line(a, b)
        geom += seg if not geom else seg[1:]
    km = sum(math.dist((x0, y0), (x1, y1)) for (x0, y0), (x1, y1) in zip(geom, geom[1:])) * 111.0
    return [{"distance_m": km * 1000, "duration_s": km / 50 * 3600, "geometry": geom, "source": "osrm_live", "provider": "stub",
             "retrieved_at": datetime.utcnow().isoformat()}]


@pytest.fixture(scope="module", autouse=True)
def setup():
    migrate()
    with SessionLocal() as db:
        sync_commodities(db)
    saved = (weather.forecast, routing.routes, places.reverse, settings.groq_api_key)
    weather.forecast, routing.routes, places.reverse = _forecast, _routes, (lambda lat, lng: "Testpur")
    yield
    weather.forecast, routing.routes, places.reverse, settings.groq_api_key = saved


@pytest.fixture(scope="module")
def H():
    if client.get("/api/v1/auth/setup").json()["needs_admin"]:
        r = client.post("/api/v1/auth/register", json={"email": "admin@zerorotfarm.in", "name": "Admin", "password": "s3cure-pass"})
    else:
        r = client.post("/api/v1/auth/login", json={"email": "admin@zerorotfarm.in", "password": "s3cure-pass"})
    assert r.status_code in (200, 201), r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def pair(H):
    st = client.post("/api/v1/flow/stations", headers=H, json={}).json()
    assert "/p/" in st["url"] and len(st["pin"]) == 6
    assert client.post("/api/v1/qr/verify", json={"token": st["token"], "pin": "000000" if st["pin"] != "000000" else "111111"}).status_code == 401
    v = client.post("/api/v1/qr/verify", json={"token": st["token"], "pin": st["pin"]}).json()
    assert v["scope"]["type"] == "station"
    return st["id"], {"Authorization": f"Bearer {v['access_token']}"}


def step(P, lot_id, seconds):
    r = client.post(f"/api/v1/flow/lots/{lot_id}/step", headers=P, json={"seconds": seconds})
    assert r.status_code == 200, r.text
    return r.json()


def test_advanced_lot_full_journey(H):
    sid, P = pair(H)
    r = client.post("/api/v1/flow/lots", headers=P, json={"commodity": "tomato", "quantity_kg": 600, "quality": 92, "maturity": "turning",
                                                          "mode": "advanced", "lat": KOLAR[0], "lng": KOLAR[1], "location_name": "Kolar", "speed": 600})
    assert r.status_code == 201, r.text
    lot = r.json()
    assert lot["stage"] == "intake" and lot["storage"]["loading"]["duration_s"] == pytest.approx(600 / 2000 * 3600)
    assert lot["storage"]["equipment"]["door_open"] is False or lot["storage"]["loading"]["progress"] == 0
    # a different station cannot see this lot
    _, P2 = pair(H)
    assert client.get(f"/api/v1/flow/lots/{lot['id']}", headers=P2).status_code == 404
    # intake: door open while loading, then closed and stored
    mid = step(P, lot["id"], 600)
    assert mid["stage"] == "intake" and mid["storage"]["equipment"]["door_open"] is True
    done = step(P, lot["id"], 900)
    assert done["stage"] == "storage" and done["storage"]["equipment"]["door_open"] is False
    assert any(e["kind"] == "stored" for e in done["events"])
    # godown control from the phone
    r = client.post(f"/api/v1/flow/lots/{lot['id']}/control", headers=P, json={"name": "setpoint", "value": 14})
    assert r.status_code == 200 and r.json()["storage"]["equipment"]["setpoint"] == 14
    # predict: spoilage + decision (no verified price -> asks for a quoted price)
    sp = client.get(f"/api/v1/flow/lots/{lot['id']}/spoilage", headers=P).json()
    assert sp["current"]["shelf_life_p10"] <= sp["current"]["shelf_life_p90"] and "at_recommended" in sp
    rates = client.get(f"/api/v1/flow/lots/{lot['id']}/rates", headers=P).json()
    if rates["status"] == "data_unavailable":   # no verified prices stored -> a quoted price is required, never invented
        assert client.get(f"/api/v1/flow/lots/{lot['id']}/decision", headers=P).status_code == 409
    d = client.get(f"/api/v1/flow/lots/{lot['id']}/decision?price_per_kg=22", headers=P).json()
    assert d["recommendation"] in ("sell_now", "store_and_sell_later") and d["price_per_kg"] == 22
    # scan & bag with the bundled reference photos
    g = client.post(f"/api/v1/flow/lots/{lot['id']}/grade-sample", headers=P)
    assert g.status_code == 201, g.text
    gr = g.json()
    assert sum(gr["counts"].values()) == gr["objects"] and gr["processed_kg"] == 0
    assert abs(sum(gr["kg"].values()) - gr["total_kg"]) < 1.0
    bagged = step(P, lot["id"], gr["total_kg"] / 1500 * 3600 + 60)
    assert bagged["stage"] == "graded" and bagged["grading"]["bags_filled"] == bagged["grading"]["bags"]
    grade = next(k for k in ("A1", "A2", "A3") if bagged["grading"]["kg"][k] > 0)
    # dispatch one grade
    r = client.post(f"/api/v1/flow/lots/{lot['id']}/dispatch", headers=P, json={"grade": grade, "destination_name": "Bengaluru APMC", "lat": BLR[0], "lng": BLR[1]})
    assert r.status_code == 201, r.text
    sh = r.json()["shipments"][0]
    assert sh["grade"] == grade and sh["status"] == "in_transit" and len(sh["checkpoints"]) == 5 and sh["live"]["refrigerated"] is True
    assert client.post(f"/api/v1/flow/lots/{lot['id']}/dispatch", headers=P, json={"grade": grade, "destination_name": "Mysuru APMC", "lat": BLR[0], "lng": BLR[1]}).status_code == 409
    total_km = sh["live"]["total_km"]
    # drive past the first checkpoint
    s1 = step(P, lot["id"], (total_km / 6 + 2) / 50 * 3600)
    sh1 = s1["shipments"][0]
    assert sh1["checkpoints"][0]["passed"] and not sh1["checkpoints"][-1]["passed"]
    assert any(e["kind"] == "checkpoint" for e in s1["events"])
    pose = sh1["live"]["pose"]
    assert 12.9 < pose[0] < 13.2 and 77.5 < pose[1] < 78.2
    # road blocked -> alternative road from the current position
    rr = client.post(f"/api/v1/flow/shipments/{sh['id']}/scenario", headers=P, json={"scenario": "road_blocked"})
    assert rr.status_code == 200, rr.text
    info = rr.json()["rerouted"]
    assert info["new_remaining_km"] > 0 and info["added_km"] > 0
    geo = client.get(f"/api/v1/flow/shipments/{sh['id']}", headers=P).json()
    assert len(geo["reroutes"]) == 1 and geo["current"][0] != geo["original"][0]
    assert sum(c["passed"] for c in geo["checkpoints"]) >= 1 and len(geo["checkpoints"]) == 5
    # refrigeration scenario on the truck
    assert client.post(f"/api/v1/flow/shipments/{sh['id']}/scenario", headers=P, json={"scenario": "refrigeration_failure"}).status_code == 200
    # drive to the mandi, unload, deliver
    for _ in range(12):
        s = step(P, lot["id"], 6 * 3600)
        if s["shipments"][0]["status"] == "delivered":
            break
    assert s["shipments"][0]["status"] == "delivered"
    kinds = [e["kind"] for e in s["events"]]
    assert "arrived" in kinds and "delivered" in kinds and "rerouted" in kinds
    assert s["stage"] == "graded"   # other grades are still waiting in the godown
    # the station payload carries everything the laptop needs
    st = client.get(f"/api/v1/flow/stations/{sid}/state", headers=H).json()
    assert st["lots"][0]["id"] == lot["id"]


def test_traditional_lot_open_truck_and_rules(H):
    _, P = pair(H)
    assert client.post("/api/v1/flow/lots", headers=P, json={"commodity": "onion", "quantity_kg": 500, "mode": "traditional", "lat": KOLAR[0],
                                                             "lng": KOLAR[1], "location_name": "Kolar"}).status_code == 422
    lot = client.post("/api/v1/flow/lots", headers=P, json={"commodity": "banana", "quantity_kg": 400, "mode": "traditional", "lat": KOLAR[0],
                                                            "lng": KOLAR[1], "location_name": "Kolar", "speed": 600}).json()
    assert client.post(f"/api/v1/flow/lots/{lot['id']}/grade-sample", headers=P).status_code == 409   # scan & bag is advanced-only
    s = step(P, lot["id"], 1200)
    assert s["stage"] == "storage" and s["storage"]["equipment"]["setpoint"] is None
    r = client.post(f"/api/v1/flow/lots/{lot['id']}/dispatch", headers=P, json={"destination_name": "Bengaluru APMC", "lat": BLR[0], "lng": BLR[1]})
    assert r.status_code == 201, r.text
    j = r.json()
    assert j["stage"] == "dispatched" and j["shipments"][0]["grade"] == "ALL" and j["shipments"][0]["live"]["refrigerated"] is False
    step(P, lot["id"], 1800)
    with SessionLocal() as db:
        assert db.query(Alert).filter(Alert.simulation_id == j["shipments"][0]["sim_id"], Alert.code == "COOLING_FAILURE").count() == 0
    # pause + slow speed
    assert client.post(f"/api/v1/flow/lots/{lot['id']}/pause", headers=P, json={"paused": True}).json()["paused"] is True
    assert client.post(f"/api/v1/flow/lots/{lot['id']}/speed", headers=P, json={"speed": 1}).json()["speed"] == 1


def test_assistant_reports_unavailable_without_key(H):
    _, P = pair(H)
    r = client.post("/api/v1/flow/chat", headers=P, json={"message": "How long will my tomatoes last?", "language": "kn"})
    assert r.status_code == 503 and "unavailable" in r.json()["detail"]["message"].lower()


def test_groq_key_rotation(monkeypatch):
    calls = []

    class R:
        def __init__(self, code):
            self.status_code, self.headers = code, {"content-type": "application/json"}

        def json(self):
            return {"choices": [{"message": {"content": "ok"}}]}

    def post(url, json=None, headers=None, timeout=None):
        calls.append(headers["Authorization"])
        return R(429 if headers["Authorization"].endswith("k1") else 200)

    monkeypatch.setattr(settings, "groq_api_key", "k1")
    monkeypatch.setenv("GROQ_API_KEY_2", "k2")
    monkeypatch.setattr(groq_ai.httpx, "post", post)
    monkeypatch.setattr(time, "sleep", lambda s: None)
    groq_ai._next_key[0] = 0
    assert groq_ai._chat([{"role": "user", "content": "hi"}], json_mode=False) == "ok"
    assert calls == ["Bearer k1", "Bearer k2"]


TOWNS = {"Kolar": KOLAR, "Bengaluru": BLR, "Chik Ballapur": (13.4355, 77.7315), "Chintamani": (13.4000, 78.0560)}


def _geocode(q, count=6):
    name = next((k for k in TOWNS if q.startswith(k)), "Kolar")
    lat, lng = TOWNS[name]
    return [{"name": name, "admin1": "Karnataka", "country": "India", "lat": lat, "lng": lng, "elevation": 800}]


def test_virtual_scan_precooling_and_auto_control(H, monkeypatch):
    monkeypatch.setattr(weather, "geocode", _geocode)
    _, P = pair(H)
    lot = client.post("/api/v1/flow/lots", headers=P, json={"commodity": "mango", "quantity_kg": 1500, "mode": "advanced", "lat": KOLAR[0],
                                                            "lng": KOLAR[1], "location_name": "Kolar", "speed": 600}).json()
    kinds = [e["kind"] for e in lot["events"]]
    assert "precooling" in kinds                       # crates arrive warm, chamber pulls down
    t0 = lot["storage"]["readings"]["temperature_c"]
    assert t0 > lot["storage"]["setpoint"] + 1
    s = step(P, lot["id"], 3 * 3600)
    assert s["storage"]["readings"]["temperature_c"] < t0
    for _ in range(6):
        s = step(P, lot["id"], 6 * 3600)
        if any(e["kind"] == "target_reached" for e in s["events"]):
            break
    assert any(e["kind"] == "target_reached" for e in s["events"])
    # cooling failure -> automatic backup cooling is notified
    client.post(f"/api/v1/flow/lots/{lot['id']}/scenario", headers=P, json={"scenario": "cooling_failure"})
    s = step(P, lot["id"], 1800)
    assert any(e["kind"].startswith("auto_") for e in s["events"]), [e["kind"] for e in s["events"]]
    # no photo upload: the simulated scanner grades from the twin
    r = client.post(f"/api/v1/flow/lots/{lot['id']}/scan", headers=P)
    assert r.status_code == 201, r.text
    g = r.json()
    assert g["method"] == "virtual_scan" and abs(sum(g["shares"].values()) - 1) < 1e-6
    assert g["thresholds"]["A1"] > g["thresholds"]["A2"] > g["thresholds"]["A3"]
    assert sum(g["bags"].values()) > 0 and g["bag_kg"] == 20


def test_traditional_lot_cannot_be_scanned(H):
    _, P = pair(H)
    lot = client.post("/api/v1/flow/lots", headers=P, json={"commodity": "potato", "quantity_kg": 500, "mode": "traditional", "lat": KOLAR[0],
                                                            "lng": KOLAR[1], "location_name": "Kolar", "speed": 600}).json()
    step(P, lot["id"], 1200)
    assert client.post(f"/api/v1/flow/lots/{lot['id']}/scan", headers=P).status_code == 409


@pytest.mark.parametrize("name", ["monsoon_tomato", "heatwave_banana"])
def test_sample_situations_play_to_the_end(H, monkeypatch, name):
    monkeypatch.setattr(weather, "geocode", _geocode)
    from app.services import flow as flow_svc
    flow_svc._geo_cache.clear()
    sid, P = pair(H)
    assert name in [x["name"] for x in client.get("/api/v1/flow/scripts", headers=P).json()["scripts"]]
    lot = client.post(f"/api/v1/flow/scripts/{name}", headers=P, json={}).json()
    assert lot["script"]["step"] == 0
    for _ in range(400):   # 15-minute steps, like a few seconds of real play at 300x
        s = step(P, lot["id"], 900)
        if s["script"]["done"]:
            break
    assert s["script"]["done"], s["script"]
    titles = [e["title"] for e in s["events"]]
    assert not any(t == "Step skipped" for t in titles), [e["message"] for e in s["events"] if e["title"] == "Step skipped"]
    assert any(e["kind"] == "rerouted" for e in s["events"]) and any(e["kind"] == "dispatched" for e in s["events"])
    if name == "monsoon_tomato":
        assert {sh["grade"] for sh in s["shipments"]} == {"A1", "A2", "A3"}
    else:
        assert s["shipments"][0]["grade"] == "ALL" and s["shipments"][0]["live"]["refrigerated"] is False


def test_advanced_dispatch_scans_first_and_fixes_need_approval(H, monkeypatch):
    monkeypatch.setattr(weather, "geocode", _geocode)
    from app.services import flow as flow_svc
    flow_svc._geo_cache.clear()
    _, P = pair(H)
    lot = client.post("/api/v1/flow/lots", headers=P, json={"commodity": "grapes", "quantity_kg": 800, "mode": "advanced", "lat": KOLAR[0],
                                                            "lng": KOLAR[1], "location_name": "Kolar", "speed": 600}).json()
    step(P, lot["id"], 1800)
    # cooling failure -> alert with fixes offered to the farmer
    client.post(f"/api/v1/flow/lots/{lot['id']}/scenario", headers=P, json={"scenario": "cooling_failure"})
    s = step(P, lot["id"], 1200)
    fixes = s["pending_fixes"]
    assert any(f["action"] == "restore_cooling" for f in fixes), fixes
    ev = next(e for e in reversed(s["events"]) if e["kind"] == "cooling_failure")
    assert ev["fixes"]
    fid = next(f["id"] for f in fixes if f["action"] == "restore_cooling")
    r = client.post(f"/api/v1/flow/lots/{lot['id']}/fixes/{fid}/approve", headers=P)
    assert r.status_code == 200, r.text
    after = r.json()["lot"]
    assert after["storage"]["equipment"]["cooling_failed"] is False and "cooling_failure" not in after["storage"]["faults"]
    assert any(e["kind"] == "fix_applied" for e in after["events"])
    # dispatching an advanced lot from the godown scans and sorts first, then ships each grade automatically
    r = client.post(f"/api/v1/flow/lots/{lot['id']}/dispatch", headers=P, json={"destination_name": "Bengaluru APMC", "lat": BLR[0], "lng": BLR[1]})
    assert r.status_code == 201, r.text
    j = r.json()
    assert j["stage"] == "grading" and not j["shipments"] and j["grading"]["pending_dispatch"]["A1"]["name"] == "Bengaluru APMC"
    s = step(P, lot["id"], j["grading"]["total_kg"] / 1500 * 3600 + 120)
    assert s["stage"] in ("graded", "dispatched") and s["shipments"]
    assert {sh["grade"] for sh in s["shipments"]} <= {"A1", "A2", "A3"} and all(sh["live"]["refrigerated"] for sh in s["shipments"])
