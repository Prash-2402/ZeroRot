import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, Mic, MicOff, Send, ShieldCheck, Volume2, VolumeX, X, PackageCheck } from "lucide-react";
import { api, post } from "../lib/api";
import { useLang, useT } from "../lib/i18n";
import { useUI, type Place } from "../stores/ui";
import { cn, Spinner } from "../components/ui";
import { MitraFace } from "./MitraFace";
import { useMitra } from "./store";
import { browserCanSpeak, browserRecognizer, listenBrowser, recordAudio, speak, stopSpeaking } from "./voice";

const SUGGEST = {
  en: ["How many days will my tomatoes last?", "What should I do with my mangoes?", "When should I sell mangoes during the festival?", "Where is the mandi truck?", "Why do bananas get damaged in cold?"],
  kn: ["ನನ್ನ ಟೊಮೇಟೊ ಎಷ್ಟು ದಿನ ಉಳಿಯುತ್ತದೆ?", "ಮಾವಿನ ಬಗ್ಗೆ ಏನು ಮಾಡಬೇಕು?", "ಹಬ್ಬದ ಸಮಯದಲ್ಲಿ ಮಾವು ಯಾವಾಗ ಮಾರಬೇಕು?", "ಮಂಡಿ ಲಾರಿ ಎಲ್ಲಿದೆ?", "ಬಾಳೆಹಣ್ಣು ತಣ್ಣಗೆ ಏಕೆ ಹಾಳಾಗುತ್ತದೆ?"],
};
const TXT = {
  name: ["Mitra", "ಮಿತ್ರ"], sub: ["Your farm assistant", "ನಿಮ್ಮ ಕೃಷಿ ಸಹಾಯಕ"], ask: ["Ask Mitra…", "ಮಿತ್ರನನ್ನು ಕೇಳಿ…"],
  listening: ["Listening…", "ಕೇಳುತ್ತಿದ್ದೇನೆ…"], thinking: ["Thinking…", "ಯೋಚಿಸುತ್ತಿದ್ದೇನೆ…"], speaking: ["Speaking…", "ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ…"],
  idle: ["Tap the mic and speak", "ಮೈಕ್ ಒತ್ತಿ ಮಾತನಾಡಿ"], tryAsk: ["Try asking", "ಹೀಗೆ ಕೇಳಿ ನೋಡಿ"], sources: ["Sources", "ಮೂಲಗಳು"],
  noVoice: ["This device has no Kannada voice, so the answer is shown as text.", "ಈ ಸಾಧನದಲ್ಲಿ ಕನ್ನಡ ಧ್ವನಿ ಇಲ್ಲ, ಉತ್ತರವನ್ನು ಅಕ್ಷರಗಳಲ್ಲಿ ತೋರಿಸಲಾಗಿದೆ."],
  noMic: ["Voice input is not available in this browser. Type your question.", "ಈ ಬ್ರೌಸರ್‌ನಲ್ಲಿ ಧ್ವನಿ ಇನ್‌ಪುಟ್ ಇಲ್ಲ. ಪ್ರಶ್ನೆಯನ್ನು ಟೈಪ್ ಮಾಡಿ."],
  handover: ["Hand over to mandi truck", "ಮಂಡಿ ಲಾರಿಗೆ ಹಸ್ತಾಂತರಿಸಿ"], approve: ["Approve new route", "ಹೊಸ ಮಾರ್ಗ ಅನುಮೋದಿಸಿ"],
  done: ["Done.", "ಆಯಿತು."], ai: ["AI · Groq", "AI · Groq"], rules: ["Rule-based (no AI key)", "ನಿಯಮ ಆಧಾರಿತ (AI ಕೀ ಇಲ್ಲ)"],
};

