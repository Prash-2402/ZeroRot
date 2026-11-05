"""Build the versioned parameter registry (data/parameters/*.json) and docs/parameter_audit.md.

Every derived coefficient is computed here from the published figure so the working is reproducible.
Run: python backend/scripts/build_registry.py
"""
import json
import math
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "parameters"
DOCS = ROOT / "docs"
VERSION = "1.0.0"
REVIEWED = "2026-11-05"
Q0, QMIN = 100.0, 40.0

UCD = {
    "tomato": {"title": "Tomato: Recommendations for Maintaining Postharvest Quality (Produce Fact Sheet)",
               "publisher": "UC Davis Postharvest Research and Extension Center; T.V. Suslow & M. Cantwell", "year": 1997,
               "url": "https://postharvest.ucdavis.edu/produce-facts-sheets/tomato"},
    "banana": {"title": "Banana (Cavendish): Recommendations for Maintaining Postharvest Quality (Produce Fact Sheet)",
               "publisher": "UC Davis Postharvest Research and Extension Center; A.A. Kader", "year": 1996,
               "url": "https://postharvest.ucdavis.edu/produce-facts-sheets/banana"},
    "mango": {"title": "Mango: Recommendations for Maintaining Postharvest Quality (Produce Fact Sheet)",
              "publisher": "UC Davis Postharvest Research and Extension Center; A.A. Kader", "year": 1997,
              "url": "https://postharvest.ucdavis.edu/produce-facts-sheets/mango"},
}
UCD["potato"] = {"title": "Potato (Early Crop): Recommendations for Maintaining Postharvest Quality (Produce Fact Sheet)",
                 "publisher": "UC Davis Postharvest Research and Extension Center; T.V. Suslow & R. Voss", "year": 1998,
                 "url": "https://postharvest.ucdavis.edu/produce-facts-sheets/potato"}
UCD["onion"] = {"title": "Onions (Dry): Recommendations for Maintaining Postharvest Quality (Produce Fact Sheet)",
                "publisher": "UC Davis Postharvest Research and Extension Center; T.V. Suslow", "year": 1996,
                "url": "https://postharvest.ucdavis.edu/produce-facts-sheets/onions-dry"}
NONE_SRC = {"title": "ZERO ROT engineering assumption (no published source)", "publisher": "ZERO ROT team", "year": 2026, "url": None}

CLASS = {
    "experimental": "Published experimental parameter",
    "operating_range": "Published recommended operating range",
    "derived": "Derived parameter",
    "calibrated": "Calibrated demonstration assumption",
    "assumption": "Engineering assumption",
    "demo": "Unvalidated demo parameter",
}


def k_from_life(L):
    return math.log(Q0 / QMIN) / L


def q10(r1, t1, r2, t2):
    return (r2 / r1) ** (10.0 / (t2 - t1))


def p(pid, name, value, unit, cls, src, conditions, applicability, limitations, derivation=None, rng=None):
    return {"id": pid, "name": name, "value": value, "range": rng, "unit": unit, "classification": cls,
            "classification_label": CLASS[cls], "source": src, "conditions": conditions,
            "applicability": applicability, "limitations": limitations, "derivation": derivation, "last_reviewed": REVIEWED}


