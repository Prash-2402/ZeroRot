import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { voice } from "./voiceSignal";

const Avatar3D = lazy(() => import("./PhoneAvatar3D"));
const hasWebGL = () => { try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; } };
import { motion } from "framer-motion";
import { CheckCircle2, Mic, MicOff, Send, Trash2, Truck, Warehouse } from "lucide-react";
import { api, post } from "../lib/api";
import { COMMODITY_EMOJI, inr, kg, num, when } from "../lib/format";
import { ErrorBox, Spinner, cn } from "../components/ui";
import { useLang, useT } from "./i18n";

/* ---------------- speech (Web Speech API) ---------------- */
const SR: any = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
export const speechInSupported = () => !!SR;
export const speechOutSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

export function useListen() {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<any>(null);
  const start = (lang: "en" | "kn", onText: (t: string) => void) => {
    setError(null);
    if (!SR) { setError("Voice input is not supported in this browser (use Chrome)."); return; }
    if (!window.isSecureContext) { setError("Voice input needs HTTPS on phones. Open the app over HTTPS or type instead."); return; }
    const r = new SR();
    r.lang = lang === "kn" ? "kn-IN" : "en-IN";
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e: any) => onText(e.results[0][0].transcript);
    r.onerror = (e: any) => setError(e.error === "not-allowed" ? "Microphone permission denied." : `Voice error: ${e.error}`);
    r.onend = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };
  const stop = () => { rec.current?.stop(); setListening(false); };
  return { listening, error, start, stop };
}

export function speak(text: string, lang: "en" | "kn", onStart?: () => void, onEnd?: () => void) {
  if (!speechOutSupported()) { onEnd?.(); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  const want = lang === "kn" ? ["kn-IN", "kn"] : ["en-IN", "en-GB", "en"];
  u.voice = voices.find((v) => want.some((w) => v.lang.startsWith(w))) || null;
  u.lang = lang === "kn" ? "kn-IN" : "en-IN";
  u.rate = 0.98;
  u.onstart = () => onStart?.();
  u.onboundary = () => { voice.pulse = 1; };
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  window.speechSynthesis.speak(u);
}

/* ---------------- talking face ---------------- */
export function TalkingFace({ speaking, listening, size = 160 }: { speaking: boolean; listening: boolean; size?: number }) {
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <motion.div className="absolute -inset-3 rounded-full" animate={{ opacity: speaking || listening ? [0.35, 0.8, 0.35] : 0.25, scale: speaking ? [1, 1.06, 1] : 1 }}
        transition={{ duration: 1.1, repeat: Infinity }} style={{ background: listening ? "radial-gradient(circle,#17645F 0%,transparent 70%)" : "radial-gradient(circle,#FF684A 0%,transparent 70%)" }} />
      <motion.div className="relative h-full w-full overflow-hidden rounded-full border-4 border-white shadow-2xl" style={{ borderRadius: 9999 }} animate={{ rotate: speaking ? [0, -1.2, 1, 0] : 0, y: speaking ? [0, -1.5, 0] : 0 }}
        transition={{ duration: 1.6, repeat: Infinity }}>
        <img src="/assistant/face.jpg" alt="Assistant" className="h-full w-full object-cover" draggable={false} />
        {/* mouth: a dark gap shows as the jaw (lower face crop) moves while speaking */}
        <div className="absolute rounded-full bg-[#3a1d1d]" style={{ left: "41%", width: "18%", top: "71.5%", height: "3.5%", opacity: speaking ? 0.9 : 0 }} />
        <motion.div className="absolute inset-0" style={{ clipPath: "polygon(22% 73%, 78% 73%, 74% 100%, 26% 100%)" }}
          animate={{ y: speaking ? [0, size * 0.035, size * 0.012, size * 0.03, 0] : 0 }} transition={{ duration: 0.42, repeat: Infinity }}>
          <img src="/assistant/face.jpg" alt="" className="h-full w-full object-cover" draggable={false} />
        </motion.div>
      </motion.div>
      {listening && <span className="absolute bottom-1 right-1 flex h-8 w-8 items-center justify-center rounded-full bg-teal text-white shadow-lg"><Mic className="h-4 w-4" /></span>}
    </div>
  );
}

