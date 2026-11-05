"""Kannada female text-to-speech, offline.

Voice: SYSPIN "Kannada Female" VITS model (30 hours of one female speaker), TorchScript, 22.05 kHz.
Source: https://huggingface.co/SYSPIN/tts_vits_coquiai_KannadaFemale  Licence: CC BY 4.0 (credit SYSPIN).
Files expected in backend/models/tts_kn_female/: kn_female_vits_30hrs.pt and chars.txt.

The model only knows Kannada letters and basic punctuation, so digits, %, Rs, degC and Latin letters are first
written out as Kannada words. The tokenizer reproduces the model's training vocabulary
([pad] + punctuations + characters + [blank], blank between every character)."""
from __future__ import annotations

import io
import pathlib
import re
import threading

MODEL_DIR = pathlib.Path(__file__).resolve().parents[2] / "models" / "tts_kn_female"
MODEL_FILE = MODEL_DIR / "kn_female_vits_30hrs.pt"
SAMPLE_RATE = 22050
PUNCT = "!¡'(),-.:;¿? "
CREDIT = "Kannada voice: SYSPIN Kannada Female VITS (CC BY 4.0)"


class Unavailable(Exception):
    pass


_lock = threading.Lock()
_model = None
_char_to_id: dict[str, int] = {}
_blank_id = 0


def available() -> bool:
    return MODEL_FILE.exists() and (MODEL_DIR / "chars.txt").exists()


def _load():
    global _model, _char_to_id, _blank_id
    if _model is not None:
        return
    if not available():
        raise Unavailable("Kannada voice model not installed")
    import torch
    letters = (MODEL_DIR / "chars.txt").read_text(encoding="utf-8").strip("\n")
    vocab = ["<PAD>"] + list(PUNCT) + list(letters) + ["<BLNK>"]
    _char_to_id = {c: i for i, c in enumerate(vocab)}   # duplicates keep their last index, as in training
    _blank_id = _char_to_id["<BLNK>"]
    _model = torch.jit.load(str(MODEL_FILE), map_location="cpu")
    _model.eval()


# ---------------- numbers and symbols to Kannada words ----------------
ONES = ["ಸೊನ್ನೆ", "ಒಂದು", "ಎರಡು", "ಮೂರು", "ನಾಲ್ಕು", "ಐದು", "ಆರು", "ಏಳು", "ಎಂಟು", "ಒಂಬತ್ತು", "ಹತ್ತು", "ಹನ್ನೊಂದು", "ಹನ್ನೆರಡು",
        "ಹದಿಮೂರು", "ಹದಿನಾಲ್ಕು", "ಹದಿನೈದು", "ಹದಿನಾರು", "ಹದಿನೇಳು", "ಹದಿನೆಂಟು", "ಹತ್ತೊಂಬತ್ತು"]
TENS = {2: "ಇಪ್ಪತ್ತು", 3: "ಮೂವತ್ತು", 4: "ನಲವತ್ತು", 5: "ಐವತ್ತು", 6: "ಅರವತ್ತು", 7: "ಎಪ್ಪತ್ತು", 8: "ಎಂಬತ್ತು", 9: "ತೊಂಬತ್ತು"}
HUNDREDS = {1: "ನೂರು", 2: "ಇನ್ನೂರು", 3: "ಮುನ್ನೂರು", 4: "ನಾನೂರು", 5: "ಐನೂರು", 6: "ಆರುನೂರು", 7: "ಏಳುನೂರು", 8: "ಎಂಟುನೂರು", 9: "ಒಂಬೈನೂರು"}
VOWEL_SIGN = {"ಒ": "ೊ", "ಎ": "ೆ", "ಐ": "ೈ", "ಆ": "ಾ", "ಏ": "ೇ"}
LATIN = {"a": "ಎ", "b": "ಬಿ", "c": "ಸಿ", "d": "ಡಿ", "e": "ಇ", "f": "ಎಫ್", "g": "ಜಿ", "h": "ಎಚ್", "i": "ಐ", "j": "ಜೆ", "k": "ಕೆ", "l": "ಎಲ್",
         "m": "ಎಂ", "n": "ಎನ್", "o": "ಒ", "p": "ಪಿ", "q": "ಕ್ಯೂ", "r": "ಆರ್", "s": "ಎಸ್", "t": "ಟಿ", "u": "ಯು", "v": "ವಿ", "w": "ಡಬ್ಲ್ಯೂ",
         "x": "ಎಕ್ಸ್", "y": "ವೈ", "z": "ಜೆಡ್"}
WORDS = {"kg": "ಕೆಜಿ", "km": "ಕಿಲೋಮೀಟರ್", "apmc": "ಎಪಿಎಂಸಿ", "ok": "ಓಕೆ", "truck": "ಟ್ರಕ್", "godown": "ಗೋದಾಮು", "sms": "ಎಸ್ಎಂಎಸ್"}