def shared_assumptions(prod, kw, rh_lo_slope=0.008, rh_hi_slope=0.08, gamma=1.5):
    return [
        p(f"{prod}.h_low_slope", "Humidity penalty slope below recommended RH", rh_lo_slope, "per %RH", "assumption", NONE_SRC,
          "Applied linearly per %RH below the published RH range.", "Any RH below range", "Shape not fitted to data; anchor (range edge) is published, slope is assumed. Kept small because moisture loss itself is tracked separately as weight loss W.",
          "h(RH) = 1 + slope x (RH_low - RH) for RH < RH_low", [rh_lo_slope * 0.7, rh_lo_slope * 1.3]),
        p(f"{prod}.h_high_slope", "Humidity penalty slope above recommended RH (rot / condensation)", rh_hi_slope, "per %RH", "assumption", NONE_SRC,
          "Applied linearly per %RH above the published RH range.", "RH above range", "Shape not fitted to data.",
          "h(RH) = 1 + slope x (RH - RH_high) for RH > RH_high", [rh_hi_slope * 0.7, rh_hi_slope * 1.3]),
        p(f"{prod}.chill_gamma", "Chilling penalty strength", gamma, "dimensionless", "assumption", NONE_SRC,
          "c = 1 + gamma x min(E / E_crit, 3), E = cumulative degree-hours below chilling threshold.", "After any chilling exposure",
          "Penalty shape is assumed; real chilling injury often appears after transfer to warm conditions.", None, [gamma * 0.7, gamma * 1.3]),
        p(f"{prod}.kw", "Weight-loss coefficient (transpiration)", kw, "fraction / day / kPa VPD", "assumption", NONE_SRC,
          "dW/dt = kw x VPD(T, RH) x (1 - W)", "Whole fruit, unpackaged", "Not from a measured transpiration coefficient; order of magnitude only.", None),
        p(f"{prod}.r0", "Rot onset rate below Q_rot", 0.25, "fraction / day", "assumption", NONE_SRC,
          "dR/dt = r0 x max(0, (Q_rot - Q)/Q_rot) x (1 + 0.1 x max(0, RH - RH_high)) + heat and chilling terms", "All conditions",
          "Rejection dynamics assumed; not fitted.", None),
        p(f"{prod}.q_rot", "Quality at which rot rejection begins", 60.0, "quality score", "assumption", NONE_SRC,
          "Rejection starts accumulating when Q falls below this value.", "All conditions", "Assumed threshold.", None),
        p(f"{prod}.r_heat", "Heat-excursion rejection rate", 0.004, "fraction / day / degC above T_ref+12", "assumption", NONE_SRC,
          "Extra rejection while temperature exceeds T_ref + 12 degC.", "Excursions", "Assumed.", None),
        p(f"{prod}.q_min", "Minimum sellable quality", QMIN, "quality score", "demo", NONE_SRC,
          "Quality score below which a unit is unsellable (category Unsellable < 40).", "All", "Scale is a ZERO ROT index, not a grading standard.", None),
        p(f"{prod}.min_arrival_quality", "Minimum market grade on arrival", 55.0, "quality score", "demo", NONE_SRC,
          "Ship/store options must keep quality at or above this value.", "All", "Demo default, configurable.", None),
    ]


def tomato():
    s = UCD["tomato"]
    L = 14.0
    k = k_from_life(L)
    q = q10(11, 15, 22, 25)  # mature-green midpoints 8-14 @15C and 18-26 @25C: the pair covering ambient shed temperatures
    q_lo, q_hi = q, q10(7.5, 10, 17.5, 20)
    k_ripe_85 = k_from_life(9.0)  # firm-ripe 8-10 days at 7-10C
    k_ripe_ref = k_ripe_85 * q ** ((12.5 - 8.5) / 10)
    m_ripe = k_ripe_ref / k
    params = [
        p("tomato.t_ref", "Reference storage temperature (mature-green)", 12.5, "degC", "operating_range", s,
          "Mature Green optimum 12.5-15 degC", "Mature-green fruit", "Light-red 10-12.5 degC and firm-ripe 7-10 degC differ.", None, [12.5, 15.0]),
        p("tomato.rh_low", "Recommended RH lower bound", 90.0, "%", "operating_range", s, "Optimum RH 90-95%", "All stages", "Range, not a kinetic parameter."),
        p("tomato.rh_high", "Recommended RH upper bound", 95.0, "%", "operating_range", s, "Optimum RH 90-95%; prolonged higher RH encourages molds", "All stages", "Range, not a kinetic parameter."),
        p("tomato.storage_life", "Published storage life at T_ref", L, "days", "operating_range", s,
          "Mature-green tomatoes can be stored up to 14 days prior to ripening at 12.5 degC", "Mature-green at 12.5 degC",
          "'Up to 14 days without significant reduction' then ripening; using it as the time to Q_min is conservative.", None, [11.0, 17.0]),
        p("tomato.k_ref", "Reference decay rate k_ref", round(k, 6), "1/day", "calibrated", s,
          "Derived from storage life at 12.5 degC", "Mature-green at T_ref", "Guarantees Q reaches Q_min at day L by construction; does NOT validate curve shape.",
          f"k_ref = ln(Q0/Q_min)/L = ln({Q0:.0f}/{QMIN:.0f})/{L:.0f} = {k:.5f} /day", [k_from_life(17.0), k_from_life(11.0)]),
        p("tomato.q10", "Temperature coefficient Q10", round(q, 3), "dimensionless", "derived", s,
          "Respiration, mature-green ripening: 8-14 mL CO2/kg.h at 15 degC, 18-26 at 25 degC", "5-25 degC (respiration table range)",
          "Assumes quality loss scales with respiration rate. The 15-25 degC pair is used because Indian sheds and trucks mostly operate there.",
          f"Q10 = (22/11)^(10/(25-15)) = {q:.3f} (midpoints); the 10-20 degC pair gives {q_hi:.2f} (upper end of range)",
          [round(q_lo, 3), round(q_hi, 3)]),
        p("tomato.t_chill", "Chilling-injury threshold", 10.0, "degC", "experimental", s,
          "Chilling sensitive below 10 degC if held >2 weeks, or at 5 degC for >6-8 days; injury is cumulative", "All stages", "Threshold is a published range edge."),
        p("tomato.e_crit", "Critical chilling exposure E_crit", 840.0, "degC.h", "derived", s,
          "5 degC for ~7 days causes injury", "Below 10 degC", "Converts duration figure into degree-hours assuming linear dose.",
          "E_crit = (10 - 5) degC x 24 h x 7 d = 840 degC.h"),
        p("tomato.m_turning", "Maturity multiplier: turning / light red", round(math.sqrt(m_ripe), 3), "x k_ref", "assumption", NONE_SRC,
          "Geometric mean of mature-green (1.0) and ripe multipliers", "Turning stage", "Interpolated, not measured.", f"sqrt({m_ripe:.3f})"),
        p("tomato.m_ripe", "Maturity multiplier: firm-ripe", round(m_ripe, 3), "x k_ref", "derived", s,
          "8-10 days of shelf life at 7-10 degC after reaching firm-ripe", "Firm-ripe fruit",
          "Depends on the Q10 conversion from 8.5 degC to 12.5 degC.",
          f"k_ripe(8.5C) = ln(2.5)/9 = {k_ripe_85:.4f}; at 12.5C = {k_ripe_ref:.4f}; / k_ref = {m_ripe:.3f}"),
        p("tomato.t_app_low", "Applicability: lowest temperature in source data", 5.0, "degC", "experimental", s, "Respiration table lower bound", "", ""),
        p("tomato.t_app_high", "Applicability: highest temperature in source data", 25.0, "degC", "experimental", s, "Respiration table upper bound", "", ""),
    ] + shared_assumptions("tomato", 0.006)
    return {"produce": "tomato", "display_name": "Tomato", "kannada": "ಟೊಮೇಟೊ", "ethylene": "producer_moderate",
            "ethylene_sensitive": True, "default_price_per_kg": 20.0, "varieties": ["Local hybrid", "Arka Rakshak", "Roma"],
            "maturity_stages": ["mature_green", "turning", "ripe"], "params": params}


