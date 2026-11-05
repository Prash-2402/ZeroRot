"""Loads the versioned scientific parameter registry from data/parameters/*.json."""
from __future__ import annotations

import json
import pathlib
from dataclasses import dataclass, field
from functools import lru_cache

import numpy as np

PARAM_DIR = pathlib.Path(__file__).resolve().parents[3] / "data" / "parameters"
CLASS_SCORE = {"experimental": 1.0, "operating_range": 0.8, "derived": 0.7, "calibrated": 0.4, "assumption": 0.4, "demo": 0.2}
SUPPORTED = ("tomato", "mango", "banana", "potato")  # onion: catalogued, prediction not supported
# Parameters that the decay engine actually uses (for the confidence P factor and the twin's "parameters used" panel)
USED = ["t_ref", "rh_low", "rh_high", "k_ref", "q10", "t_chill", "e_crit", "chill_gamma", "h_low_slope", "h_high_slope", "kw", "r0", "q_rot"]


@dataclass
class Produce:
    produce: str
    display_name: str
    kannada: str
    version: str
    meta: dict
    params: dict = field(default_factory=dict)  # short id -> record

    def v(self, key: str) -> float:
        return float(self.params[key]["value"])

    def rng(self, key: str):
        r = self.params[key].get("range")
        return (float(r[0]), float(r[1])) if r else (self.v(key), self.v(key))

    def maturity_multiplier(self, maturity: str | None) -> float:
        if maturity == "ripe":
            return self.v("m_ripe")
        if maturity == "turning":
            return self.v("m_turning")
        return 1.0

    @property
    def prediction_supported(self) -> bool:
        return bool(self.meta.get("prediction_supported", True))

    def parameter_quality(self) -> float:
        return float(np.mean([CLASS_SCORE[self.params[k]["classification"]] for k in USED]))

    def used_params(self) -> list[dict]:
        return [self.params[k] for k in USED + ["m_turning", "m_ripe"]]


@lru_cache(maxsize=None)
def load_registry() -> dict[str, Produce]:
    out = {}
    for f in sorted(PARAM_DIR.glob("*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        params = {p["id"].split(".", 1)[1]: p for p in d["params"]}
        meta = {k: v for k, v in d.items() if k != "params"}
        out[d["produce"]] = Produce(d["produce"], d["display_name"], d.get("kannada", ""), d["version"], meta, params)
    return out


def get_produce(name: str) -> Produce:
    reg = load_registry()
    if name not in reg:
        raise ValueError(f"Unsupported produce '{name}'. Supported: {', '.join(sorted(reg))}")
    if not reg[name].prediction_supported:
        raise ValueError(reg[name].meta.get("prediction_note", f"Prediction is not supported for {name}"))
    return reg[name]
