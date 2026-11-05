"""Simulation runtime: one authoritative state per simulation. Dashboards, 3D scenes and the mobile app all read
what this produces (sent over WebSocket, persisted as readings, snapshots, predictions and alerts)."""
from __future__ import annotations

import math
from bisect import bisect_right
from datetime import datetime, timedelta

from app.engine.registry import get_produce
from . import cold_storage, event_manager, route_geometry, scenario_manager, sensor_generator, truck_model
from .deterioration_model import predict, reference_rate
from .environment import humidity_ratio
from .state import AirState, Equipment, Overrides, ProduceState, SimState

SUBSTEP_S = 30.0
ALERT_CLEAR_S = 3600.0   # an alert must stay clear for 1 h (sim time) before it resolves
MAX_STORAGE_DAYS = 14   # keeps every simulated hour inside the live weather forecast window (16 days)


# ---------------- ambient boundary conditions ----------------
def _interp_series(pt: dict, ts: float) -> tuple[float, float, float] | None:
    times = pt["times"]
    if not times or ts < times[0] - 3600 or ts > times[-1] + 3600:
        return None
    i = max(1, min(len(times) - 1, bisect_right(times, ts)))
    t0, t1 = times[i - 1], times[i]
    f = 0.0 if t1 == t0 else max(0.0, min(1.0, (ts - t0) / (t1 - t0)))
    lerp = lambda k: pt[k][i - 1] + (pt[k][i] - pt[k][i - 1]) * f
    return lerp("t"), lerp("rh"), lerp("p")


def ambient(cfg: dict, s: SimState) -> dict:
    """Outside air for this instant: live forecast (interpolated in time, and along the route for trucks),
    then user overrides (labelled MANUAL) and scenario offsets (labelled SCENARIO)."""
    start = datetime.fromisoformat(cfg["start_time"])
    ts = (start + timedelta(seconds=s.t_seconds)).timestamp()
    w = cfg.get("weather") or {}
    pts = w.get("points") or []
    vals = None
    if pts:
        if len(pts) == 1 or s.kind != "cold_chain":
            vals = _interp_series(pts[0], ts)
        else:
            frac = s.route_progress_m / max(1.0, cfg["route_distance_m"])
            pos = frac * (len(pts) - 1)
            j = min(len(pts) - 2, int(pos))
            a, b = _interp_series(pts[j], ts), _interp_series(pts[j + 1], ts)
            if a and b:
                g = pos - j
                vals = tuple(a[k] + (b[k] - a[k]) * g for k in range(3))
    source = "live_forecast" if vals else "unavailable"
    t, rh, p = vals if vals else (None, None, None)
    ov = s.overrides
    if ov.ambient_t is not None:
        t, source = ov.ambient_t, "manual"
    if ov.ambient_rh is not None:
        rh = ov.ambient_rh
    if t is None or rh is None:
        return {"t": None, "rh": None, "p": p, "source": "unavailable"}
    if ov.ambient_offset:
        t = t + ov.ambient_offset
        source = f"{source}+scenario"
    return {"t": float(t), "rh": float(rh), "p": float(p) if p else 101325.0, "source": source}


def weather_extras(cfg: dict, s: SimState) -> dict:
    """Precipitation (mm/h) and cloud cover (%) from the same live forecast, for the 3D sky. None when not available."""
    pts = (cfg.get("weather") or {}).get("points") or []
    if not pts:
        return {"precip_mm": None, "cloud_pct": None}
    start = datetime.fromisoformat(cfg["start_time"])
    ts = (start + timedelta(seconds=s.t_seconds)).timestamp()
    pt = pts[0]
    if s.kind == "cold_chain" and len(pts) > 1:
        frac = s.route_progress_m / max(1.0, cfg["route_distance_m"])
        pt = pts[min(len(pts) - 1, round(frac * (len(pts) - 1)))]
    times = pt.get("times") or []
    out = {}
    for key in ("precip_mm", "cloud_pct"):
        series = pt.get(key)
        if not series or not times:
            out[key] = None
            continue
        i = max(0, min(len(times) - 1, bisect_right(times, ts) - 1))
        out[key] = series[i]
    return out