def banana():
    s = UCD["banana"]
    L = 21.0
    k = k_from_life(L)
    q = q10(10, 13, 20, 20)
    q_hi = q10(30, 13, 70, 20)
    m_ripe = 30 / 10
    params = [
        p("banana.t_ref", "Reference storage temperature", 14.0, "degC", "operating_range", s, "13-14 degC for storage and transport", "Mature-green", "", None, [13.0, 14.0]),
        p("banana.rh_low", "Recommended RH lower bound", 90.0, "%", "operating_range", s, "Optimum RH 90-95%", "All", ""),
        p("banana.rh_high", "Recommended RH upper bound", 95.0, "%", "operating_range", s, "Optimum RH 90-95%", "All", ""),
        p("banana.storage_life", "Published postharvest life at T_ref", L, "days", "operating_range", s,
          "Postharvest life potential of mature-green bananas: 2-4 weeks in air at 14 degC", "Mature-green, air, 14 degC", "Midpoint of a 2-4 week range.", None, [14.0, 28.0]),
        p("banana.k_ref", "Reference decay rate k_ref", round(k, 6), "1/day", "calibrated", s, "Derived from 21-day life at 14 degC", "Mature-green at T_ref",
          "Guarantees Q reaches Q_min at day L by construction; does NOT validate curve shape.",
          f"k_ref = ln(100/40)/{L:.0f} = {k:.5f} /day", [k_from_life(28.0), k_from_life(14.0)]),
        p("banana.q10", "Temperature coefficient Q10", round(q, 3), "dimensionless", "derived", s,
          "Respiration 10-30 mL CO2/kg.h at 13 degC, 20-70 at 20 degC (low end mature-green)", "13-20 degC",
          "Assumes quality loss scales with respiration.", f"Q10 = (20/10)^(10/7) = {q:.3f}; ripening high end gives {q_hi:.2f}", [2.3, round(q_hi, 3)]),
        p("banana.t_chill", "Chilling-injury threshold", 13.0, "degC", "experimental", s, "Chilling injury below 13 degC for a few hours to a few days", "All", "Cultivar dependent."),
        p("banana.e_crit", "Critical chilling exposure E_crit", 10.0, "degC.h", "derived", s,
          "Moderate injury: 1 h at 10 degC, 5 h at 11.7, 24 h at 12.2, 72 h at 12.8 degC", "Below 13 degC",
          "Linear dose assumption; the four published points give 3-19 degC.h.", "Degree-hours of the four points: 3.0, 6.5, 19.2, 14.4 -> rounded median ~10"),
        p("banana.m_turning", "Maturity multiplier: turning", round(math.sqrt(m_ripe), 3), "x k_ref", "assumption", NONE_SRC, "Geometric mean", "Turning", "Interpolated."),
        p("banana.m_ripe", "Maturity multiplier: ripening/ripe", m_ripe, "x k_ref", "derived", s,
          "Respiration at 13 degC: low end (mature-green) 10, high end (ripening) 30 mL CO2/kg.h", "Ripening fruit",
          "Assumes decay rate proportional to respiration.", "30 / 10 = 3.0"),
        p("banana.t_app_low", "Applicability: lowest temperature in source data", 13.0, "degC", "experimental", s, "Respiration table", "", ""),
        p("banana.t_app_high", "Applicability: highest temperature in source data", 20.0, "degC", "experimental", s, "Respiration table", "", ""),
    ] + shared_assumptions("banana", 0.005)
    return {"produce": "banana", "display_name": "Banana", "kannada": "ಬಾಳೆಹಣ್ಣು", "ethylene": "producer_high",
            "ethylene_sensitive": True, "default_price_per_kg": 28.0, "varieties": ["Robusta (Cavendish)", "Yelakki", "Nendran"],
            "maturity_stages": ["mature_green", "turning", "ripe"], "params": params}


