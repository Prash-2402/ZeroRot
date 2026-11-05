"""Engine and decision tests (brief section 18, tests 1-12g)."""
import math
from datetime import date, datetime, timedelta

import numpy as np
import pytest

from app.engine.conditions import Segment, cached_weather
from app.engine.confidence import Reading, clean_readings, compute_confidence
from app.engine.decay import State, crossing_hours, make_params, simulate
from app.engine.decision import INSUFFICIENT, DecisionInput, decide
from app.engine.geo import locations
from app.engine.ghost import compare
from app.engine.market_shift import choice_difference, plan_market_shift
from app.engine.plans import Plan
from app.engine.registry import get_produce
from app.engine.validation import validate_batch
from app.engine.value import PricePoint, comparable_series, price_scenarios, value_breakdown

NOW = datetime(2026, 11, 5, 6, 0)
TOM = get_produce("tomato")


def run(produce, temps, rhs, maturity="mature_green", q0=100.0):
    p = get_produce(produce)
    prm = make_params(p, maturity)
    return simulate(prm, State(q=q0), temps, rhs)


def series(n_days, t, rh):
    return np.full(n_days * 24, t), np.full(n_days * 24, rh)


# 1
def test_quality_monotonic_constant_conditions():
    Q, *_ = run("tomato", *series(14, 20.0, 92.0))
    assert np.all(np.diff(Q[0]) <= 0)
    assert Q[0, -1] < Q[0, 0]


# 2
def test_higher_temperature_faster_decay():
    for prod in ("tomato", "mango", "banana"):
        q20 = run(prod, *series(5, 20.0, 92.0))[0][0, -1]
        q28 = run(prod, *series(5, 28.0, 92.0))[0][0, -1]
        assert q28 < q20, prod


# 3
@pytest.mark.parametrize("prod,cold,threshold,days", [("tomato", 4.0, 10.0, 14), ("banana", 10.0, 13.0, 7)])
def test_chilling_increases_deterioration(prod, cold, threshold, days):
    q_cold = run(prod, *series(days, cold, 92.0))[0][0, -1]
    q_thr = run(prod, *series(days, threshold, 92.0))[0][0, -1]
    assert q_cold < q_thr


# 4
def test_humidity_outside_range_increases_decay():
    q_ok = run("tomato", *series(5, 20.0, 92.0))[0][0, -1]
    q_dry = run("tomato", *series(5, 20.0, 60.0))[0][0, -1]
    q_wet = run("tomato", *series(5, 20.0, 100.0))[0][0, -1]
    assert q_dry < q_ok and q_wet < q_ok


# 5
def test_temperature_spike_changes_trajectory():
    smooth = np.full(72, 18.0)
    spiky = smooth.copy()
    spiky[24:30] = 34.0
    rh = np.full(72, 92.0)
    q_s = run("tomato", smooth, rh)[0][0]
    q_k = run("tomato", spiky, rh)[0][0]
    assert q_k[-1] < q_s[-1] - 0.5
    assert np.allclose(q_k[:25], q_s[:25])


# 6
def test_invalid_inputs_rejected():
    base = dict(produce="tomato", quantity_kg=500, harvest_time=NOW - timedelta(days=1), now=NOW)
    assert validate_batch(**base) == []
    assert validate_batch(**{**base, "quantity_kg": -5})
    assert validate_batch(**{**base, "humidity": 120})
    assert validate_batch(**{**base, "harvest_time": NOW + timedelta(hours=2)})
    assert validate_batch(**{**base, "storage_start": NOW - timedelta(days=3)})
    assert validate_batch(**{**base, "produce": "durian"})


def _conf(readings, known=None, weather=True, harvest=None):
    known = known if known is not None else {"maturity": True, "initial_quality": True, "variety": True, "harvest_time": True}
    return compute_confidence(readings, harvest or NOW - timedelta(days=5, hours=1), NOW, weather_available=weather,
                              known=known, parameter_quality=0.5, applicability=1.0)


def hourly(n, start, origin="manual", rh=92.0, step=timedelta(hours=1)):
    return [Reading(start + i * step, 12.5, rh, origin) for i in range(n)]


# 7
def test_missing_maturity_or_humidity_lowers_confidence():
    rs = hourly(48, NOW - timedelta(hours=47))
    full = _conf(rs)["score"]
    no_mat = _conf(rs, known={"maturity": False, "initial_quality": True, "variety": True, "harvest_time": True})["score"]
    no_rh = _conf(hourly(48, NOW - timedelta(hours=47), rh=None))["score"]
    assert no_mat < full and no_rh < full


# 8
def test_coverage_beats_burst():
    spread = hourly(50, NOW - timedelta(days=5), step=timedelta(hours=120 / 49))
    burst = hourly(50, NOW - timedelta(minutes=1), step=timedelta(seconds=1.2))
    assert _conf(spread)["score"] > _conf(burst)["score"]