# ---------------- initial state ----------------
def initial_state(kind: str, cfg: dict) -> SimState:
    b = cfg["batch"]
    produce = ProduceState(commodity=b["commodity"], maturity=b.get("maturity"), mass_kg=float(b["quantity_kg"]), q=float(b["initial_quality"]))
    eq = Equipment(setpoint=cfg.get("setpoint"), rh_setpoint=cfg.get("rh_setpoint"),
                   refrigeration_on=kind != "traditional_storage" and bool(cfg.get("refrigerated", True)))
    s = SimState(kind=kind, t_seconds=0.0, produce=produce, air=AirState(t=20.0, w=0.01), equipment=eq, overrides=Overrides())
    if cfg.get("manual_ambient"):
        s.overrides.ambient_t = cfg["manual_ambient"]["t"]
        s.overrides.ambient_rh = cfg["manual_ambient"]["rh"]
    amb = ambient(cfg, s)
    if amb["t"] is None:
        raise ValueError("Outside weather is unavailable for this location and no manual ambient value was given")
    p_atm = amb["p"]
    if kind == "traditional_storage":
        t0 = cfg.get("initial_internal_temp") if cfg.get("initial_internal_temp") is not None else amb["t"]
        s.air = AirState(t=t0, w=humidity_ratio(t0, min(100.0, amb["rh"]), p_atm))
    else:
        t0 = cfg.get("initial_internal_temp") if cfg.get("initial_internal_temp") is not None else cfg["setpoint"]
        rh0 = cfg.get("rh_setpoint") or 90.0
        s.air = AirState(t=t0, w=humidity_ratio(t0, rh0, p_atm))
    if kind == "cold_chain":
        s.zones = [float(t0)] * truck_model.N_ZONES
        s.speed_kmh = float(cfg["planned_speed_kmh"])
    return s