export function MitraPanel() {
  const { lang, setLang } = useLang();
  const { t } = useT();
  const L = (k: keyof typeof TXT) => TXT[k][lang === "kn" ? 1 : 0];
  const { open, setOpen, phase, setPhase, msgs, push } = useMitra();
  const ui = useUI();
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const { data: status } = useQuery({ queryKey: ["mitra-status"], queryFn: () => api("/assistant/status"), staleTime: 60000 });
  const [input, setInput] = useState("");
  const [interim, setInterim] = useState("");
  const [voiceOn, setVoiceOn] = useState(true);
  const [warn, setWarn] = useState<string | null>(null);
  const stopRef = useRef<null | (() => any)>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const done = useRef<Set<string>>(new Set());
  useEffect(() => { listRef.current?.scrollTo({ top: 1e6, behavior: "smooth" }); }, [msgs, phase, interim]);
  useEffect(() => { window.speechSynthesis?.getVoices(); }, []);
  useEffect(() => { if (!open) { stopSpeaking(); stopRef.current?.(); } }, [open]);

  const runActions = (actions: any[]) => {
    if (!actions?.length) return;
    if (loc.pathname !== "/") nav("/");
    for (const a of actions) {
      if (a.type === "lang") setLang(a.lang);
      if (a.type === "focus") ui.setFocus(a.place as Place, a.batch_id ?? null);
    }
    setTimeout(() => {
      for (const a of actions) {
        if (a.type === "future") useUI.getState().setFuture(a.index);
        if (a.type === "open_choices") useUI.getState().openDecide(a.batch_id);
      }
    }, 700);
  };

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || phase === "thinking") return;
    stopSpeaking();
    setInput(""); setInterim(""); setWarn(null);
    push({ role: "user", text: q, lang });
    setPhase("thinking");
    try {
      const history = useMitra.getState().msgs.slice(-6).map((m) => ({ role: m.role, content: m.text }));
      const r = await api("/assistant/chat", { method: "POST", json: { message: q, lang, history, context: { focus: useUI.getState().focus, batch_id: useUI.getState().batchId } }, timeoutMs: 30000 });
      push({ role: "assistant", text: r.reply, lang: r.lang, sources: r.sources, ui: r.ui, engine: r.engine, note: r.note });
      setPhase("idle");
      runActions(r.ui);
      if (voiceOn) {
        const ok = await speak(r.reply, r.lang, status?.tts || "browser");
        if (!ok && r.lang === "kn") setWarn(L("noVoice"));
      }
    } catch (e: any) {
      setPhase("idle");
      push({ role: "assistant", text: e.message || "Error", lang });
    }
  };

  const toggleMic = async () => {
    if (phase === "listening") { stopRef.current?.(); return; }
    stopSpeaking();
    setWarn(null);
    if (status?.stt === "groq_whisper" && "mediaDevices" in navigator) {
      try {
        const stop = await recordAudio();
        setPhase("listening");
        stopRef.current = async () => {
          stopRef.current = null;
          const blob = await stop();
          setPhase("thinking");
          const fd = new FormData();
          fd.append("file", blob, "speech.webm");
          fd.append("lang", lang);
          const res = await fetch("/api/v1/assistant/transcribe", { method: "POST", body: fd });
          const d = await res.json();
          setPhase("idle");
          if (res.ok && d.text) ask(d.text); else setWarn(d?.detail?.message || L("noMic"));
        };
        return;
      } catch { /* fall back to the browser recogniser */ }
    }
    if (!browserRecognizer()) { setWarn(L("noMic")); return; }
    setPhase("listening");
    let last = "";
    stopRef.current = listenBrowser(lang, (text, final) => { last = text; setInterim(text); if (final) { stopRef.current?.(); } }, () => {
      stopRef.current = null;
      setPhase("idle");
      setInterim("");
      if (last.trim()) ask(last);
    });
  };

  const confirm = async (a: any, key: string) => {
    done.current.add(key);
    if (a.action === "handover") { useUI.getState().setFocus("truck", a.batch_id); useUI.getState().startLoading(); await post(`/farm/handover/${a.batch_id}`); }
    if (a.action === "approve_reroute") await post(`/trips/${a.trip_id}/approve-reroute`, { via: "Mitra assistant" });
    qc.invalidateQueries({ queryKey: ["farm"] });
    push({ role: "assistant", text: L("done"), lang });
  };

  const statusText = phase === "idle" ? L("idle") : L(phase);
  return (
    <>
      <AnimatePresence>
        {!open && (
          <motion.button initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }} onClick={() => setOpen(true)}
            className="pointer-events-auto fixed bottom-24 left-3 z-40 flex items-center gap-2 rounded-full bg-forest py-2 pl-2 pr-4 text-cream-50 shadow-[0_6px_0_#112B21] hover:bg-forest-800 sm:bottom-6">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-cream-50 text-2xl">👳🏽</span>
            <span className="text-left leading-tight"><span className="block text-base font-extrabold">{L("name")}</span><span className="block text-[10px] opacity-80">{L("sub")}</span></span>
            <Mic className="ml-1 h-4 w-4 opacity-80" />
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {open && (
          <motion.aside initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -40, opacity: 0 }}
            className="fixed bottom-3 left-3 right-3 top-auto z-40 flex max-h-[80dvh] flex-col overflow-hidden rounded-3xl bg-cream-50/95 shadow-2xl backdrop-blur sm:right-auto sm:top-20 sm:max-h-none sm:w-[380px]">
            <div className="relative bg-gradient-to-b from-forest-50 to-cream-50">
              <MitraFace className="h-44 w-full" />
              <div className="absolute left-4 top-3">
                <div className="text-xl font-extrabold text-forest">{L("name")}</div>
                <div className="text-[11px] text-charcoal-500">{L("sub")}</div>
              </div>
              <div className="absolute right-3 top-3 flex gap-1.5">
                <button onClick={() => { setVoiceOn(!voiceOn); if (voiceOn) stopSpeaking(); }} className="rounded-full bg-white/90 p-2 text-forest shadow-sm" aria-label="voice">
                  {voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                </button>
                <button onClick={() => setOpen(false)} className="rounded-full bg-white/90 p-2 text-forest shadow-sm" aria-label={t("close")}><X className="h-4 w-4" /></button>
              </div>
              <div className="absolute bottom-2 left-0 right-0 flex justify-center">
                <span className={cn("rounded-full px-3 py-1 text-xs font-bold", phase === "listening" ? "bg-rot text-white" : phase === "idle" ? "bg-white/90 text-forest" : "bg-forest text-cream-50")}>
                  {phase === "thinking" && <Spinner className="mr-1 inline h-3 w-3" />}{statusText}
                </span>
              </div>
            </div>
            <div ref={listRef} className="min-h-[120px] flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {msgs.length === 0 && (
                <div>
                  <div className="mb-2 text-xs font-bold uppercase tracking-wide text-charcoal-400">{L("tryAsk")}</div>
                  <div className="flex flex-col gap-1.5">
                    {SUGGEST[lang].map((s) => (
                      <button key={s} onClick={() => ask(s)} className="rounded-2xl border border-forest/15 bg-white px-3 py-2 text-left text-sm text-forest hover:border-forest/40">{s}</button>
                    ))}
                  </div>
                </div>
              )}
              {msgs.map((m) => (
                <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed", m.role === "user" ? "rounded-br-sm bg-forest text-cream-50" : "rounded-bl-sm bg-white text-charcoal shadow-sm", m.lang === "kn" && "kn")}>
                    {m.text}
                    {m.ui?.filter((a) => a.type === "confirm").map((a, i) => {
                      const key = `${m.id}-${i}`;
                      return (
                        <button key={key} disabled={done.current.has(key)} onClick={() => confirm(a, key)}
                          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-forest px-3 py-2.5 text-sm font-bold text-cream-50 disabled:opacity-50">
                          {a.action === "handover" ? <PackageCheck className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}{a.action === "handover" ? L("handover") : L("approve")}
                        </button>
                      );
                    })}
                    {m.sources && m.sources.length > 0 && (
                      <details className="mt-2 text-[11px] text-charcoal-400">
                        <summary className="flex cursor-pointer items-center gap-1"><BookOpen className="h-3 w-3" />{L("sources")} ({m.sources.length})</summary>
                        {m.sources.map((s: any, i: number) => (
                          <div key={i} className="mt-1">• {s.heading} — {s.url?.startsWith("http") ? <a href={s.url} target="_blank" rel="noreferrer" className="text-leaf-600 underline">{s.source}</a> : s.source}</div>
                        ))}
                      </details>
                    )}
                    {m.role === "assistant" && m.engine && <div className="mt-1 text-[10px] text-charcoal-300">{m.engine === "groq" ? L("ai") : L("rules")}{m.note ? ` · ${m.note}` : ""}</div>}
                  </div>
                </div>
              ))}
              {interim && <div className="flex justify-end"><div className="max-w-[88%] rounded-2xl rounded-br-sm bg-forest/60 px-3.5 py-2.5 text-[15px] italic text-cream-50">{interim}…</div></div>}
              {warn && <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-600">{warn}</div>}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); ask(input); }} className="flex items-center gap-2 border-t border-cream-200 bg-white/80 p-3">
              <button type="button" onClick={toggleMic} aria-label="microphone"
                className={cn("grid h-12 w-12 shrink-0 place-items-center rounded-full text-white shadow-[0_4px_0_rgba(0,0,0,0.25)] transition-colors", phase === "listening" ? "animate-pulse bg-rot" : "bg-leaf hover:bg-leaf-600")}>
                {phase === "listening" ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </button>
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={L("ask")} className={cn("min-w-0 flex-1 rounded-full border border-cream-200 bg-white px-4 py-3 text-sm focus:border-leaf focus:outline-none", lang === "kn" && "kn")} />
              <button type="submit" disabled={!input.trim() || phase === "thinking"} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-forest text-cream-50 disabled:opacity-40" aria-label="send"><Send className="h-4 w-4" /></button>
            </form>
            <div className="bg-white/80 px-4 pb-2 text-center text-[10px] text-charcoal-300">
              {status?.llm === "groq" ? L("ai") : L("rules")} · {status?.stt === "groq_whisper" ? "Whisper" : "browser mic"} · {status?.tts === "google_tts" ? "Google voice" : browserCanSpeak(lang) ? "browser voice" : "text only"}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
