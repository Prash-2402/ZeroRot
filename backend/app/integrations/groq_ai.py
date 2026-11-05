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


def api_keys() -> list[str]:
    """GROQ_API_KEY plus optional GROQ_API_KEY_1.._5 / GROQ_API_KEYS (comma-separated). Used in rotation."""
    import os
    keys = [settings.groq_api_key] + [os.environ.get(f"GROQ_API_KEY_{i}", "") for i in range(1, 6)]
    keys += [k.strip() for k in os.environ.get("GROQ_API_KEYS", "").split(",")]
    out = []
    for k in keys:
        if k and k not in out:
            out.append(k)
    return out


_next_key = [0]


def available() -> bool:
    return bool(api_keys())


def _chat(messages: list, json_mode: bool = True, temperature: float = 0.2) -> str:
    keys = api_keys()
    if not keys:
        raise Unavailable("GROQ_API_KEY not configured")
    body = {"model": settings.groq_model, "messages": messages, "temperature": temperature}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    last = "Groq rate limit reached on every configured key; try again shortly"
    # try each key once (starting from the last one that worked), then one paced retry
    order = [keys[(_next_key[0] + i) % len(keys)] for i in range(len(keys))]
    for attempt, key in enumerate(order + order[:1]):
        try:
            r = httpx.post("https://api.groq.com/openai/v1/chat/completions", json=body,
                           headers={"Authorization": f"Bearer {key}"}, timeout=settings.groq_timeout)
        except httpx.HTTPError as e:
            raise Unavailable(f"Groq unreachable ({type(e).__name__})")
        if r.status_code in (401, 403, 429):
            last = f"Groq error {r.status_code} (key {keys.index(key) + 1} of {len(keys)})"
            if attempt == len(order) - 1:
                try:
                    time.sleep(min(5.0, max(0.5, float(r.headers.get("retry-after", "2")))))
                except ValueError:
                    time.sleep(2.0)
            continue
        if r.status_code >= 400:
            msg = r.json().get("error", {}).get("message", r.text[:200]) if r.headers.get("content-type", "").startswith("application/json") else r.text[:200]
            raise Unavailable(f"Groq error {r.status_code}: {msg}")
        _next_key[0] = keys.index(key)
        return r.json()["choices"][0]["message"]["content"] or ""
    raise Unavailable(last)


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
    text = re.sub(r"(?<=\d),(?=\d\d)", "", text)   # drop thousands separators: 1,23,456 / 49,640
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


CHAT_SYSTEM = ("You are 'ZERO ROT Sahayaka', a helpful post-harvest assistant for Indian farmers and godown operators. "
               "You are given CONTEXT as JSON from the platform's models and live sources (godown sensors are SIMULATED virtual sensors; "
               "prices are verified mandi data only when present). Answer the user's question briefly and practically. "
               "Use only numbers that appear in CONTEXT; if something is not in CONTEXT, say you do not have that data. "
               "Never invent prices, temperatures, dates or forecasts. Reply in {lang}. Plain text, at most 6 short sentences or bullet points.")


def chat(question: str, context: dict, history: list[dict], language: str = "en") -> dict:
    lang = "Kannada (ಕನ್ನಡ script)" if language == "kn" else "simple English"
    msgs = [{"role": "system", "content": CHAT_SYSTEM.format(lang=lang)},
            {"role": "system", "content": "CONTEXT: " + json.dumps(context, default=str)[:12000]}]
    for h in history[-8:]:
        if h.get("role") in ("user", "assistant") and isinstance(h.get("content"), str):
            msgs.append({"role": h["role"], "content": h["content"][:2000]})
    msgs.append({"role": "user", "content": question[:2000]})
    text = _chat(msgs, json_mode=False, temperature=0.3).strip()
    bad = unverified_numbers(text, context)
    return {"answer": text, "model": settings.groq_model, "unverified_numbers": bad, "verified": not bad}
