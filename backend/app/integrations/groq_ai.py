"""Groq: the language layer only. It explains numerical results it is given; it never produces the numbers.
Structured JSON output validated with Pydantic; timeouts, one retry on rate limit, and a check that every number
in the explanation appears in the input payload (otherwise the response is flagged)."""
from __future__ import annotations

import json
import re
import time

import httpx
from pydantic import BaseModel, Field, ValidationError

from app.core.config import settings


class Unavailable(Exception):
    pass


class Recommendation(BaseModel):
    action: str
    reason: str


class Explanation(BaseModel):
    summary: str = Field(..., max_length=1200)
    key_factors: list[str] = Field(default_factory=list, max_length=8)
    recommendations: list[Recommendation] = Field(default_factory=list, max_length=6)
    risk_level: str = Field(..., pattern="^(low|medium|high|critical)$")
    caveats: list[str] = Field(default_factory=list, max_length=6)


class MarketEvents(BaseModel):
    summary: str
    events: list[dict] = Field(default_factory=list)


SYSTEM = ("You are an agricultural post-harvest advisor inside the ZERO ROT digital-twin platform. "
          "You receive JSON produced by numerical models and live data sources. Explain it for a farmer in plain language. "
          "Rules: use only numbers present in the input; never invent prices, temperatures or forecasts; mention when data is "
          "SIMULATED or a model is an estimate; give practical actions with a reason each. Reply with JSON only.")

TASKS = {
    "shelf_life": "Explain the shelf-life prediction and the storage risk.",
    "simulation": "Analyse this simulation state: what is happening, why, and what to do.",
    "alert": "Explain this alert to a farmer and the corrective action.",
    "price_forecast": "Explain the price forecast, its uncertainty, and the selling recommendation.",
    "profit": "Explain why selling now or storing is recommended, using the computed figures.",
    "cold_chain": "Explain this cold-chain incident and its effect on the cargo.",
}


def available() -> bool:
    return bool(settings.groq_api_key)


def _chat(messages: list, json_mode: bool = True) -> str:
    if not available():
        raise Unavailable("GROQ_API_KEY not configured")
    body = {"model": settings.groq_model, "messages": messages, "temperature": 0.2}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    for attempt in range(2):
        try:
            r = httpx.post("https://api.groq.com/openai/v1/chat/completions", json=body,
                           headers={"Authorization": f"Bearer {settings.groq_api_key}"}, timeout=settings.groq_timeout)
        except httpx.HTTPError as e:
            raise Unavailable(f"Groq unreachable ({type(e).__name__})")
        if r.status_code == 429 and attempt == 0:
            try:
                wait = float(r.headers.get("retry-after", "2"))
            except ValueError:
                wait = 2.0
            time.sleep(min(5.0, max(0.5, wait)))
            continue
        if r.status_code >= 400:
            msg = r.json().get("error", {}).get("message", r.text[:200]) if r.headers.get("content-type", "").startswith("application/json") else r.text[:200]
            raise Unavailable(f"Groq error {r.status_code}: {msg}")
        return r.json()["choices"][0]["message"]["content"] or ""
    raise Unavailable("Groq rate limit reached; try again shortly")


_NUM = re.compile(r"(?<![\w.])-?\d+(?:\.\d+)?(?!\d|\s?(?:st|nd|rd|th)\b)")
_SRC_NUM = re.compile(r"-?\d+(?:\.\d+)?")


def unverified_numbers(text: str, payload: dict) -> list[str]:
    """Numbers in the explanation that do not appear (within rounding) in the input payload."""
    src = json.dumps(payload)
    vals = []
    for m in _SRC_NUM.findall(src):
        try:
            vals.append(float(m.replace(",", "")))
        except ValueError:
            pass
    bad = []
    for m in _NUM.findall(text):
        try:
            v = float(m.replace(",", ""))
        except ValueError:
            continue
        cands = vals + [x * 100 for x in vals if abs(x) <= 1] + [x / 1000 for x in vals]
        if v in (0, 1, 2, 3, 24, 100) or any(abs(v - x) <= max(0.06 * abs(x), 0.6) for x in cands):
            continue
        bad.append(m)
    return bad


def explain(task: str, payload: dict, language: str = "en") -> dict:
    if task not in TASKS:
        raise ValueError(f"unknown task {task}")
    schema = '{"summary": str, "key_factors": [str], "recommendations": [{"action": str, "reason": str}], "risk_level": "low|medium|high|critical", "caveats": [str]}'
    lang = "Kannada (ಕನ್ನಡ script)" if language == "kn" else "English"
    msgs = [{"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"Task: {TASKS[task]}\nWrite in {lang}.\nReturn JSON matching: {schema}\nInput:\n{json.dumps(payload, default=str)[:12000]}"}]
    raw = _chat(msgs)
    try:
        data = Explanation.model_validate(json.loads(raw))
    except (json.JSONDecodeError, ValidationError) as e:
        raise Unavailable(f"Groq returned an invalid structured response ({type(e).__name__})")
    text = " ".join([data.summary] + data.key_factors + [r.action + " " + r.reason for r in data.recommendations])
    bad = unverified_numbers(text, payload)
    return {"explanation": data.model_dump(), "model": settings.groq_model, "provider": "groq", "unverified_numbers": bad,
            "verified": not bad, "label": "AI explanation of model outputs (Groq). Numbers come from the numerical models."}


def market_events(commodity: str, articles: list[dict]) -> dict:
    if not articles:
        return {"summary": "No recent articles found.", "events": []}
    msgs = [{"role": "system", "content": SYSTEM},
            {"role": "user", "content": "From these news headlines, extract market-relevant events for " + commodity +
             " in India (supply, demand, weather, festivals, policy). News is context only, not proof of price moves. "
             'Return JSON {"summary": str, "events": [{"title": str, "kind": "supply|demand|weather|festival|policy|other", "direction": "up|down|unclear", "url": str}]}.\n'
             + json.dumps(articles[:12])}]
    raw = _chat(msgs)
    try:
        return MarketEvents.model_validate(json.loads(raw)).model_dump()
    except (json.JSONDecodeError, ValidationError) as e:
        raise Unavailable(f"Groq returned an invalid structured response ({type(e).__name__})")