/* ---------------- voice new entry ---------------- */
export function VoiceEntry({ onParsed }: { onParsed: (d: { commodity?: string; quantity_kg?: number; days_since_harvest?: number; heard: string }) => void }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const { listening, error, start, stop } = useListen();
  const [busy, setBusy] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
  const [perr, setPerr] = useState<any>(null);
  const go = () => start(lang, async (text) => {
    setHeard(text); setBusy(true); setPerr(null);
    try { onParsed(await post("/flow/parse-entry", { text }, true)); } catch (e) { setPerr(e); } finally { setBusy(false); }
  });
  return (
    <div className="rounded-2xl bg-gradient-to-r from-coral to-[#ff8a5c] p-[2px] shadow-lg shadow-coral/30">
      <div className="flex items-center gap-3 rounded-2xl bg-white p-3">
        <motion.button whileTap={{ scale: 0.92 }} onClick={listening ? stop : go} className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white shadow-lg", listening ? "bg-teal" : "bg-coral")}
          aria-label="Speak the entry">
          {busy ? <Spinner /> : listening ? <motion.span animate={{ scale: [1, 1.25, 1] }} transition={{ duration: 0.8, repeat: Infinity }}><Mic className="h-6 w-6" /></motion.span> : <Mic className="h-6 w-6" />}
        </motion.button>
        <div className="min-w-0 text-sm">
          <div className="font-bold">{t("Speak your entry")}</div>
          <div className="text-xs text-ink-400">{heard ? `“${heard}”` : lang === "kn" ? "ಉದಾ: “ಟೊಮೆಟೊ ಐನೂರು ಕೆಜಿ”" : "e.g. “tomato 500 kilo”"}</div>
          {(error || perr) && <div className="mt-1 text-xs text-critical">{error || perr?.message}</div>}
        </div>
      </div>
    </div>
  );
}

/* ---------------- log, loss breakdown, quality trend ---------------- */
const CAUSE: Record<string, [string, string, string]> = {
  ageing: ["Normal ageing", "ಸಾಮಾನ್ಯ ಹಳೆಯಾಗುವಿಕೆ", "#9DBFBA"], temperature: ["Temperature", "ತಾಪಮಾನ", "#FF684A"], humidity: ["Humidity", "ಆರ್ದ್ರತೆ", "#7FC4FF"],
  chilling: ["Chilling injury", "ಚಳಿ ಹಾನಿ", "#2F80ED"], ripeness: ["Ripeness", "ಹಣ್ಣಾಗುವಿಕೆ", "#e0a92e"], gas: ["Gas build-up", "ಅನಿಲ", "#8a5cf6"],
};