def mango():
    s = UCD["mango"]
    L = 21.0
    k = k_from_life(L)
    q = q10(14, 10, 23.5, 15)  # pre-climacteric pair 10-15 degC; the 20 degC value includes the ripening surge
    q_lo, q_hi = 2.5, q10(14, 10, 57.5, 20)
    params = [
        p("mango.t_ref", "Reference storage temperature (mature-green)", 13.0, "degC", "operating_range", s, "13 degC for mature-green mangoes", "Mature-green", "Ripe fruit: 10 degC."),
        p("mango.rh_low", "Recommended RH lower bound", 90.0, "%", "operating_range", s, "Optimum RH 90-95%", "All", ""),
        p("mango.rh_high", "Recommended RH upper bound", 95.0, "%", "operating_range", s, "Optimum RH 90-95%", "All", ""),
        p("mango.storage_life", "Published postharvest life at T_ref", L, "days", "operating_range", s,
          "Postharvest life potential at 13 degC: 2-4 weeks in air", "Air, 13 degC", "Cultivar and maturity dependent.", None, [14.0, 28.0]),
        p("mango.k_ref", "Reference decay rate k_ref", round(k, 6), "1/day", "calibrated", s, "Derived from 21-day life at 13 degC", "Mature-green at T_ref",
          "Guarantees Q reaches Q_min at day L by construction; does NOT validate curve shape.",
          f"k_ref = ln(100/40)/{L:.0f} = {k:.5f} /day", [k_from_life(28.0), k_from_life(14.0)]),
        p("mango.q10", "Temperature coefficient Q10", round(q, 3), "dimensionless", "derived", s,
          "Respiration 12-16 mL CO2/kg.h at 10 degC, 19-28 at 15 degC, 35-80 at 20 degC", "10-20 degC",
          "The 20 degC respiration includes the climacteric ripening surge, which would inflate Q10; large extrapolation error above 20 degC.",
          f"Q10 = (23.5/14)^(10/5) = {q:.3f} (10-15 degC midpoints); 10-20 degC pair gives {q_hi:.2f} (upper end of range); lower end 2.5 is an engineering assumption", [q_lo, round(q_hi, 3)]),
        p("mango.t_chill", "Chilling-injury threshold", 10.0, "degC", "operating_range", s,
          "Recommended 10 degC for partially-ripe and ripe fruit; chilling severity depends on cultivar and ripeness", "All",
          "No explicit threshold published on the sheet; anchored on the lowest recommended temperature."),
        p("mango.e_crit", "Critical chilling exposure E_crit", 240.0, "degC.h", "assumption", NONE_SRC, "Assumed 5 degC below threshold for 2 days", "Below 10 degC", "Assumed."),
        p("mango.m_turning", "Maturity multiplier: partially ripe", 1.414, "x k_ref", "assumption", NONE_SRC, "Geometric mean of 1 and 2", "", "Assumed."),
        p("mango.m_ripe", "Maturity multiplier: ripe", 2.0, "x k_ref", "assumption", NONE_SRC, "Assumed doubling of decay rate for ripe fruit", "", "Assumed."),
        p("mango.t_app_low", "Applicability: lowest temperature in source data", 10.0, "degC", "experimental", s, "Respiration table", "", ""),
        p("mango.t_app_high", "Applicability: highest temperature in source data", 20.0, "degC", "experimental", s, "Respiration table", "", ""),
    ] + shared_assumptions("mango", 0.005)
    return {"produce": "mango", "display_name": "Mango", "kannada": "ಮಾವು", "ethylene": "producer_moderate",
            "ethylene_sensitive": True, "default_price_per_kg": 55.0, "varieties": ["Alphonso (Badami)", "Totapuri", "Mallika"],
            "maturity_stages": ["mature_green", "turning", "ripe"], "params": params}


