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


CHAT_SYSTEM = ("You are 'Sahayaki', a warm, friendly voice assistant for Indian farmers inside the ZERO ROT post-harvest app. "
               "Talk the way a helpful person from the village agriculture office would talk: natural, conversational, kind, short. "
               "You can chat normally (greetings, small talk, general farming and storage know-how) using your own general knowledge. "
               "You are also given CONTEXT as JSON from the platform's models and live sources (godown sensors are SIMULATED; prices are verified "
               "mandi data only when present). For anything about the farmer's own lot, prices, weather or forecasts, rely only on CONTEXT and "
               "never invent such figures; if it is not in CONTEXT, say you don't have it yet. "
               "Do not read out the data like a report: pick only the one or two numbers that matter for the question, round them "
               "(say 'about 4 and a half days', not '4.6 days'), and explain what they mean and what to do. "
               "Never mention JSON, field names, IDs or timestamps. "
               "{lang_rule} Plain text only (no markdown, no lists, no asterisks), 2 to 5 short sentences, suitable to be spoken aloud.")

KN_RULE = ("Reply in natural, everyday spoken Kannada written in Kannada script, the way people in Karnataka actually talk "
           "(simple words; common English farm words like 'godown', 'truck', 'APMC' are fine). Do not translate word by word from English. "
           "Write numbers as rounded digits followed by Kannada units (for example 'ಸುಮಾರು 4 ದಿನ', 'ಕೆಜಿಗೆ 10 ರೂಪಾಯಿ', '82 ಅಂಕ'); "
           "never spell numbers out in words.")
EN_RULE = "Reply in simple, friendly English."


def _is_kannada(text: str) -> bool:
    kn = sum(1 for ch in text if "ಀ" <= ch <= "೿")
    letters = sum(1 for ch in text if ch.isalpha())
    return letters > 0 and kn / letters >= 0.3


def chat(question: str, context: dict, history: list[dict], language: str = "en") -> dict:
    # answer in the language the farmer wrote or spoke in; the app's language setting is the fallback
    kn = _is_kannada(question) or (language == "kn" and not question.isascii())
    if not kn and language == "kn" and question.isascii():
        kn = not any(w in question.lower() for w in ("english", "in english"))
    msgs = [{"role": "system", "content": CHAT_SYSTEM.format(lang_rule=KN_RULE if kn else EN_RULE)},
            {"role": "system", "content": "CONTEXT: " + json.dumps(context, default=str)[:12000]}]
    for h in history[-8:]:
        if h.get("role") in ("user", "assistant") and isinstance(h.get("content"), str):
            msgs.append({"role": h["role"], "content": h["content"][:2000]})
    msgs.append({"role": "user", "content": question[:2000]})
    text = _chat(msgs, json_mode=False, temperature=0.6).strip().replace("**", "").replace("__", "")
    bad = unverified_numbers(text, context)
    return {"answer": text, "language": "kn" if kn else "en", "model": settings.groq_model, "unverified_numbers": bad, "verified": not bad}


def parse_entry(text: str, crops: dict[str, list[str]]) -> dict:
    """Turn a spoken entry ("ಟೊಮೆಟೊ ಐನೂರು ಕೆಜಿ", "two tonnes of onion") into {commodity, quantity_kg}. The model only maps
    words to fields; it must not guess a quantity that was not said."""
    msgs = [{"role": "system", "content": "Extract a produce entry from a farmer's spoken sentence (Kannada or English, maybe mixed). "
             "Return JSON {\"commodity\": one id from the list or null, \"quantity_kg\": number or null, \"days_since_harvest\": number or null}. "
             "Convert tonnes/quintals to kg (1 quintal = 100 kg). Understand Kannada number words. Never invent a value that was not said. "
             "Commodity ids with their names: " + json.dumps(crops, ensure_ascii=False)},
            {"role": "user", "content": text[:500]}]
    raw = _chat(msgs, json_mode=True, temperature=0.0)
    try:
        d = json.loads(raw)
    except json.JSONDecodeError:
        raise Unavailable("Could not understand the entry")
    c = d.get("commodity")
    q = d.get("quantity_kg")
    return {"commodity": c if c in crops else None, "quantity_kg": float(q) if isinstance(q, (int, float)) and 0 < q <= 50000 else None,
            "days_since_harvest": float(d["days_since_harvest"]) if isinstance(d.get("days_since_harvest"), (int, float)) else None, "heard": text}
