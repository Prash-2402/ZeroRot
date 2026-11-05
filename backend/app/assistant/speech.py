"""Speech adapters. Speech-to-text: Groq Whisper (whisper-large-v3, supports Kannada) when GROQ_API_KEY is set;
otherwise the browser's own speech recognition is used. Text-to-speech: Google Cloud TTS (kn-IN / en-IN) when
GOOGLE_TTS_API_KEY is set; otherwise the browser voice. Keys stay on the server."""
from __future__ import annotations

import httpx

from app.core.config import env, settings

STT_MODEL = env("GROQ_STT_MODEL", "whisper-large-v3")
GOOGLE_TTS_KEY = env("GOOGLE_TTS_API_KEY")
VOICES = {"kn": ("kn-IN", env("GOOGLE_TTS_VOICE_KN", "kn-IN-Standard-A")), "en": ("en-IN", env("GOOGLE_TTS_VOICE_EN", "en-IN-Standard-A"))}


def stt_provider() -> str:
    return "groq_whisper" if settings.groq_api_key else "browser"


def tts_provider() -> str:
    return "google_tts" if GOOGLE_TTS_KEY else "browser"


def transcribe(audio: bytes, filename: str, mime: str, lang: str) -> str:
    r = httpx.post("https://api.groq.com/openai/v1/audio/transcriptions",
                   headers={"Authorization": f"Bearer {settings.groq_api_key}"},
                   files={"file": (filename, audio, mime or "audio/webm")},
                   data={"model": STT_MODEL, "language": "kn" if lang == "kn" else "en", "response_format": "json", "temperature": "0"},
                   timeout=30)
    r.raise_for_status()
    return (r.json().get("text") or "").strip()


def synthesize(text: str, lang: str) -> dict:
    code, name = VOICES["kn" if lang == "kn" else "en"]
    r = httpx.post(f"https://texttospeech.googleapis.com/v1/text:synthesize?key={GOOGLE_TTS_KEY}",
                   json={"input": {"text": text[:4500]}, "voice": {"languageCode": code, "name": name},
                         "audioConfig": {"audioEncoding": "MP3", "speakingRate": 0.95}}, timeout=15)
    r.raise_for_status()
    return {"audio_b64": r.json()["audioContent"], "mime": "audio/mpeg", "voice": name}
