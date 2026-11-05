"""Idempotent seed: drops and recreates all tables with the deterministic DEMO start state.
Run: python -m app.db.seed   (from backend/)"""
from __future__ import annotations

import hashlib
import math
import time
from datetime import datetime, timedelta

import numpy as np

from app.core.config import DEMO_EPOCH, settings
from app.db.models import (AppState, Base, Batch, Facility, Farmer, MarketPrice, ProduceParameter, ProduceType, Reading,
                           Scenario, StorageRecord, Trip)
from app.db.session import SessionLocal, engine
from app.engine import geo
from app.engine.conditions import Segment, build_series, cached_weather
from app.engine.decay import State, make_params, simulate
from app.engine.registry import load_registry
from app.simulation.transport import lane_route, position

PRICE_SOURCE = "SIMULATED seed prices (data.gov.in Agmarknet key not configured)"
BASE_PRICE = {  # Rs/kg reference levels for the simulated series (not observed data)
    "tomato": {"m_kolar": 17, "m_bengaluru": 23, "m_mysuru": 21, "m_tumakuru": 19, "m_chikkaballapur": 18, "m_hubballi": 27,
               "m_davanagere": 24, "m_belagavi": 28, "m_mangaluru": 29, "m_chitradurga": 22},
    "mango": {"m_kolar": 52, "m_bengaluru": 64, "m_mysuru": 60, "m_tumakuru": 55, "m_chikkaballapur": 53, "m_hubballi": 66,
              "m_davanagere": 58, "m_belagavi": 68, "m_mangaluru": 70, "m_chitradurga": 57},
    "banana": {"m_kolar": 26, "m_bengaluru": 32, "m_mysuru": 27, "m_tumakuru": 25, "m_chikkaballapur": 27, "m_hubballi": 33,
               "m_davanagere": 28, "m_belagavi": 34, "m_mangaluru": 31, "m_chitradurga": 27},
}
VOL = {"tomato": 0.07, "mango": 0.03, "banana": 0.025}
FARMERS = [("F01", "Ramesh Gowda", "kolar"), ("F02", "Lakshmamma", "chikkaballapur"), ("F03", "Manjunath K", "tumakuru"),
           ("F04", "Shivanna", "mandya"), ("F05", "Savitha R", "mysuru"), ("F06", "Basavaraj Patil", "dharwad"),
           ("F07", "Nagaraj H", "chitradurga"), ("F08", "Mallikarjun", "belagavi"), ("F09", "Kavya S", "ramanagara"),
           ("F10", "Ravi Kumar", "hassan"), ("F11", "Girish D", "davanagere"), ("F12", "Prema", "haveri"),
           ("FPO", "Kolar Tomato Growers (demo FPO)", "kolar")]
CODE = {"tomato": "TOM", "mango": "MAN", "banana": "BAN"}
STORAGE_ACCEPTS = {"cs_malur": ["tomato", "mango"]}


def token(batch_id: str) -> str:
    return hashlib.sha256(f"zerorot-passport-{batch_id}".encode()).hexdigest()[:20]


def seed_prices(db, rng):
    rows = []
    retrieved = DEMO_EPOCH - timedelta(hours=2)
    for commodity, levels in BASE_PRICE.items():
        for mid, base in levels.items():
            x = math.log(base)
            mu = math.log(base)
            for d in range(60, 0, -1):
                day = (DEMO_EPOCH - timedelta(days=d)).replace(hour=0, minute=0)
                x = x + 0.2 * (mu - x) + rng.normal(0, VOL[commodity])
                modal = round(math.exp(x) * 100)
                if rng.random() < 0.08 and d > 1:
                    continue  # mandis do not report every day
                rows.append(MarketPrice(commodity=commodity, mandi_id=mid, variety="All varieties", date=day,
                                        min_price=round(modal * 0.85), max_price=round(modal * 1.12), modal_price=modal,
                                        unit="Rs/quintal", arrivals_t=round(float(rng.uniform(20, 180)), 1),
                                        origin="simulated", source=PRICE_SOURCE, retrieved_at=retrieved))
    db.add_all(rows)


def integrate(produce, maturity, q0, segments, start):
    p = load_registry()[produce]
    T, RH = build_series(segments, start, cached_weather())
    prm = make_params(p, maturity)
    Q, W, R, E = simulate(prm, State(q=q0), T, RH)
    return State(q=float(Q[0, -1]), w=float(W[0, -1]), r=float(R[0, -1]), e=float(E[0, -1])), T, RH