def potato():
    s = UCD["potato"]
    L = 28.0
    k = k_from_life(L)
    q = q10(9, 10, 16, 20)  # midpoints 7-11 @10C and 9-23 @20C
    q_lo = q10(7, 5, 11.5, 15)
    params = [
        p("potato.t_ref", "Reference storage temperature (table use, early crop)", 7.0, "degC", "operating_range", s,
          "Table potatoes 7 degC at 98% RH (frying 10-15 degC, chipping 15-20 degC)", "Early-crop table potatoes", "Processing potatoes are stored warmer."),
        p("potato.rh_low", "Recommended RH lower bound", 95.0, "%", "operating_range", s, "95-98% RH", "All uses", ""),
        p("potato.rh_high", "Recommended RH upper bound", 98.0, "%", "operating_range", s, "95-98% RH", "All uses", ""),
        p("potato.storage_life", "Published storage life at T_ref", L, "days", "operating_range", s,
          "Good quality after 3 to 5 weeks at optimum conditions (early crop)", "Early-crop potatoes, uncured",
          "Cured mature potatoes keep months at 4 degC; this registry models early-crop table potatoes only.", None, [21.0, 35.0]),
        p("potato.k_ref", "Reference decay rate k_ref", round(k, 6), "1/day", "calibrated", s, "Derived from 28-day life at 7 degC", "Early crop at T_ref",
          "Guarantees Q reaches Q_min at day L by construction; does NOT validate curve shape.",
          f"k_ref = ln(100/40)/{L:.0f} = {k:.5f} /day", [k_from_life(35.0), k_from_life(21.0)]),
        p("potato.q10", "Temperature coefficient Q10", round(q, 3), "dimensionless", "derived", s,
          "Respiration 7-11 mL CO2/kg.h at 10 degC and 9-23 at 20 degC", "5-20 degC",
          "Assumes quality loss scales with respiration.", f"Q10 = (16/9)^(10/10) = {q:.3f}; 5-15 degC pair gives {q_lo:.2f}", [round(q_lo, 3), 2.0]),
        p("potato.t_chill", "Chilling-injury threshold", 3.0, "degC", "assumption", NONE_SRC,
          "Sheet: storage near 0 degC for a few weeks may cause mahogany discoloration", "All", "Threshold anchored on near 0 degC; engineering assumption."),
        p("potato.e_crit", "Critical chilling exposure E_crit", 1512.0, "degC.h", "derived", s,
          "Near 0 degC for a few weeks", "Below 3 degC", "Linear dose assumption.", "E_crit = (3 - 0) degC x 24 h x 21 d = 1512 degC.h"),
        p("potato.m_turning", "Maturity multiplier (not applicable, set to 1)", 1.0, "x k_ref", "assumption", NONE_SRC, "Potatoes have no ripening stages", "", ""),
        p("potato.m_ripe", "Maturity multiplier (not applicable, set to 1)", 1.0, "x k_ref", "assumption", NONE_SRC, "Potatoes have no ripening stages", "", ""),
        p("potato.t_app_low", "Applicability: lowest temperature in source data", 5.0, "degC", "experimental", s, "Respiration table", "", ""),
        p("potato.t_app_high", "Applicability: highest temperature in source data", 20.0, "degC", "experimental", s, "Respiration table", "", ""),
    ] + shared_assumptions("potato", 0.004)
    return {"produce": "potato", "display_name": "Potato", "kannada": "ಆಲೂಗಡ್ಡೆ", "ethylene": "producer_low", "ethylene_sensitive": False,
            "default_price_per_kg": 22.0, "varieties": ["Kufri Jyoti", "Kufri Pukhraj", "Local"], "maturity_stages": ["mature_green"],
            "prediction_supported": True, "params": params}


def onion():
    """Catalogued with sourced storage parameters, but shelf-life prediction is NOT supported (see limitation)."""
    s = UCD["onion"]
    q = q10(3.5, 2.5, 28, 26)
    params = [
        p("onion.t_ref", "Recommended storage temperature", 0.0, "degC", "operating_range", s, "Storage at 0 degC", "Cured dry bulbs", ""),
        p("onion.rh_low", "Recommended RH lower bound", 65.0, "%", "operating_range", s, "65-70% RH with air circulation", "Cured dry bulbs", ""),
        p("onion.rh_high", "Recommended RH upper bound", 70.0, "%", "operating_range", s, "65-70% RH", "Cured dry bulbs", ""),
        p("onion.storage_life", "Published storage life at 0 degC (pungent cultivars)", 210.0, "days", "operating_range", s,
          "Mild onions 0.5-1 month; pungent onions up to 6-9 months at 0 degC", "Pungent cultivars at 0 degC", "Cultivar dependent.", None, [180.0, 270.0]),
        p("onion.q10", "Respiration temperature coefficient", round(q, 3), "dimensionless", "derived", s,
          "3-4 mL/kg.h at 0-5 degC; 27-29 at 25-27 degC", "0-27 degC", "Respiration only; storage life at ambient is driven by dormancy and sprouting.",
          f"Q10 = (28/3.5)^(10/23.5) = {q:.3f}"),
    ]
    return {"produce": "onion", "display_name": "Onion", "kannada": "ಈರುಳ್ಳಿ", "ethylene": "producer_low", "ethylene_sensitive": True,
            "default_price_per_kg": 25.0, "varieties": ["Bellary Red", "Nashik Red", "Local"], "maturity_stages": ["mature_green"],
            "prediction_supported": False,
            "prediction_note": "Shelf-life prediction not supported for onion: ambient onion storage is governed by dormancy and sprouting, "
                               "which the respiration-based Q10 decay model does not represent. Parameters are listed for storage setpoints only.",
            "params": params}