# 9
def test_readings_sorted_and_deduplicated():
    t0 = NOW - timedelta(hours=10)
    rs = [Reading(t0 + timedelta(hours=h), 12.0, 90, "manual") for h in (5, 1, 3, 3, 2)]
    rs.append(Reading(NOW - timedelta(days=30), 12, 90, "manual"))  # before harvest
    rs.append(Reading(t0, 12, 140, "manual"))  # impossible RH
    clean, excluded = clean_readings(rs, NOW - timedelta(days=2), NOW)
    assert [r.ts for r in clean] == sorted({t0 + timedelta(hours=h) for h in (1, 2, 3, 5)})
    assert excluded == 3


def _prices():
    loc = locations()
    out = {}
    for i, m in enumerate(loc["mandis"]):
        s = [PricePoint(date(2026, 9, 1) + timedelta(days=d), 20 + i + math.sin(d / 3)) for d in range(60)]
        out[m["id"]] = price_scenarios(s, 14)
    return out, loc


def _dinput(q=92.0, maturity="mature_green", conf=None, **kw):
    prices, loc = _prices()
    storages = [{**s, "accepts": ["tomato", "mango", "banana"], "used_t": 0} for s in loc["cold_storages"]]
    return DecisionInput(produce="tomato", maturity=maturity, mass_kg=500, state=State(q=q), start=NOW, origin="kolar",
                         origin_weather_point="kolar", prices=prices, mandis=loc["mandis"], storages=storages,
                         confidence=conf or {"category": "MEDIUM", "score": 60}, **kw)


# 10
def test_infeasible_ship_rejected_with_reason():
    d = decide(_dinput(q=47.0, maturity="ripe", transit_temp=32.0), cached_weather())
    hub = [r for r in d["rejected"] if r["key"] == "SHIP_m_hubballi"]
    assert hub and ("shelf life" in hub[0]["reason"] or "quality" in hub[0]["reason"])


# 11
def test_insufficient_data_response():
    d = decide(_dinput(conf={"category": "INSUFFICIENT", "score": 20}), cached_weather())
    assert d["action"] == "INSUFFICIENT_DATA" and d["message"] == INSUFFICIENT


def test_decision_has_explanation_and_alternatives():
    d = decide(_dinput(), cached_weather())
    assert d["action"] in ("SELL", "STORE", "SHIP")
    assert d["explanation"] and d["alternatives"]


# 12
def test_market_shift_recommends_highest_net_and_records_choice():
    loc = locations()
    market = loc["mandis"][0]
    s = [PricePoint(date(2026, 9, 1) + timedelta(days=d), 20 + math.sin(d / 3)) for d in range(60)]
    def storage(hours, rh_shift):
        return [Segment("setpoint", hours, t=12.5, rh=92)]
    plan = plan_market_shift(produce="tomato", maturity="mature_green", mass_kg=500, state=State(q=95), start=NOW,
                             storage_segments=storage, rent_per_kg_day=0.45, origin="kolar", origin_weather_point="kolar",
                             market=market, series=s, condition="festival", weather=cached_weather(), price_source="t", price_origin="simulated")
    best = max(plan["periods"], key=lambda x: x["net"])
    assert plan["recommended"] == best["key"]
    other = next(x for x in plan["periods"] if not x["recommended"])
    ch = choice_difference(plan, other["key"])
    assert ch["difference"] < 0 and "less than recommended" in ch["message"]
    crash = plan_market_shift(produce="tomato", maturity="mature_green", mass_kg=500, state=State(q=95), start=NOW,
                              storage_segments=storage, rent_per_kg_day=0.45, origin="kolar", origin_weather_point="kolar",
                              market=market, series=s, condition="price_crash", weather=cached_weather(), price_source="t", price_origin="simulated")
    assert crash["recommended"] == "DAY_0"
    assert plan["recommended"] != crash["recommended"]


# 12a
def test_confidence_reference_and_source_drop():
    rs = hourly(49, NOW - timedelta(hours=48))
    c = compute_confidence(rs, NOW - timedelta(hours=50), NOW, weather_available=True,
                           known={"maturity": 1, "initial_quality": 1, "variety": 1, "harvest_time": 1},
                           parameter_quality=0.5, applicability=1.0)
    expected = 100 * (0.2 * 0.96 + 0.1 * (1 - 1 / 48) + 0.1 * 1 + 0.15 * 1 + 0.15 * 1 + 0.2 * 0.5 + 0.1 * 1)
    assert c["score"] == pytest.approx(expected, abs=0.1)
    w = compute_confidence([], NOW - timedelta(hours=50), NOW, weather_available=True,
                           known={"maturity": 1, "initial_quality": 1, "variety": 1, "harvest_time": 1},
                           parameter_quality=0.5, applicability=1.0)
    assert w["score"] == pytest.approx(42.5, abs=0.1) and w["score"] < c["score"]
    assert "regional weather" in w["text"]