def seed(db=None):
    t0 = time.time()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    own = db is None
    db = db or SessionLocal()
    rng = np.random.default_rng(20261105)
    now = DEMO_EPOCH
    db.add_all([AppState(key="sim_now", value={"t": now.isoformat()}),
                AppState(key="mode", value={"mode": settings.app_mode if settings.app_mode in ("demo", "real") else "demo"}),
                AppState(key="sim_speed", value={"minutes_per_tick": settings.sim_minutes_per_tick, "paused": False}),
                AppState(key="market_condition", value={"condition": "normal", "mandi_id": None})])
    reg = load_registry()
    for name, p in reg.items():
        db.add(ProduceType(id=name, display_name=p.display_name, kannada=p.kannada, version=p.version, meta=p.meta))
        for k, rec in p.params.items():
            db.add(ProduceParameter(id=rec["id"], produce=name, version=p.version, classification=rec["classification"], data=rec))
    loc = geo.locations()
    for m in loc["mandis"]:
        db.add(Facility(id=m["id"], type="mandi", name=m["name"], district=m["district"], lat=m["lat"], lng=m["lng"],
                        accepts=list(reg), origin="simulated"))
    for i, c in enumerate(loc["cold_storages"]):
        db.add(Facility(id=c["id"], type="cold_storage", name=c["name"], district=c["district"], lat=c["lat"], lng=c["lng"],
                        accepts=STORAGE_ACCEPTS.get(c["id"], list(reg)), capacity_t=c["capacity_t"],
                        used_t=round(c["capacity_t"] * (0.45 + 0.07 * i)), rent_per_kg_day=c["rent_per_kg_day"], origin="simulated"))
    for fid, name, dist in FARMERS:
        db.add(Farmer(id=fid, name=name, district=dist, origin="simulated"))
    db.add(Farmer(id="JUDGE", name="Judge farmer", district="kolar", origin="manual"))
    seed_prices(db, rng)
    db.flush()

    readings = []
    pts = geo.points()
    kolar = pts["kolar"]
    # ---- one farmer, three batches (farmer-centric demo) ----
    # (batch id, produce, kg, place, storage, facility, maturity, initial quality, hours since harvest, hours in cold store)
    farm = [
        ("ZR-TOM-001", "tomato", 500, "shed", "open_shed", None, "mature_green", 95.0, 6, 0),
        ("ZR-MAN-001", "mango", 1800, "cold", "cold_storage", "cs_malur", "mature_green", 96.0, 30, 24),
        ("ZR-BAN-001", "banana", 6000, "yard", "open_shed", None, "turning", 94.0, 8, 0),
    ]
    for bid, produce, mass, place, stype, fac, maturity, q0, age_h, store_h in farm:
        p = reg[produce]
        harvest = now - timedelta(hours=age_h)
        rh_mid = (p.v("rh_low") + p.v("rh_high")) / 2
        if stype == "cold_storage":
            segs = [Segment("weather", age_h - store_h, point="kolar"), Segment("setpoint", store_h, t=p.v("t_ref"), rh=rh_mid)]
        else:
            segs = [Segment("weather", age_h, point="kolar")]
        st, _, _ = integrate(produce, maturity, q0, segs, harvest)
        db.add(Batch(id=bid, farmer_id="F01", produce=produce, variety=p.meta["varieties"][0], quantity_kg=mass, harvest_time=harvest,
                     maturity=maturity, initial_quality=q0, district="kolar", lat=kolar["lat"], lng=kolar["lng"], storage_type=stype,
                     facility_id=fac, status="stored", q=st.q, w=st.w, r=st.r, e=st.e, state_at=now, passport_token=token(bid),
                     lane_id="S2" if place == "yard" else None, origin="simulated", mode="demo"))
        if stype == "cold_storage":
            s_start = now - timedelta(hours=store_h)
            db.add(StorageRecord(batch_id=bid, storage_type="open_shed", label="Farm shed, Kolar", start=harvest, end=s_start))
            db.add(StorageRecord(batch_id=bid, facility_id=fac, storage_type="cold_storage", label=pts[fac]["name"], start=s_start))
            for k in range(store_h * 2):
                readings.append({"batch_id": bid, "trip_id": None, "ts": s_start + timedelta(minutes=30 * k),
                                 "temp_c": round(p.v("t_ref") + float(rng.normal(0, 0.4)), 2), "rh": round(rh_mid + float(rng.normal(0, 1.5)), 1),
                                 "origin": "simulated"})
        else:
            label = "Loading bay, Kolar farm (waiting for the mandi company truck)" if place == "yard" else "Farm shed, Kolar (conditions estimated from regional weather)"
            db.add(StorageRecord(batch_id=bid, storage_type="open_shed", label=label, start=harvest))
    db.bulk_insert_mappings(Reading, readings)
    db.add_all([
        Scenario(id=1, name="Prediction and decision", description="500 kg tomatoes in the Kolar farm shed: twin, future slider, what-if, Sell / Store / Ship.",
                 expected={"batch_id": "ZR-TOM-001"}),
        Scenario(id=2, name="Reefer failure and rescue", description="6 t bananas handed to the mandi company's reefer truck, Kolar -> Hubballi APMC. Simulate a breakdown, approve the reroute, see value protected.",
                 expected={"trip_id": "TRIP-S2", "batch_id": "ZR-BAN-001"}),
        Scenario(id=3, name="Market shift", description="Price crash at Kolar APMC. When should the farmer sell the mangoes in the cold store? Switch to Festival demand and see it flip.",
                 expected={"batch_id": "ZR-MAN-001", "mandi_id": "m_kolar"}),
    ])
    db.commit()
    from app.simulation.loop import refresh_status
    refresh_status(db)
    db.commit()
    from app.domain import clear_price_cache
    clear_price_cache()
    if own:
        db.close()
    return round(time.time() - t0, 2)


if __name__ == "__main__":
    print("seeded in", seed(), "s")