# ---------------- additional crops (generic builder) ----------------
HB66 = {"title": "The Commercial Storage of Fruits, Vegetables, and Florist and Nursery Stocks (Agriculture Handbook 66)",
        "publisher": "USDA Agricultural Research Service; K.C. Gross, C.Y. Wang, M. Saltveit (eds.)", "year": 2016,
        "url": "https://www.ars.usda.gov/arsuserfiles/oc/np/commercialstorage/commercialstorage.pdf"}
FAO_GRAIN = {"title": "Grain storage techniques: evolution and trends in developing countries (FAO Agricultural Services Bulletin 109)",
             "publisher": "FAO; D.L. Proctor (ed.)", "year": 1994, "url": "https://www.fao.org/4/t1838e/t1838e00.htm"}
HARRINGTON = {"title": "Seed storage and longevity (Harrington's rules of thumb)", "publisher": "J.F. Harrington, in Seed Biology vol. III, Academic Press",
              "year": 1972, "url": None}


def crop(prod, name, kn, t_ref, rh, life, life_rng, q10v, q10_src, q10_note, t_chill, chill_src, ethylene, eth_sens, varieties, src, conditions,
         kw=0.004, grain=False, rh_hi_slope=0.08):
    """Generic produce entry: t_ref, RH and storage life are published; k_ref is calibrated from the life; Q10 as documented."""
    L = float(life)
    k = k_from_life(L)
    q10_cls = "derived" if q10_src is not NONE_SRC else "assumption"
    params = [
        p(f"{prod}.t_ref", "Reference storage temperature", t_ref, "degC", "operating_range", src, conditions, "Commercial storage", ""),
        p(f"{prod}.rh_low", "Recommended RH lower bound", rh[0], "%", "operating_range", src, conditions, "Commercial storage", ""),
        p(f"{prod}.rh_high", "Recommended RH upper bound", rh[1], "%", "operating_range", src, conditions, "Commercial storage", ""),
        p(f"{prod}.storage_life", "Published storage life at T_ref", L, "days", "operating_range", src, conditions,
          "Typical commercial lots", "Midpoint of the published range; cultivar and condition dependent.", None, list(life_rng)),
        p(f"{prod}.k_ref", "Reference decay rate k_ref", round(k, 6), "1/day", "calibrated", src, f"Derived from {L:.0f}-day life at {t_ref} degC", "At T_ref",
          "Guarantees Q reaches Q_min at day L by construction; does NOT validate curve shape.",
          f"k_ref = ln(100/40)/{L:.0f} = {k:.5f} /day", [k_from_life(life_rng[1]), k_from_life(life_rng[0])]),
        p(f"{prod}.q10", "Temperature coefficient Q10", q10v, "dimensionless", q10_cls, q10_src, q10_note, "Around T_ref to ambient",
          "Rate assumed to scale with temperature by Q10 only.", None, [round(q10v * 0.8, 2), round(q10v * 1.2, 2)]),
        p(f"{prod}.t_chill", "Chilling-injury threshold", t_chill, "degC", "experimental" if chill_src is src else "assumption", chill_src,
          "Chilling-sensitive below this temperature" if t_chill > 0 else "Not chilling-sensitive; threshold set below freezing", "All", "Cultivar dependent."),
        p(f"{prod}.e_crit", "Critical chilling exposure E_crit", 240.0, "degC.h", "assumption", NONE_SRC, "Assumed 5 degC below threshold for 2 days", "Below threshold", "Assumed."),
        p(f"{prod}.m_turning", "Maturity multiplier (not applicable, set to 1)", 1.0, "x k_ref", "assumption", NONE_SRC, "Single maturity stage modelled", "", ""),
        p(f"{prod}.m_ripe", "Maturity multiplier (not applicable, set to 1)", 1.0, "x k_ref", "assumption", NONE_SRC, "Single maturity stage modelled", "", ""),
        p(f"{prod}.t_app_low", "Applicability: lowest temperature", min(t_ref, 0.0) if not grain else 10.0, "degC", "assumption", NONE_SRC, "", "", ""),
        p(f"{prod}.t_app_high", "Applicability: highest temperature", 30.0 if not grain else 40.0, "degC", "assumption", NONE_SRC, "", "", ""),
    ] + shared_assumptions(prod, kw, rh_hi_slope=rh_hi_slope)
    return {"produce": prod, "display_name": name, "kannada": kn, "ethylene": ethylene, "ethylene_sensitive": eth_sens,
            "default_price_per_kg": None, "varieties": varieties, "maturity_stages": ["mature_green"], "prediction_supported": True,
            "category": "grain" if grain else "fresh", "params": params}


