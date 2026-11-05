"""Rule-based Mitra: keyword intents in Kannada and English, answered with the same tools and engine.
Used when no Groq key is configured or the model is unreachable. Labelled 'Rule-based assistant'."""
from __future__ import annotations

import re

from sqlalchemy.orm import Session

from app.engine.format import inr
from . import tools

CROP_KN = {"tomato": "ಟೊಮೇಟೊ", "mango": "ಮಾವು", "banana": "ಬಾಳೆಹಣ್ಣು"}
CROP_EN = {"tomato": "tomatoes", "mango": "mangoes", "banana": "bananas"}
PLACE_KN = {"shed": "ಶೆಡ್", "cold": "ಶೀತಲ ಸಂಗ್ರಹ", "truck": "ಮಂಡಿ ಲಾರಿ", "yard": "ಜಮೀನು"}
ACTION_KN = {"SELL": "ಈಗ ಮಾರಾಟ ಮಾಡಿ", "STORE": "ಶೀತಲ ಸಂಗ್ರಹದಲ್ಲಿ ಇಡಿ", "SHIP": "ಬೇರೆ ಮಂಡಿಗೆ ಕಳುಹಿಸಿ"}
COND_KN = {"normal": "ಸಾಮಾನ್ಯ ಮಾರುಕಟ್ಟೆ", "price_crash": "ಬೆಲೆ ಕುಸಿತ", "festival": "ಹಬ್ಬದ ಬೇಡಿಕೆ", "heavy_rain": "ಭಾರಿ ಮಳೆ"}
PERIOD_KN = {"Today": "ಇಂದು", "Day 2": "2ನೇ ದಿನ", "Day 4": "4ನೇ ದಿನ", "Day 7": "7ನೇ ದಿನ"}


def has(text: str, words) -> bool:
    return any(w in text for w in words)


def days_txt(d, lang, beyond=False):
    if beyond or d is None:
        return "30 ದಿನಗಳಿಗಿಂತ ಹೆಚ್ಚು" if lang == "kn" else "more than 30 days"
    if d < 1:
        h = max(0, round(d * 24))
        return f"{h} ಗಂಟೆ" if lang == "kn" else f"{h} hours"
    return f"{d:.1f} ದಿನ" if lang == "kn" else f"{d:.1f} days"


def crop(p, lang):
    return CROP_KN.get(p, p) if lang == "kn" else CROP_EN.get(p, p)


def number_of_days(text: str):
    m = re.search(r"(\d+(?:\.\d+)?)", text)
    if m:
        return float(m.group(1))
    if has(text, ["tomorrow", "ನಾಳೆ"]):
        return 1.0
    if has(text, ["week", "ವಾರ"]):
        return 7.0
    return None