export function LossBars({ loss }: { loss?: Record<string, number> }) {
  const lang = useLang((s) => s.lang);
  if (!loss || !Object.keys(loss).length) return null;
  const items = Object.entries(loss).filter(([, v]) => Math.abs(v) >= 0.05).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...items.map(([, v]) => Math.abs(v)), 1);
  const total = items.reduce((a, [, v]) => a + v, 0);
  return (
    <div className="rounded-2xl border border-paper-300 bg-white p-3">
      <div className="mb-2 flex items-baseline justify-between"><div className="ph-label !mb-0">{lang === "kn" ? "ಗುಣಮಟ್ಟ ಏಕೆ ಕುಸಿಯಿತು" : "Why quality dropped"}</div><div className="font-mono text-xs text-ink-400">−{num(total, 1)} pts</div></div>
      <div className="space-y-1.5">
        {items.map(([k, v]) => (
          <div key={k} className="text-xs">
            <div className="flex justify-between"><span>{(CAUSE[k] || [k, k])[lang === "kn" ? 1 : 0]}</span><span className="font-mono">{v < 0 ? `+${num(-v, 1)} saved` : `−${num(v, 1)}`}</span></div>
            <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-paper-200"><motion.div initial={{ width: 0 }} animate={{ width: `${(Math.abs(v) / max) * 100}%` }} className="h-2 rounded-full" style={{ background: v < 0 ? "#3f9b62" : (CAUSE[k] || ["", "", "#999"])[2] }} /></div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-[10px] text-ink-400">Quality points lost since harvest, split by cause in the decay model (temperature via Q10, humidity outside the recommended range, chilling, ripeness).</div>
    </div>
  );
}

export function QualityTrend({ history }: { history?: any[] }) {
  if (!history || history.length < 3) return null;
  const W = 300, H = 70;
  const qs = history.map((h) => h.q), ts = history.map((h) => h.temp);
  const t0 = history[0].t, t1 = history[history.length - 1].t || 1;
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const yq = (q: number) => H - (q / 100) * H;
  const tmin = Math.min(...ts), tmax = Math.max(...ts) + 0.1;
  const yt = (v: number) => H - ((v - tmin) / (tmax - tmin)) * H;
  return (
    <div className="rounded-2xl border border-paper-300 bg-white p-3">
      <div className="mb-1 flex justify-between text-[10px] font-bold uppercase tracking-wider"><span className="text-teal">Quality</span><span className="text-coral">Inside temperature</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-full">
        <polyline fill="none" stroke="#FF684A" strokeWidth={1.5} strokeDasharray="3 3" points={history.map((h) => `${x(h.t)},${yt(h.temp)}`).join(" ")} />
        <polyline fill="none" stroke="#17645F" strokeWidth={2.5} points={history.map((h) => `${x(h.t)},${yq(h.q)}`).join(" ")} />
      </svg>
      <div className="flex justify-between font-mono text-[10px] text-ink-400"><span>Q {num(qs[0], 0)} → {num(qs[qs.length - 1], 0)}</span><span>{num(tmin, 1)}–{num(tmax, 1)} °C</span></div>
    </div>
  );
}

export function LogList({ events }: { events: any[] }) {
  const [open, setOpen] = useState(false);
  const list = [...(events || [])].reverse();
  const shown = open ? list : list.slice(0, 5);
  return (
    <div className="rounded-2xl border border-paper-300 bg-white p-3">
      <div className="mb-2 flex items-center justify-between"><div className="ph-label !mb-0">Log</div><span className="text-[10px] text-ink-400">{list.length} entries</span></div>
      <div className="space-y-1.5">
        {shown.map((e, i) => (
          <div key={i} className="flex gap-2 text-xs">
            <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", e.severity === "CRITICAL" ? "bg-critical" : e.severity === "WARNING" ? "bg-coral" : e.log ? "bg-ink-300" : "bg-teal")} />
            <div className="min-w-0"><b>{e.title}</b> <span className="text-ink-400">{e.sim_time ? new Date(e.sim_time + "Z").toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : ""}</span>
              <div className="text-ink-400">{e.message}</div></div>
          </div>
        ))}
      </div>
      {list.length > 5 && <button onClick={() => setOpen((x) => !x)} className="mt-2 text-xs font-bold text-teal">{open ? "Show less" : `Show all ${list.length}`}</button>}
    </div>
  );
}

/* ---------------- sell / store / discard ---------------- */
export function ChoiceBar({ lot, recommendation, onSell }: { lot: any; recommendation?: string; onSell: () => void }) {
  const [mode, setMode] = useState<null | "store" | "discard">(null);
  const [days, setDays] = useState(3);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [error, setError] = useState<any>(null);
  const can = ["storage", "graded"].includes(lot.stage);
  if (!can) return null;
  const go = async (choice: "store" | "discard") => {
    setBusy(true); setError(null);
    try { setRes(await post(`/flow/lots/${lot.id}/choice`, { choice, days, reason: choice === "discard" ? "farmer decision" : undefined }, true)); setMode(null); }
    catch (e) { setError(e); } finally { setBusy(false); }
  };
  const rec = recommendation === "sell_now" ? "sell" : recommendation === "store_and_sell_later" ? "store" : recommendation === "discard" ? "discard" : null;
  const Btn = ({ id, icon: Icon, label, onClick, tone }: any) => (
    <motion.button whileTap={{ scale: 0.95 }} onClick={onClick} className={cn("relative flex flex-col items-center gap-1 rounded-2xl border-2 p-3 text-xs font-bold", tone)}>
      {rec === id && <span className="absolute -top-2 rounded-full bg-coral px-2 py-0.5 text-[9px] text-white shadow">RECOMMENDED</span>}
      <Icon className="h-6 w-6" />{label}
    </motion.button>
  );
  return (
    <div className="space-y-2">
      <div className="ph-label">Your choice</div>
      <div className="grid grid-cols-3 gap-2">
        <Btn id="sell" icon={Truck} label="Sell" onClick={onSell} tone="border-teal bg-teal/5 text-teal" />
        <Btn id="store" icon={Warehouse} label="Store" onClick={() => setMode(mode === "store" ? null : "store")} tone="border-paper-300 bg-white text-ink" />
        <Btn id="discard" icon={Trash2} label="Discard" onClick={() => setMode(mode === "discard" ? null : "discard")} tone="border-critical/40 bg-white text-critical" />
      </div>
      {mode === "store" && (
        <div className="rounded-2xl border border-paper-300 bg-white p-3 text-sm">
          Keep for <div className="mt-2 grid grid-cols-4 gap-2">{[1, 3, 5, 7].map((d) => <button key={d} onClick={() => setDays(d)} className={cn("ph-chip text-xs", days === d && "ph-chip-on")}>{d} d</button>)}</div>
          <button disabled={busy} onClick={() => go("store")} className="mt-3 w-full rounded-xl bg-teal py-3 font-bold text-white">{busy ? <Spinner /> : `Keep ${days} more days`}</button>
        </div>
      )}
      {mode === "discard" && (
        <div className="rounded-2xl border border-critical/40 bg-white p-3 text-sm">
          Remove this lot from storage. It will move to History.
          <button disabled={busy} onClick={() => go("discard")} className="mt-3 w-full rounded-xl bg-critical py-3 font-bold text-white">{busy ? <Spinner /> : "Confirm discard"}</button>
        </div>
      )}
      {res?.choice === "store" && <div className="rounded-xl bg-teal/10 p-2 text-xs text-teal">Kept in storage for {res.days} more days.</div>}
      {res?.choice === "discard" && <div className="rounded-xl bg-paper-200 p-2 text-xs">Discarded {kg(res.kg)}. Salvage: {res.salvage.join(" · ")}</div>}
      {error && <ErrorBox error={error} />}
    </div>
  );
}

/* ---------------- history ---------------- */
export function HistoryTab({ history }: { history: any[] }) {
  if (!history?.length) return <div className="p-6 text-center text-sm text-ink-400">Delivered and discarded lots will appear here.</div>;
  return (
    <div className="space-y-3 p-4 pb-28">
      {history.map((h) => (
        <motion.div key={h.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-paper-300 bg-white p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2"><span className="text-2xl">{COMMODITY_EMOJI[h.commodity] || "🌱"}</span><div><b className="capitalize">{h.commodity.replace("_", " ")}</b> · {kg(h.quantity_kg)}<div className="text-[11px] text-ink-400">{h.code} · {h.mode} · {when(h.created_at)}</div></div></div>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold text-white", h.stage === "delivered" ? "bg-ok" : "bg-ink-400")}>{h.stage.toUpperCase()}</span>
          </div>
          {h.shipments.length > 0 && (
            <div className="mt-2 space-y-1 text-xs">{h.shipments.map((s: any, i: number) => (
              <div key={i} className="flex items-center gap-2"><CheckCircle2 className={cn("h-3.5 w-3.5", s.status === "delivered" ? "text-ok" : "text-ink-300")} />
                {s.grade === "ALL" ? "All" : s.grade} {kg(s.kg)} → {s.to}{s.final_quality != null ? ` · Q ${num(s.final_quality, 0)}` : ""}{s.reroutes ? ` · rerouted ${s.reroutes}×` : ""}</div>
            ))}</div>
          )}
          {h.decision?.net_now != null && <div className="mt-1 text-[11px] text-ink-400">Decision value at the time: {inr(h.decision.net_now)}</div>}
        </motion.div>
      ))}
    </div>
  );
}

/* ---------------- voice assistant ---------------- */
export function AssistantTab({ lot }: { lot: any }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const { listening, error, start, stop } = useListen();
  const [micLang, setMicLang] = useState<"en" | "kn">(lang);
  useEffect(() => setMicLang(lang), [lang]);
  const [webgl] = useState(hasWebGL);
  const [speaking, setSpeaking] = useState(false);
  const [msgs, setMsgs] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<any>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);
  useEffect(() => () => { if (speechOutSupported()) window.speechSynthesis.cancel(); }, []);
  const ask = async (q: string) => {
    if (!q.trim()) return;
    setText(""); setErr(null);
    const history = msgs.slice(-8);
    setMsgs((x) => [...x, { role: "user", content: q }]);
    setBusy(true);
    try {
      const r = await post("/flow/chat", { lot_id: lot?.id, message: q, language: micLang, history }, true);
      setMsgs((x) => [...x, { role: "assistant", content: r.answer }]);
      speak(r.answer, r.language === "kn" ? "kn" : r.language === "en" ? "en" : micLang, () => setSpeaking(true), () => setSpeaking(false));
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const quick = lang === "kn" ? ["ನನ್ನ ಬೆಳೆ ಎಷ್ಟು ದಿನ ಉಳಿಯುತ್ತದೆ?", "ಯಾವಾಗ ಮಾರಬೇಕು?", "ಟ್ರಕ್ ಎಲ್ಲಿದೆ?"] : ["How long will my produce last?", "When should I sell?", "Where is my truck?"];
  return (
    <div className="flex min-h-[calc(100vh-150px)] flex-col p-4 pb-24">
      <div className="rounded-3xl bg-gradient-to-b from-teal to-[#0f4f4b] p-4 text-center text-white shadow-xl">
        {webgl ? <Suspense fallback={<div className="mx-auto h-[170px] w-[170px]" />}><Avatar3D speaking={speaking} listening={listening} size={170} /></Suspense>
          : <TalkingFace speaking={speaking} listening={listening} size={150} />}
        <div className="mt-3 font-display text-lg font-bold">{lang === "kn" ? "ಸಹಾಯಕಿ" : "Sahayaki"}</div>
        <div className="text-xs opacity-80">{listening ? (lang === "kn" ? "ಕೇಳುತ್ತಿದ್ದೇನೆ…" : "Listening…") : speaking ? (lang === "kn" ? "ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ…" : "Speaking…") : busy ? "…" : (lang === "kn" ? "ಮೈಕ್ ಒತ್ತಿ ಮಾತನಾಡಿ" : "Tap the mic and speak")}</div>
        <div className="mx-auto mt-2 flex w-max overflow-hidden rounded-full border border-white/30 text-[11px] font-bold">
          {(["kn", "en"] as const).map((l) => <button key={l} onClick={() => setMicLang(l)} className={cn("px-3 py-1", micLang === l ? "bg-white text-teal" : "text-white/80")}>{l === "kn" ? "ಕನ್ನಡ" : "English"}</button>)}
        </div>
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => (listening ? stop() : start(micLang, ask))}
          className={cn("mx-auto mt-3 flex h-16 w-16 items-center justify-center rounded-full shadow-lg", listening ? "bg-white text-teal" : "bg-coral text-white")} aria-label="Speak">
          {listening ? <MicOff className="h-7 w-7" /> : <Mic className="h-7 w-7" />}
        </motion.button>
        {error && <div className="mt-2 text-xs text-[#ffd0c4]">{error}</div>}
        {micLang === "kn" && speechOutSupported() && !window.speechSynthesis.getVoices().some((v) => v.lang.startsWith("kn")) && (
          <div className="mt-1 text-[10px] text-[#ffd0c4]">This device has no Kannada voice installed, so replies may not be read aloud (install Kannada in the phone's text-to-speech settings).</div>
        )}
      </div>
      <div className="mt-3 flex-1 space-y-2 overflow-y-auto">
        {msgs.length === 0 && quick.map((q) => <button key={q} onClick={() => ask(q)} className="block w-full rounded-2xl border border-paper-300 bg-white p-3 text-left text-sm">{q}</button>)}
        {msgs.map((m, i) => <div key={i} className={cn("max-w-[85%] whitespace-pre-line rounded-2xl p-3 text-sm shadow-sm", m.role === "user" ? "ml-auto bg-coral text-white" : "bg-white")}>{m.content}</div>)}
        {busy && <div className="w-14 rounded-2xl bg-white p-3"><Spinner /></div>}
        {err && <ErrorBox error={err} />}
        <div ref={end} />
      </div>
      <div className="mt-2 flex gap-2">
        <input className="ph-input flex-1" placeholder={t("Ask anything")} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask(text)} />
        <button className="w-14 rounded-xl bg-coral text-white" onClick={() => ask(text)} aria-label={t("Send")}><Send className="mx-auto h-5 w-5" /></button>
      </div>
    </div>
  );
}

export { api };
