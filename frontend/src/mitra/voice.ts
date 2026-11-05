import { api } from "../lib/api";
import { useMitra } from "./store";

let audioEl: HTMLAudioElement | null = null;
let raf = 0;

export function stopSpeaking() {
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
  if (audioEl) { audioEl.pause(); audioEl = null; }
  cancelAnimationFrame(raf);
  useMitra.getState().setPhase("idle");
}

function hasVoice(lang: string) {
  const vs = window.speechSynthesis?.getVoices() || [];
  return vs.find((v) => v.lang.toLowerCase().startsWith(lang === "kn" ? "kn" : "en-in")) || (lang === "en" ? vs.find((v) => v.lang.startsWith("en")) : undefined);
}

export function browserCanSpeak(lang: string) {
  return !!window.speechSynthesis && !!hasVoice(lang);
}

/** Speaks a reply. Server voice (Google TTS) drives the mouth from the real audio level; the browser voice
 *  falls back to a gentle animated mouth. Returns false when no voice for the language exists. */
export async function speak(text: string, lang: string, provider: string): Promise<boolean> {
  stopSpeaking();
  const S = useMitra.getState();
  if (provider === "google_tts") {
    try {
      const r = await api("/assistant/tts", { method: "POST", json: { text, lang } });
      const el = new Audio(`data:${r.mime};base64,${r.audio_b64}`);
      audioEl = el;
      const ctx = new AudioContext();
      const src = ctx.createMediaElementSource(el);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an); an.connect(ctx.destination);
      const buf = new Uint8Array(an.fftSize);
      const loop = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        useMitra.setState({ level: Math.min(1, Math.sqrt(sum / buf.length) * 4) });
        raf = requestAnimationFrame(loop);
      };
      el.onplay = () => { S.setPhase("speaking"); loop(); };
      el.onended = () => { cancelAnimationFrame(raf); ctx.close(); S.setPhase("idle"); };
      await el.play();
      return true;
    } catch {
      /* fall through to the browser voice */
    }
  }
  if (!window.speechSynthesis) return false;
  const voice = hasVoice(lang);
  if (!voice) return false;
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = 0.95;
  u.onstart = () => S.setPhase("speaking");
  u.onboundary = () => useMitra.setState({ level: 0.7 }); // brief mouth pulse on each word
  u.onend = () => S.setPhase("idle");
  u.onerror = () => S.setPhase("idle");
  window.speechSynthesis.speak(u);
  return true;
}

// ---------- listening ----------
export function browserRecognizer(): any {
  const W = window as any;
  return W.SpeechRecognition || W.webkitSpeechRecognition || null;
}

export function listenBrowser(lang: string, onText: (text: string, final: boolean) => void, onEnd: () => void) {
  const R = browserRecognizer();
  const rec = new R();
  rec.lang = lang === "kn" ? "kn-IN" : "en-IN";
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.onresult = (e: any) => {
    let text = "", final = false;
    for (let i = e.resultIndex; i < e.results.length; i++) { text += e.results[i][0].transcript; final = final || e.results[i].isFinal; }
    onText(text, final);
  };
  rec.onerror = () => onEnd();
  rec.onend = () => onEnd();
  rec.start();
  return () => { try { rec.stop(); } catch { /* ignore */ } };
}

/** Records the microphone for server-side Whisper transcription. Returns a stop() that resolves to the audio blob. */
export async function recordAudio(): Promise<() => Promise<Blob>> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.start();
  return () => new Promise((resolve) => {
    rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" })); };
    rec.stop();
  });
}