Q10_TYPICAL = "Typical fresh-produce Q10 of 2-3 between 0 and 20 degC; value not crop-specific"
EXTRA = [
    lambda: crop("cabbage", "Cabbage", "ಎಲೆಕೋಸು", 0.0, (98, 100), 35, (21, 42), 2.5, NONE_SRC, Q10_TYPICAL, -0.5, NONE_SRC, "producer_low", True,
                 ["Green", "Red", "Local"], HB66, "Early cabbage 0 degC, 98-100% RH, 3-6 weeks"),
    lambda: crop("cauliflower", "Cauliflower", "ಹೂಕೋಸು", 0.0, (95, 98), 25, (21, 28), 2.5, NONE_SRC, Q10_TYPICAL, -0.5, NONE_SRC, "producer_low", True,
                 ["Snowball", "Local"], HB66, "0 degC, 95-98% RH, 3-4 weeks"),
    lambda: crop("carrot", "Carrot", "ಗಜ್ಜರಿ", 0.0, (98, 100), 35, (28, 42), 2.5, NONE_SRC, Q10_TYPICAL, -0.5, NONE_SRC, "producer_low", True,
                 ["Ooty", "Local"], HB66, "Immature/bunched carrots 0 degC, 98-100% RH, 4-6 weeks (mature topped carrots keep months)"),
    lambda: crop("brinjal", "Brinjal", "ಬದನೆಕಾಯಿ", 11.0, (90, 95), 10, (7, 14), 2.5, NONE_SRC, Q10_TYPICAL, 10.0, HB66, "producer_low", True,
                 ["Purple long", "Green round", "Local"], HB66, "Eggplant 10-12 degC, 90-95% RH, 1-2 weeks; chilling injury below 10 degC"),
    lambda: crop("okra", "Okra", "ಬೆಂಡೆಕಾಯಿ", 8.5, (90, 95), 8, (7, 10), 2.5, NONE_SRC, Q10_TYPICAL, 7.0, HB66, "producer_low", True,
                 ["Local"], HB66, "7-10 degC, 90-95% RH, 7-10 days; chilling injury below 7 degC"),
    lambda: crop("green_chilli", "Green chilli", "ಹಸಿಮೆಣಸಿನಕಾಯಿ", 8.5, (90, 95), 18, (14, 21), 2.5, NONE_SRC, Q10_TYPICAL, 7.0, HB66, "producer_low", True,
                 ["Byadgi green", "Local"], HB66, "Hot peppers 7-10 degC, 90-95% RH, 2-3 weeks; chilling injury below 7 degC"),
    lambda: crop("grapes", "Grapes", "ದ್ರಾಕ್ಷಿ", 0.0, (90, 95), 28, (14, 56), 2.5, NONE_SRC, Q10_TYPICAL, -1.0, NONE_SRC, "producer_low", False,
                 ["Thompson Seedless", "Bangalore Blue", "Sharad"], HB66, "Table grapes -0.5 to 0 degC, 90-95% RH, 2-8 weeks (with SO2 pads)"),
    lambda: crop("papaya", "Papaya", "ಪಪ್ಪಾಯಿ", 10.0, (85, 90), 14, (7, 21), 2.5, NONE_SRC, Q10_TYPICAL, 7.0, HB66, "producer_moderate", True,
                 ["Red Lady", "Local"], HB66, "7-13 degC, 85-90% RH, 1-3 weeks; chilling injury below 7 degC"),
    lambda: crop("pomegranate", "Pomegranate", "ದಾಳಿಂಬೆ", 6.0, (90, 95), 75, (60, 90), 2.5, NONE_SRC, Q10_TYPICAL, 5.0, HB66, "producer_low", False,
                 ["Bhagwa", "Ganesh"], HB66, "5-7 degC, 90-95% RH, 2-3 months; chilling injury below 5 degC"),
    lambda: crop("orange", "Orange", "ಕಿತ್ತಳೆ", 6.0, (85, 90), 40, (21, 56), 2.5, NONE_SRC, Q10_TYPICAL, 3.0, HB66, "producer_low", False,
                 ["Coorg mandarin", "Nagpur"], HB66, "3-9 degC, 85-90% RH, 3-8 weeks"),
    lambda: crop("rice", "Rice (paddy)", "ಭತ್ತ", 25.0, (60, 70), 270, (180, 365), 4.0, HARRINGTON,
                 "Harrington's rule: storage life halves for each 5 degC rise (0-50 degC) -> Q10 = 2^(10/5) = 4", -5.0, NONE_SRC, "none", False,
                 ["Sona Masuri", "IR-64", "Local"], FAO_GRAIN, "Dry paddy (about 14% moisture) in cool, dry godowns; safe storage roughly 6-12 months",
                 kw=0.0002, grain=True, rh_hi_slope=0.03),
    lambda: crop("wheat", "Wheat", "ಗೋಧಿ", 25.0, (60, 70), 365, (270, 540), 4.0, HARRINGTON,
                 "Harrington's rule: storage life halves for each 5 degC rise (0-50 degC) -> Q10 = 2^(10/5) = 4", -5.0, NONE_SRC, "none", False,
                 ["Lokwan", "Sharbati", "Local"], FAO_GRAIN, "Dry wheat (about 12% moisture); safe storage 9-18 months in sound godowns",
                 kw=0.0002, grain=True, rh_hi_slope=0.03),
    lambda: crop("maize", "Maize", "ಮೆಕ್ಕೆಜೋಳ", 25.0, (60, 70), 240, (180, 365), 4.0, HARRINGTON,
                 "Harrington's rule: storage life halves for each 5 degC rise (0-50 degC) -> Q10 = 2^(10/5) = 4", -5.0, NONE_SRC, "none", False,
                 ["Hybrid", "Local"], FAO_GRAIN, "Dry shelled maize (about 13% moisture); safe storage 6-12 months",
                 kw=0.0002, grain=True, rh_hi_slope=0.03),
]