# ---------------- runtime ----------------
class Runtime:
    def __init__(self, sim_id: int, kind: str, cfg: dict, state: SimState, meta: dict | None = None):
        self.id, self.kind, self.cfg, self.s = sim_id, kind, cfg, state
        self.meta = meta or {"active_alerts": {}, "door_open_s": 0.0, "last_reading_t": -1e9, "last_snapshot_t": -1e9,
                             "last_pred_t": -1e9, "history": [], "summary": None, "events_log": []}
        self.ref_rate = reference_rate(state.produce.commodity, state.produce.maturity)
        self.last_flows: dict = {}
        self.last_amb: dict = {}
        self.last_readings: dict = {}
        self._cum: list[float] | None = None

    # -- helpers --
    def end_seconds(self) -> float:
        if self.kind == "cold_chain":
            return math.inf
        return float(self.cfg["duration_days"]) * 86400.0

    def planned_remaining_h(self) -> float:
        if self.kind == "cold_chain":
            remaining_m = self.cfg["route_distance_m"] - self.s.route_progress_m
            return max(0.0, remaining_m / max(1.0, self.s.speed_kmh / 3.6) / 3600.0 + self.s.delay_remaining_s / 3600.0)
        end = float(self.cfg["plan_days"]) * 86400.0 if self.cfg.get("plan_days") else self.end_seconds()
        return max(0.0, (end - self.s.t_seconds) / 3600.0)

    def delay_s(self) -> float:
        if self.kind != "cold_chain":
            return 0.0
        planned = self.cfg.get("schedule_offset_s", 0.0) + self.cfg["route_duration_s"] * (self.s.route_progress_m / max(1.0, self.cfg["route_distance_m"]))
        return max(0.0, self.s.t_seconds - planned)

    def pose(self):
        """(lat, lng, heading_deg) of the truck, interpolated by distance along the road geometry."""
        geom = self.cfg.get("route_geometry") or []
        if not geom:
            return None
        if self._cum is None:
            self._cum = route_geometry.cumulative_m(geom)
        scale = self._cum[-1] / max(1.0, self.cfg["route_distance_m"])
        return route_geometry.point_at(geom, self._cum, self.s.route_progress_m * scale)

    def gps(self):
        p = self.pose()
        return (round(p[0], 6), round(p[1], 6)) if p else None

    def reroute(self, geometry: list, distance_m: float, duration_s: float, reason: str) -> dict:
        """Continue on a new road geometry that starts at the truck's current position (progress restarts at 0 on it).
        The schedule offset keeps the delay figure relative to the original plan."""
        done_m = self.s.route_progress_m
        planned_done = self.cfg.get("schedule_offset_s", 0.0) + self.cfg["route_duration_s"] * (done_m / max(1.0, self.cfg["route_distance_m"]))
        old = {"geometry": self.cfg["route_geometry"], "distance_m": self.cfg["route_distance_m"], "at_m": done_m, "reason": reason}
        self.cfg["route_geometry"] = geometry
        self.cfg["route_distance_m"] = float(distance_m)
        self.cfg["route_duration_s"] = float(duration_s)
        self.cfg["schedule_offset_s"] = planned_done
        self.cfg["distance_done_before_m"] = self.cfg.get("distance_done_before_m", 0.0) + done_m
        self.s.route_progress_m = 0.0
        self.s.delay_remaining_s = 0.0
        self._cum = None
        return old

    def finished(self) -> bool:
        if self.kind == "cold_chain":
            return self.s.route_progress_m >= self.cfg["route_distance_m"] - 1
        return self.s.t_seconds >= self.end_seconds()

    # -- stepping --
    def advance(self, dt_total: float, predictions: bool = True, mc_draws: int = 200) -> dict:
        """Advance by dt_total simulated seconds. Returns what changed for persistence/broadcast."""
        out = {"readings": [], "alerts_opened": [], "alerts_resolved": [], "actions": [], "prediction": None, "snapshot": False, "completed": False}
        remaining = dt_total
        while remaining > 1e-9 and not self.finished():
            dt = min(SUBSTEP_S, remaining)
            loading_s = float(self.cfg.get("loading_s") or 0.0)
            if self.kind != "cold_chain" and loading_s:
                if self.s.t_seconds < loading_s:
                    self.s.equipment.door_open = True        # door stays open while crates are carried in
                    self.meta["door_open_s"] = 0.0           # loading is planned, not a door fault
                elif not self.meta.get("loaded"):
                    self.meta["loaded"] = True
                    self.s.equipment.door_open = False
            amb = ambient(self.cfg, self.s)
            if amb["t"] is None:
                out["error"] = "Outside weather unavailable for this simulated time; set a manual ambient value to continue."
                break
            if self.kind == "cold_chain":
                self.last_flows = truck_model.step_truck(self.s, self.cfg, amb, dt)
            else:
                self.last_flows = cold_storage.step_room(self.s, cold_storage.envelope_from_config(self.cfg), amb, dt)
            self.s.t_seconds += dt
            self.meta["door_open_s"] = self.meta["door_open_s"] + dt if self.s.equipment.door_open else 0.0
            self.last_amb = amb
            remaining -= dt
            self._periodic(out, predictions, mc_draws)
        if self.finished() and not self.meta.get("summary"):
            self.meta["summary"] = self.summary()
            out["completed"] = True
            out["snapshot"] = True
        return out

    def readings(self) -> dict:
        amb = self.last_amb or ambient(self.cfg, self.s)
        r = truck_model.readings_truck(self.s, amb) if self.kind == "cold_chain" else cold_storage.readings_room(self.s, amb)
        self.last_readings = r
        return r

    def _periodic(self, out: dict, predictions: bool, mc_draws: int):
        t = self.s.t_seconds
        interval = float(self.cfg.get("reading_interval_s", 600))
        r = self.readings()
        if t - self.meta["last_reading_t"] >= interval:
            self.meta["last_reading_t"] = t
            out["readings"].append({"t": t, "sensors": sensor_generator.sensors(self.kind, self.s, r, self.gps())})
            hist = self.meta["history"]
            hist.append({"t": t, "temp": r["temperature_c"], "max_zone": r.get("max_zone_c"), "rh": r["rh_pct"], "o2": r["o2_pct"],
                         "co2": r["co2_pct"], "q": round(self.s.produce.q, 3), "amb_t": round(self.last_amb.get("t") or 0, 2),
                         "power": r["power_kw"]})
            if len(hist) > 2000:
                del hist[: len(hist) - 2000]
        if predictions and t - self.meta["last_pred_t"] >= float(self.cfg.get("prediction_interval_s", 3600)):
            self.meta["last_pred_t"] = t
            p = predict(self.s.produce, r.get("max_zone_c", r["temperature_c"]), r["rh_pct"], self.planned_remaining_h(), f"sim-{self.id}", draws=mc_draws)
            p["t"] = t
            self.s.last_prediction = p
            out["prediction"] = p
        if t - self.meta["last_snapshot_t"] >= float(self.cfg.get("snapshot_interval_s", 3600)):
            self.meta["last_snapshot_t"] = t
            out["snapshot"] = True
        self._alerts(out, r)

    def _alerts(self, out: dict, r: dict):
        ctx = {"door_open_s": self.meta["door_open_s"], "delay_s": self.delay_s(),
               "spoilage_probability": (self.s.last_prediction or {}).get("spoilage_probability"),
               "decay_ratio": (self.last_flows.get("decay_rate_per_day", 0) / self.ref_rate) if self.ref_rate else None}
        findings = {f.code: f for f in event_manager.evaluate(self.s, r, self.kind, self.cfg, ctx)}
        pc = self.meta.get("precool")
        if pc and not pc.get("done"):
            if self.s.air.t <= pc["target"] + 0.5:
                pc["done"] = True
            else:
                findings.pop("TEMP_EXCURSION", None)   # planned pull-down of warm produce, not an excursion
        active = self.meta["active_alerts"]
        for code, f in findings.items():
            prev = active.get(code)
            if prev is not None:
                prev.pop("clear_t", None)
            if prev is None or (prev["severity"] != f.severity and f.severity == "CRITICAL"):
                active[code] = {"severity": f.severity, "t": self.s.t_seconds}
                out["alerts_opened"].append(f)
                if self.cfg.get("auto_control"):
                    act = self._auto(f)
                    if act:
                        out["actions"].append(act)
        for code in list(active):
            if code not in findings:
                # hysteresis: resolve only after the condition has stayed clear for ALERT_CLEAR_S of sim time
                clear_t = active[code].setdefault("clear_t", self.s.t_seconds)
                if self.s.t_seconds - clear_t >= ALERT_CLEAR_S:
                    active.pop(code)
                    out["alerts_resolved"].append(code)

    def _auto(self, f: event_manager.Finding) -> dict | None:
        """Automatic control within safety limits; every action is returned for the audit trail."""
        eq = self.s.equipment
        p = get_produce(self.s.produce.commodity)
        safe_min = p.v("t_chill") + 0.5
        if f.code == "COOLING_FAILURE" and not eq.backup_cooling and self.cfg.get("backup_cooling_available", True):
            eq.backup_cooling = True
            return {"action": "activate_backup_cooling", "reason": "Cooling failure detected; backup unit enabled automatically.", "parameters": {}}
        if f.code == "TEMP_EXCURSION" and eq.setpoint is not None and eq.setpoint - 1.0 >= safe_min and not eq.cooling_failed:
            old = eq.setpoint
            eq.setpoint = round(old - 1.0, 2)
            return {"action": "adjust_setpoint", "reason": f"Temperature excursion; setpoint lowered {old} -> {eq.setpoint} degC (safety minimum {safe_min:.1f} degC).",
                    "parameters": {"old": old, "new": eq.setpoint, "safe_min": safe_min}}
        if f.code == "GAS_ABNORMAL":
            old = eq.fresh_air_ach
            eq.fresh_air_ach = max((old or self.cfg.get("ach", 0.3)) * 2, 1.0)
            return {"action": "ventilate", "reason": "Gas outside tolerance; fresh-air exchange increased.", "parameters": {"old": old, "new": eq.fresh_air_ach}}
        return None

    # -- controls --
    def scenario(self, name: str) -> str:
        return scenario_manager.apply(self.s, self.kind, name)

    def control(self, name: str, value):
        scenario_manager.set_control(self.s, name, value, self.cfg.get("route_distance_m", 0.0))

    # -- outputs --
    def snapshot(self) -> dict:
        return {"state": self.s.to_dict(), "meta": self.meta}

    def live(self) -> dict:
        r = self.last_readings or self.readings()
        amb = self.last_amb or ambient(self.cfg, self.s)
        return {"t_seconds": self.s.t_seconds, "sim_time": (datetime.fromisoformat(self.cfg["start_time"]) + timedelta(seconds=self.s.t_seconds)).isoformat(timespec="minutes"),
                "readings": r, "ambient": amb, "produce": {"quality": round(self.s.produce.q, 2), "weight_loss_pct": round(self.s.produce.w * 100, 3),
                                                            "rejected_pct": round(self.s.produce.r * 100, 3), "chill_exposure": round(self.s.produce.e, 1)},
                "equipment": self.s.equipment.__dict__, "overrides": self.s.overrides.__dict__, "faults": self.s.faults,
                "prediction": self.s.last_prediction, "flows": self.last_flows, "active_alerts": self.meta["active_alerts"],
                "route": {"progress_m": self.s.route_progress_m, "distance_m": self.cfg.get("route_distance_m"), "speed_kmh": self.s.speed_kmh,
                          "delay_remaining_s": self.s.delay_remaining_s, "delay_s": self.delay_s(), "gps": self.gps(),
                          "eta_h": self.planned_remaining_h()} if self.kind == "cold_chain" else None,
                "sensors": sensor_generator.sensors(self.kind, self.s, r, self.gps()), "labels": {"sensors": "SIMULATED", "ambient": amb.get("source")},
                "weather_extras": weather_extras(self.cfg, self.s), "loading": self.loading(), "pose": self.pose() if self.kind == "cold_chain" else None}

    def loading(self) -> dict | None:
        ls = float(self.cfg.get("loading_s") or 0.0)
        if self.kind == "cold_chain" or not ls:
            return None
        frac = min(1.0, self.s.t_seconds / ls)
        return {"duration_s": ls, "progress": round(frac, 4), "kg_loaded": round(self.s.produce.mass_kg * frac, 1), "done": frac >= 1.0}

    def summary(self) -> dict:
        p = self.s.produce
        pp = get_produce(p.commodity)
        sellable = p.q >= pp.v("q_min")
        saleable = p.mass_kg * (1 - p.w) * (1 - p.r) if sellable else 0.0
        days = self.s.t_seconds / 86400.0
        energy_kwh = sum(h.get("power", 0) for h in self.meta["history"]) * float(self.cfg.get("reading_interval_s", 600)) / 3600.0
        return {"initial_kg": p.mass_kg, "final_quality": round(p.q, 2), "final_saleable_kg": round(saleable, 1),
                "lost_kg": round(p.mass_kg - saleable, 1), "loss_pct": round((p.mass_kg - saleable) / p.mass_kg * 100, 2),
                "weight_loss_pct": round(p.w * 100, 2), "rejected_pct": round(p.r * 100, 2), "sellable": sellable, "duration_days": round(days, 3),
                "energy_kwh": round(energy_kwh, 2), "remaining_shelf_life_days": (self.s.last_prediction or {}).get("shelf_life_days"),
                "distance_km": round(self.s.route_progress_m / 1000, 1) if self.kind == "cold_chain" else None}


def run_headless(sim_id: int, kind: str, cfg: dict, scenario: str | None = None, max_days: float = 14.0) -> dict:
    """Fast-forward a simulation without real-time pacing (used for comparisons and tests)."""
    rt = Runtime(sim_id, kind, cfg, initial_state(kind, cfg))
    if scenario and scenario != "normal":
        rt.scenario(scenario)
    limit = max_days * 86400
    while not rt.finished() and rt.s.t_seconds < limit:
        res = rt.advance(3600.0, predictions=False)
        if res.get("error"):
            return {"error": res["error"], "partial": rt.summary()}
    rt.s.last_prediction = predict(rt.s.produce, rt.readings().get("max_zone_c", rt.readings()["temperature_c"]), rt.readings()["rh_pct"],
                                   0.0, f"sim-{sim_id}", draws=50)
    return rt.summary()