def respond(db: Session, message: str, lang: str, context_batch: str | None):
    text = message.lower().strip()
    out = {"reply": "", "ui": [], "sources": [], "tools": []}

    def call(name, **args):
        r = tools.run_tool(db, name, args, context_batch)
        out["tools"].append({"name": name, "args": args})
        out["ui"] += r.get("ui", [])
        out["sources"] += r.get("sources", [])
        return r["data"]

    crop_words = {"tomato": ["tomato", "ಟೊಮೇಟೊ", "ಟೊಮ್ಯಾಟೊ", "ಟೊಮೆಟೊ"], "mango": ["mango", "ಮಾವು", "ಮಾವಿನ"], "banana": ["banana", "ಬಾಳೆ"]}
    mentioned = next((p for p, ws in crop_words.items() if has(text, ws)), None)
    ref = mentioned

    if has(text, ["ಕನ್ನಡ", "kannada"]) and len(text) < 40:
        out["ui"].append({"type": "lang", "lang": "kn"})
        out["reply"] = "ಸರಿ, ಈಗಿನಿಂದ ಕನ್ನಡದಲ್ಲಿ ಮಾತನಾಡುತ್ತೇನೆ."
        return out
    if has(text, ["english", "ಇಂಗ್ಲಿಷ್", "ಇಂಗ್ಲೀಷ್"]) and len(text) < 40:
        out["ui"].append({"type": "lang", "lang": "en"})
        out["reply"] = "Okay, I will speak in English now."
        return out
    if has(text, ["hello", "hi ", "namaskara", "ನಮಸ್ಕಾರ", "ಹಲೋ", "ನಮಸ್ತೆ"]) or text in ("hi", "hey"):
        out["reply"] = ("ನಮಸ್ಕಾರ! ನಾನು ಮಿತ್ರ. ನಿಮ್ಮ ಟೊಮೇಟೊ, ಮಾವು ಮತ್ತು ಬಾಳೆಹಣ್ಣಿನ ಗುಣಮಟ್ಟ, ಉಳಿದ ದಿನಗಳು ಮತ್ತು ಮೌಲ್ಯದ ಬಗ್ಗೆ ಕೇಳಿ."
                        if lang == "kn" else "Hello! I'm Mitra. Ask me about the quality, days left and value of your tomatoes, mangoes and bananas.")
        return out

    # general "why / what is" questions go to the knowledge library first
    if has(text, ["why", "what is", "what does", "explain", "meaning", "how does", "ಏಕೆ", "ಯಾಕೆ", "ಎಂದರೇನು", "ಅಂದರೆ ಏನು", "ವಿವರಿಸ"]) and not has(text, ["how many", "ಎಷ್ಟು"]):
        d = call("knowledge", query=message)
        if d["passages"]:
            p = d["passages"][0]
            body = (p["text_kn"] or p["text_en"]) if lang == "kn" else (p["text_en"] or p["text_kn"])
            out["reply"] = body + (f" (ಮೂಲ: {p['source']})" if lang == "kn" else f" (Source: {p['source']})")
            return out

    # mandi truck, breakdown, reroute
    if has(text, ["truck", "lorry", "ಲಾರಿ", "ಟ್ರಕ್", "reroute", "route", "ಮಾರ್ಗ", "breakdown", "ವೈಫಲ್ಯ", "approve", "ಅನುಮೋದ", "hand over", "handover", "ಹಸ್ತಾಂತರ"]):
        d = call("truck")
        st = d.get("state")
        if st == "parked":
            out["reply"] = ("ಮಂಡಿ ಕಂಪನಿಯ ಲಾರಿ ನಿಮ್ಮ ಜಮೀನಿನಲ್ಲಿ ಕಾಯುತ್ತಿದೆ. ಬಾಳೆಹಣ್ಣನ್ನು ಹಸ್ತಾಂತರಿಸಲು ಕೆಳಗಿನ ಬಟನ್ ಒತ್ತಿ."
                            if lang == "kn" else "The mandi company's truck is waiting at your farm. Tap the button below to hand over the bananas.")
        elif d.get("reroute_proposal"):
            p = d["reroute_proposal"]
            out["reply"] = (f"ಲಾರಿಯ ಶೀತಲೀಕರಣ ವಿಫಲವಾಗಿದೆ. {p['target_name']} ಕಡೆಗೆ ತಿರುಗಿಸಿದರೆ ಸುಮಾರು {inr(p['expected_net'])} ಸಿಗುತ್ತದೆ, ಹೀಗೆಯೇ ಮುಂದುವರಿದರೆ {inr(p['continue_net'])}. ಅನುಮೋದಿಸಲು ಬಟನ್ ಒತ್ತಿ."
                            if lang == "kn" else f"The truck's cooling failed. Diverting to {p['target_name']} gives about {inr(p['expected_net'])}, versus {inr(p['continue_net'])} if it continues. Tap the button to approve.")
        elif d.get("value_protected") is not None:
            out["reply"] = (f"ಹೊಸ ಮಾರ್ಗ ಅನುಮೋದಿಸಲಾಗಿದೆ. ಅಂದಾಜು {inr(d['value_protected'])} ಉಳಿತಾಯ (ಅನುಕರಣೆಯ ಅಂದಾಜು)."
                            if lang == "kn" else f"The new route is approved. Estimated {inr(d['value_protected'])} protected (simulation estimate).")
        else:
            temp = d.get("cargo_temp")
            prog = round((d.get("progress") or 0) * 100)
            failed = d.get("reefer_status") == "failed"
            out["reply"] = (f"ಲಾರಿ {d.get('dest_name')} ಕಡೆಗೆ ಹೋಗುತ್ತಿದೆ, {prog}% ದಾರಿ ಮುಗಿದಿದೆ. ಸರಕು ತಾಪಮಾನ {temp:.1f} °C." + (" ಶೀತಲೀಕರಣ ವಿಫಲವಾಗಿದೆ, ಆಯ್ಕೆಗಳನ್ನು ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ." if failed else "")
                            if lang == "kn" else f"The truck is on the way to {d.get('dest_name')}, {prog}% done. Cargo is at {temp:.1f} °C." + (" Cooling has failed; options are being checked." if failed else ""))
        return out

    # when to sell (market conditions)
    if has(text, ["when", "ಯಾವಾಗ", "festival", "ಹಬ್ಬ", "crash", "ಕುಸಿತ", "rain", "ಮಳೆ"]):
        cond = "festival" if has(text, ["festival", "ಹಬ್ಬ"]) else "price_crash" if has(text, ["crash", "ಕುಸಿತ", "fall", "ಇಳಿ"]) else "heavy_rain" if has(text, ["rain", "ಮಳೆ"]) else "normal"
        d = call("when_to_sell", batch=ref or "mango", condition=cond)
        best = next(x for x in d["periods"] if x["label"] == d["recommended"])
        out["reply"] = (f"{COND_KN[cond]} ಇದ್ದರೆ, {PERIOD_KN[best['label']]} ಮಾರುವುದು ಉತ್ತಮ: ಸುಮಾರು {inr(best['net'])} ಸಿಗುತ್ತದೆ, ಗುಣಮಟ್ಟ {best['quality']:.0f}%. ಬೆಲೆಗಳು ಅನುಕರಿತ ಅಂದಾಜು."
                        if lang == "kn" else f"With a {cond.replace('_', ' ')} market, selling {best['label'].lower() if best['label'] == 'Today' else 'on ' + best['label']} is best: about {inr(best['net'])} at {best['quality']:.0f}% quality. Prices are simulated scenarios.")
        return out

    # what if I keep it cool
    if has(text, ["cool", "cold", "fridge", "ತಂಪು", "ತಣ್ಣ", "ಶೀತಲ"]) and has(text, ["if", "what", "ರೆ", "ಏನಾಗ", "ಹೇಗೆ"]):
        d = call("what_if", batch=ref, change="keep_cool")
        if "error" in d:
            out["reply"] = "ಯಾವ ಬೆಳೆ? ಟೊಮೇಟೊ, ಮಾವು ಅಥವಾ ಬಾಳೆಹಣ್ಣು?" if lang == "kn" else "Which crop: tomatoes, mangoes or bananas?"
            return out
        a, b = d["now"], d["if_you_do_this"]
        out["reply"] = (f"ತಂಪಾಗಿ ಇಟ್ಟರೆ ಉಳಿದ ದಿನಗಳು {days_txt(a['shelf_life_days'], lang)} ಇಂದ {days_txt(b['shelf_life_days'], lang)} ಆಗುತ್ತದೆ. 3 ದಿನದ ನಂತರ ಮೌಲ್ಯ {inr(b['value_at'])} (ಈಗಿನ ರೀತಿಯಲ್ಲಿ {inr(a['value_at'])})."
                        if lang == "kn" else f"Kept cool, days left go from {days_txt(a['shelf_life_days'], lang)} to {days_txt(b['shelf_life_days'], lang)}. Value after 3 days: {inr(b['value_at'])} instead of {inr(a['value_at'])}.")
        return out

    # future after N days
    n = number_of_days(text)
    if n is not None and has(text, ["day", "ದಿನ", "after", "ನಂತರ", "tomorrow", "ನಾಳೆ", "week", "ವಾರ"]) and not has(text, ["how many", "ಎಷ್ಟು ದಿನ"]):
        d = call("future", batch=ref, days=n)
        if "error" not in d:
            out["reply"] = (f"{d['day']:.0f} ದಿನದ ನಂತರ ಗುಣಮಟ್ಟ {d['quality']:.0f}% (ಈಗ {d['today']['quality']:.0f}%), ಮೌಲ್ಯ {inr(d['value'])} (ಈಗ {inr(d['today']['value'])})."
                            if lang == "kn" else f"After {d['day']:.0f} days quality will be {d['quality']:.0f}% (now {d['today']['quality']:.0f}%) and value {inr(d['value'])} (now {inr(d['today']['value'])}).")
            return out

    # what should I do / choices
    if has(text, ["what should", "what to do", "sell", "ship", "store", "choice", "option", "ಏನು ಮಾಡ", "ಮಾರ", "ಕಳುಹಿಸ", "ಆಯ್ಕೆ", "ಸಲಹೆ"]):
        if ref is None and context_batch is None:
            ref = call("farm_overview")["most_urgent"]
        d = call("choices", batch=ref)
        if "error" not in d:
            rec = d["options"].get(d["recommended"], {})
            out["reply"] = (f"ಶಿಫಾರಸು: {ACTION_KN.get(d['recommended'], d['recommended'])} ({rec.get('market', '')}). ಸುಮಾರು {inr(rec.get('net'))} ಸಿಗುತ್ತದೆ, ಗುಣಮಟ್ಟ {rec.get('quality_at_sale', 0):.0f}%. ಎಲ್ಲಾ ಆಯ್ಕೆಗಳನ್ನು ಪರದೆಯ ಮೇಲೆ ತೋರಿಸಿದ್ದೇನೆ."
                            if lang == "kn" else f"{d['explanation']} All your choices are on screen now.")
            return out

    # status questions: days left, quality, value
    status_words = ["how many days", "how long", "last", "days left", "shelf", "quality", "worth", "value", "price", "condition", "how is", "status",
                    "ಎಷ್ಟು ದಿನ", "ಉಳಿ", "ಗುಣಮಟ್ಟ", "ಮೌಲ್ಯ", "ಬೆಲೆ", "ಎಷ್ಟು ಹಣ", "ಹೇಗಿದೆ", "ಸ್ಥಿತಿ"]
    if has(text, status_words) or mentioned:
        if ref is None and context_batch is None:
            d = call("farm_overview")
            parts = [f"{crop(r['produce'], lang)}: {days_txt(r['days_left'], lang)}" for r in d["batches"]]
            out["reply"] = ("ನಿಮ್ಮ ಸರಕುಗಳ ಉಳಿದ ದಿನಗಳು — " if lang == "kn" else "Days left for your produce — ") + "; ".join(parts) + "."
            return out
        d = call("batch_status", batch=ref)
        if "error" not in d:
            rng = "" if d["beyond_horizon"] else (f" ({d['days_p10']:.1f}–{d['days_p90']:.1f})")
            out["reply"] = (f"ನಿಮ್ಮ {crop(d['produce'], lang)}: ಗುಣಮಟ್ಟ {d['quality']:.0f}%, ಉಳಿದ ದಿನಗಳು {days_txt(d['days_left'], lang, d['beyond_horizon'])}{rng}, ಇಂದಿನ ಮೌಲ್ಯ {inr(d['value_now'])}. ಶಿಫಾರಸು: {ACTION_KN.get(d['recommended_action']['kind'], '')}."
                            if lang == "kn" else f"Your {crop(d['produce'], lang)}: quality {d['quality']:.0f}%, {days_txt(d['days_left'], lang, d['beyond_horizon'])}{rng} left, worth {inr(d['value_now'])} today. Recommended: {d['recommended_action']['label']}.")
            if d.get("weather_based"):
                out["reply"] += (" ಶೆಡ್ ತಾಪಮಾನ ಹವಾಮಾನದಿಂದ ಅಂದಾಜು; ಅಳೆದ ತಾಪಮಾನ ನಮೂದಿಸಿದರೆ ಉತ್ತರ ಉತ್ತಮವಾಗುತ್ತದೆ." if lang == "kn"
                                 else " The shed temperature is estimated from weather; enter a measured reading for a better answer.")
            return out

    # navigation
    for place, words in {"shed": ["shed", "ಶೆಡ್"], "cold": ["cold", "storage", "ಶೀತಲ"], "truck": ["truck", "ಲಾರಿ"], "yard": ["farm", "home", "ಜಮೀನು", "ಮನೆ"]}.items():
        if has(text, words) and has(text, ["show", "open", "go", "take", "ತೋರಿಸ", "ತೆರೆ", "ಹೋಗು"]):
            call("navigate", place=place)
            out["reply"] = f"{PLACE_KN[place]} ತೋರಿಸುತ್ತಿದ್ದೇನೆ." if lang == "kn" else f"Showing the {({'shed': 'farm shed', 'cold': 'cold storage', 'truck': 'mandi truck', 'yard': 'farm'})[place]}."
            return out

    # general knowledge (RAG)
    d = call("knowledge", query=message)
    if d["passages"]:
        p = d["passages"][0]
        body = (p["text_kn"] or p["text_en"]) if lang == "kn" else (p["text_en"] or p["text_kn"])
        out["reply"] = body + (f" (ಮೂಲ: {p['source']})" if lang == "kn" else f" (Source: {p['source']})")
        return out
    out["reply"] = ("ಕ್ಷಮಿಸಿ, ಅರ್ಥವಾಗಲಿಲ್ಲ. ನಿಮ್ಮ ಟೊಮೇಟೊ, ಮಾವು ಅಥವಾ ಬಾಳೆಹಣ್ಣು ಎಷ್ಟು ದಿನ ಉಳಿಯುತ್ತದೆ, ಎಷ್ಟು ಮೌಲ್ಯ, ಯಾವಾಗ ಮಾರಬೇಕು ಎಂದು ಕೇಳಿ."
                    if lang == "kn" else "Sorry, I didn't understand. Ask how many days your tomatoes, mangoes or bananas will last, what they're worth, or when to sell.")
    return out