# 12b
def test_value_protected_is_difference_and_not_positive_when_worse():
    prices, _ = _prices()
    p = get_produce("tomato")
    hot = Plan("CONTINUE", "CONTINUE", "Continue", [Segment("constant", 10, t=34, rh=95)], 10, "m_hubballi", "Hubballi APMC", 15000)
    cool = Plan("REROUTE", "REROUTE", "Reroute", [Segment("constant", 2, t=30, rh=95), Segment("setpoint", 8, t=12.5, rh=92)], 10,
                "m_chitradurga", "Chitradurga APMC", 9000, rent=500)
    s0 = State(q=88)
    good = compare("tomato", "turning", 6000, s0, NOW, hot, cool, prices, cached_weather())
    assert good["value_protected"] == good["reroute"]["net"] - good["ghost"]["net"]
    bad = compare("tomato", "turning", 6000, s0, NOW, cool, hot, prices, cached_weather())
    assert bad["value_protected"] <= 0 and not bad["reroute_better"] and bad["message"]


# 12c
def test_short_history_uses_assumed_band():
    s = [PricePoint(date(2026, 10, 20) + timedelta(days=d), 20.0) for d in range(8)]
    sc = price_scenarios(s, 7)
    assert sc["method"] == "assumed_band"
    assert sc["low"][3] == pytest.approx(17.0) and sc["high"][3] == pytest.approx(23.0)
    assert "engineering assumption" in sc["label"]


# 12d
@pytest.mark.parametrize("prod", ["tomato", "mango", "banana"])
def test_k_ref_reproduces_storage_life(prod):
    p = get_produce(prod)
    L = p.v("storage_life")
    temps, rhs = series(int(L) + 5, p.v("t_ref"), (p.v("rh_low") + p.v("rh_high")) / 2)
    Q, *_ = run(prod, temps, rhs, q0=100.0)
    h = crossing_hours(Q, p.v("q_min"))[0]
    assert h / 24 == pytest.approx(L, rel=0.01)


# 12e
def test_confidence_edge_cases():
    harvest = NOW - timedelta(days=2)
    z = _conf([], harvest=harvest)
    assert z["factors"]["C"] == 0 and z["factors"]["D"] == 0 and z["factors"]["F"] == 0
    one = _conf([Reading(NOW - timedelta(minutes=10), 12, 90, "manual")], harvest=harvest)
    assert one["factors"]["C"] == 0 and one["factors"]["D"] == 0 and one["factors"]["F"] == 1
    same = _conf([Reading(NOW - timedelta(hours=2), 12, 90, "manual")] * 3, harvest=harvest)
    assert same["factors"]["C"] == 0 and not math.isnan(same["score"])
    with pytest.raises(ValueError):
        compute_confidence([], NOW + timedelta(hours=1), NOW, weather_available=True, known={}, parameter_quality=0.5, applicability=1)
    sim = compute_confidence(hourly(120, NOW - timedelta(hours=119), origin="simulated"), NOW - timedelta(hours=120), NOW,
                             weather_available=True, known={"maturity": 1, "initial_quality": 1, "variety": 1, "harvest_time": 1},
                             parameter_quality=1.0, applicability=1.0)
    assert sim["score"] <= 74 and sim["category"] == "MEDIUM" and sim["capped_simulated"]


# 12f
def test_value_breakdown_sums_exactly():
    bd = value_breakdown(500, 22.0, 92.0, 0.01, 0.0, 19.5, 63.0, 0.05, 0.12)
    parts = bd["quality_grade"] + bd["weight_loss"] + bd["rejected_units"] + bd["market_price"]
    assert parts == pytest.approx(bd["total_loss"], abs=1e-6)
    assert bd["start_value"] - bd["end_value"] == pytest.approx(bd["total_loss"])


# 12g
def test_comparable_series_filters_and_counts():
    recs = []
    for d in range(20):
        day = date(2026, 10, 1) + timedelta(days=d)
        recs.append({"commodity": "tomato", "mandi_id": "m_kolar", "date": day, "modal_price": 2000 + d * 10, "unit": "Rs/quintal"})
        recs.append({"commodity": "tomato", "mandi_id": "m_bengaluru", "date": day, "modal_price": 9999, "unit": "Rs/quintal"})
        recs.append({"commodity": "mango", "mandi_id": "m_kolar", "date": day, "modal_price": 5000, "unit": "Rs/quintal"})
    s = comparable_series(recs, "tomato", "m_kolar")
    assert len(s) == 20 and s[0].price_per_kg == pytest.approx(20.0)
    sc = price_scenarios(s, 7)
    assert sc["n_points"] == 19 and sc["method"] == "historical_percentiles"