PENDING_REFS = [
    ("Mango (journal article)", "https://ccsenet.org/journal/index.php/jas/article/view/66567"),
    ("Mango (ICAR IJAgS)", "https://epubs.icar.org.in/index.php/IJAgS/article/download/101489/39854/340992"),
    ("Banana India (IAHS)", "https://www.journal.iahs.org.in/index.php/ijh/article/view/1311"),
    ("FAO general handling", "https://www.fao.org/4/ae075e/ae075e13.htm"),
    ("FAO temperature and humidity", "https://www.fao.org/4/y5431e/y5431e04.htm"),
]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    DOCS.mkdir(parents=True, exist_ok=True)
    regs = [tomato(), mango(), banana(), potato(), onion()] + [f() for f in EXTRA]
    lines = [f"# ZERO ROT parameter evidence audit (registry v{VERSION}, reviewed {REVIEWED})", "",
             "Generated by `backend/scripts/build_registry.py`. Every coefficient used by the decay engine is listed with its value, source, conditions, classification and limitations.", "",
             "**Calibration caveat.** `k_ref` is calibrated so that quality falls from 100 to the minimum sellable score (40) exactly at the published storage life. "
             "This guarantees the curve hits Q_min at day L by construction; it does NOT validate the shape of the deterioration curve. "
             "It will be upgraded only if experimental quality-over-time observations are found and fitted.", "",
             "**Weight loss (W) and rejection (R) functions are engineering assumptions.** The humidity and chilling penalty shapes are engineering assumptions anchored on published range edges.", ""]
    for r in regs:
        r.setdefault("prediction_supported", True)
        r["version"] = VERSION
        r["last_reviewed"] = REVIEWED
        (OUT / f"{r['produce']}.json").write_text(json.dumps(r, indent=2, ensure_ascii=False), encoding="utf-8")
        lines += [f"## {r['display_name']}", "", "| Parameter | Value | Unit | Classification | Source | Conditions | Limitations | Derivation |", "|---|---|---|---|---|---|---|---|"]
        for x in r["params"]:
            src = f"[{x['source']['publisher'].split(';')[0]}]({x['source']['url']})" if x["source"]["url"] else "none"
            val = f"{x['value']}" + (f" (range {x['range'][0]:.4g}-{x['range'][1]:.4g})" if x["range"] else "")
            lines.append(f"| {x['name']} | {val} | {x['unit']} | {x['classification_label']} | {src} | {x['conditions']} | {x['limitations']} | {x['derivation'] or ''} |")
        lines.append("")
    lines += ["## Starting references not yet used for coefficients", "",
              "These were listed in the brief. They have not been reviewed in this build, so no coefficient is taken from them.", ""]
    lines += [f"- {n}: {u}" for n, u in PENDING_REFS]
    (DOCS / "parameter_audit.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("registry written:", [r["produce"] for r in regs])


if __name__ == "__main__":
    main()