def _below_100(n: int) -> str:
    if n < 20:
        return ONES[n]
    t, u = divmod(n, 10)
    if u == 0:
        return TENS[t]
    stem, unit = TENS[t][:-1], ONES[u]   # "ಇಪ್ಪತ್ತು" -> "ಇಪ್ಪತ್ತ"
    return stem + VOWEL_SIGN[unit[0]] + unit[1:] if unit[0] in VOWEL_SIGN else stem + unit


def number_words(n: int) -> str:
    """Integer to Kannada words (Indian grouping: ಸಾವಿರ, ಲಕ್ಷ, ಕೋಟಿ)."""
    if n < 0:
        return "ಮೈನಸ್ " + number_words(-n)
    if n < 100:
        return _below_100(n)
    for size, word, joined in ((10_000_000, "ಕೋಟಿ", "ಕೋಟಿ"), (100_000, "ಲಕ್ಷ", "ಲಕ್ಷದ"), (1000, "ಸಾವಿರ", "ಸಾವಿರದ")):
        if n >= size:
            q, r = divmod(n, size)
            head = word if q == 1 and size == 1000 else f"{number_words(q)} {word}"
            return head if r == 0 else f"{head[: -len(word)]}{joined} {number_words(r)}"
    h, r = divmod(n, 100)
    return HUNDREDS[h] if r == 0 else f"{HUNDREDS[h][:-1]} {_below_100(r)}"   # "ಐನೂರು" -> "ಐನೂರ ಐವತ್ತು"


def _num_token(tok: str) -> str:
    tok = tok.replace(",", "")
    if "." in tok:
        a, b = tok.split(".", 1)
        return f"{number_words(int(a or 0))} ಪಾಯಿಂಟ್ " + " ".join(ONES[int(d)] for d in b if d.isdigit())
    return number_words(int(tok))


NUM = r"\d+(?:,\d{2,3})*(?:\.\d+)?"


def to_speakable(text: str) -> str:
    t = re.sub(rf"(?:₹|Rs\.?)\s*({NUM})", r"\1 ರೂಪಾಯಿ", text)   # amount first, as spoken
    t = t.replace("₹", " ರೂಪಾಯಿ ").replace("°C", " ಡಿಗ್ರಿ ").replace("°", " ಡಿಗ್ರಿ ")
    t = re.sub(rf"({NUM})\s*%", lambda m: f"ಶೇಕಡಾ {m.group(1)}", t)
    t = re.sub(r"(\d+)\s*[-–]\s*(\d+)", r"\1 ರಿಂದ \2", t)
    t = re.sub(NUM, lambda m: f" {_num_token(m.group(0))} ", t)
    t = re.sub(r"[A-Za-z]+", lambda m: WORDS.get(m.group(0).lower(), "".join(LATIN[c] for c in m.group(0).lower())), t)
    t = t.replace("‌", "").replace("‍", "").replace("‑", " ").replace("—", ", ").replace("–", ", ")
    return re.sub(r"\s+", " ", t).strip()


def _ids(text: str) -> list[int]:
    t = text.lower().replace(";", ",").replace("-", " ").replace(":", ",")
    t = re.sub(r"[<>()\[\]\"]+", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    seq = [_char_to_id[c] for c in t if c in _char_to_id]
    out = [_blank_id] * (len(seq) * 2 + 1)
    out[1::2] = seq
    return out


def warm_up():
    """Load the model in the background so the first spoken reply is not delayed."""
    if available():
        threading.Thread(target=_safe_load, daemon=True).start()


def _safe_load():
    try:
        with _lock:
            _load()
    except Exception:   # never break startup over the optional voice
        pass


def synthesize(text: str) -> bytes:
    """Kannada text -> 16-bit mono WAV bytes. Sentences are synthesised one by one and joined with short pauses."""
    import numpy as np
    import torch
    from scipy.io import wavfile
    with _lock:
        _load()
        parts = [p.strip() for p in re.split(r"(?<=[.!?।])\s+", to_speakable(text)) if p.strip()]
        audio = []
        for p in parts[:12]:
            ids = _ids(p)
            if len(ids) < 3:
                continue
            with torch.no_grad():
                wav = _model(torch.tensor([ids], dtype=torch.long)).squeeze().cpu().numpy()
            audio += [wav, np.zeros(int(0.25 * SAMPLE_RATE), dtype=np.float32)]
    if not audio:
        raise Unavailable("Nothing speakable in the text")
    pcm = np.concatenate(audio)
    pcm = np.int16(np.clip(pcm / max(1e-6, float(np.abs(pcm).max())) * 0.9, -1, 1) * 32767)
    buf = io.BytesIO()
    wavfile.write(buf, SAMPLE_RATE, pcm)
    return buf.getvalue()
