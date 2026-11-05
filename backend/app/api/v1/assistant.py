"""Mitra assistant endpoints: chat (agentic or rule-based), speech-to-text, text-to-speech, status."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.assistant import agent, speech
from app.assistant.rag import index
from app.db.session import SessionLocal

router = APIRouter(prefix="/assistant")


class ChatIn(BaseModel):
    message: str = Field(..., min_length=1, max_length=1000)
    lang: str | None = None
    context: dict | None = None
    history: list[dict] | None = None


class TTSIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=4500)
    lang: str = "kn"


@router.get("/status")
def status():
    return {"llm": "groq" if agent.groq_available() else "rule_based", "stt": speech.stt_provider(), "tts": speech.tts_provider(),
            "rag": {"retriever": "char n-gram TF-IDF", "chunks": len(index().chunks)},
            "labels": {"groq": "Agentic assistant (Groq tool calling)", "rule_based": "Rule-based assistant (no AI model)"}}


def _chat(body: ChatIn):
    with SessionLocal() as db:
        return agent.chat(db, body.message, body.lang, body.context, body.history)


@router.post("/chat")
async def chat(body: ChatIn):
    return await asyncio.to_thread(_chat, body)


@router.post("/transcribe")
async def transcribe(file: UploadFile = File(...), lang: str = Form("kn")):
    if speech.stt_provider() != "groq_whisper":
        raise HTTPException(503, detail={"error": "stt_unavailable", "message": "Server speech-to-text needs GROQ_API_KEY; use the browser microphone instead."})
    audio = await file.read()
    if len(audio) > 20_000_000:
        raise HTTPException(413, detail={"error": "too_large", "message": "Recording too long"})
    try:
        text = await asyncio.to_thread(speech.transcribe, audio, file.filename or "speech.webm", file.content_type or "audio/webm", lang)
    except Exception as e:
        raise HTTPException(502, detail={"error": "stt_failed", "message": f"Transcription failed ({type(e).__name__})"})
    return {"text": text, "provider": "groq_whisper"}


@router.post("/tts")
async def tts(body: TTSIn):
    if speech.tts_provider() != "google_tts":
        raise HTTPException(501, detail={"error": "tts_unavailable", "message": "No server voice configured; the browser voice is used."})
    try:
        return await asyncio.to_thread(speech.synthesize, body.text, body.lang)
    except Exception as e:
        raise HTTPException(502, detail={"error": "tts_failed", "message": f"Voice synthesis failed ({type(e).__name__})"})
