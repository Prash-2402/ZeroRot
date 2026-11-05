"""Mitra agent. With a Groq key: the model chooses which engine tools to call (agentic), then answers in the
farmer's language. Without a key, or if Groq fails: the rule-based assistant answers with the same tools."""
from __future__ import annotations

import json
import logging
import re
import time

import httpx
from sqlalchemy.orm import Session

from app import domain
from app.core.config import env, settings
from . import rules, tools
from .rag import is_kannada

log = logging.getLogger("zerorot.mitra")
TIMEOUT = float(env("ASSISTANT_TIMEOUT_SECONDS", "15"))
MAX_ROUNDS = 5

SYSTEM = """You are Mitra (ಮಿತ್ರ), a friendly assistant for a small farmer in Kolar, Karnataka, inside the ZERO ROT app.
The farmer has three batches: tomatoes in the farm shed, mangoes in a cold-storage container, bananas with the mandi company's reefer truck.
Rules:
- Get every number (quality, days left, value, rupees, temperatures) by calling tools. Never invent or estimate numbers yourself.
- For general storage questions call the knowledge tool and base the answer on it; mention the source briefly.
- You cannot perform actions. If a tool returns a confirm step (hand over, approve reroute), tell the farmer to tap the button on screen.
- Mandi prices and truck sensors are simulated in this demo; say so when you quote prices.
- Reply in {language}. Use short, simple sentences a farmer understands (2-4 sentences). Use Indian rupee format like ₹1,13,517.
- Currently on screen: {screen}. If the farmer says "this" or does not name a crop, use the batch on screen.
"""


def detect_lang(message: str, requested: str | None) -> str:
    if is_kannada(message):
        return "kn"
    return requested if requested in ("kn", "en") else "en"


def groq_available() -> bool:
    return bool(settings.groq_api_key)


def _groq(messages: list, use_tools: bool = True) -> dict:
    body = {"model": settings.groq_model, "messages": messages, "temperature": 0.2}
    if use_tools:
        body.update(tools=tools.TOOL_SPECS, tool_choice="auto")
    for attempt in range(2):
        r = httpx.post("https://api.groq.com/openai/v1/chat/completions", json=body,
                       headers={"Authorization": f"Bearer {settings.groq_api_key}"}, timeout=TIMEOUT)
        if r.status_code == 429 and attempt == 0:  # free-tier rate limit: wait once, briefly, then retry
            try:
                wait = float(r.headers.get("retry-after", "2"))
            except ValueError:
                wait = 2.0
            time.sleep(min(4.0, max(0.5, wait)))
            continue
        break
    r.raise_for_status()
    return r.json()["choices"][0]["message"]


def _llm(db: Session, message: str, lang: str, context: dict, history: list) -> dict:
    screen = f"place={context.get('focus') or 'farm overview'}, batch={context.get('batch_id') or 'none'}"
    msgs = [{"role": "system", "content": SYSTEM.format(language="Kannada (ಕನ್ನಡ script)" if lang == "kn" else "English", screen=screen)}]
    for h in (history or [])[-6:]:
        if h.get("role") in ("user", "assistant") and h.get("content"):
            msgs.append({"role": h["role"], "content": str(h["content"])[:800]})
    msgs.append({"role": "user", "content": message})
    out = {"ui": [], "sources": [], "tools": []}
    for _ in range(MAX_ROUNDS):
        m = _groq(msgs)
        calls = m.get("tool_calls") or []
        if not calls:
            out["reply"] = (m.get("content") or "").strip()
            return out
        msgs.append({"role": "assistant", "content": m.get("content") or "", "tool_calls": calls})
        for c in calls:
            name = c["function"]["name"]
            try:
                args = json.loads(c["function"].get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            res = tools.run_tool(db, name, args, context.get("batch_id"))
            out["tools"].append({"name": name, "args": args})
            out["ui"] += res.get("ui", [])
            out["sources"] += res.get("sources", [])
            msgs.append({"role": "tool", "tool_call_id": c["id"], "content": json.dumps(res["data"], default=str)[:4000]})
    m = _groq(msgs, use_tools=False)
    out["reply"] = (m.get("content") or "").strip()
    return out


def _dedupe_ui(actions: list) -> list:
    seen, out = set(), []
    for a in actions:
        key = json.dumps(a, sort_keys=True)
        if key not in seen:
            seen.add(key)
            out.append(a)
    # only the last focus matters
    focus = [a for a in out if a["type"] == "focus"]
    return [a for a in out if a["type"] != "focus"] + focus[-1:]


def chat(db: Session, message: str, lang: str | None, context: dict | None, history: list | None) -> dict:
    context = context or {}
    lang = detect_lang(message, lang)
    note = None
    engine = "rule_based"
    res = None
    if groq_available():
        try:
            res = _llm(db, message, lang, context, history or [])
            engine = "groq"
            if not res.get("reply"):
                raise ValueError("empty reply")
        except Exception as e:  # never let the assistant break the demo
            log.warning("groq failed: %s", e)
            note = f"AI model unavailable ({type(e).__name__}); answered by the rule-based assistant."
            res = None
    if res is None:
        res = rules.respond(db, message, lang, context.get("batch_id"))
    seen_src, sources = set(), []
    for s in res.get("sources", []):
        k = (s["title"], s["heading"])
        if k not in seen_src:
            seen_src.add(k)
            sources.append(s)
    reply = re.sub(r"\*\*(.+?)\*\*", r"\1", res["reply"])  # chat shows plain text
    reply = re.sub(r"^\s*[-*]\s+", "• ", reply, flags=re.M).strip()
    return {"reply": reply, "lang": lang, "ui": _dedupe_ui(res.get("ui", [])), "sources": sources, "tools": res.get("tools", []),
            "engine": engine, "engine_label": "Agentic assistant (Groq tool calling)" if engine == "groq" else "Rule-based assistant (no AI model)",
            "note": note, "sim_now": domain.iso(domain.sim_now(db))}
