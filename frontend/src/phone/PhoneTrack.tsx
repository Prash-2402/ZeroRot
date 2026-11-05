import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, MapPin, ScanLine, Send, Truck } from "lucide-react";
import { post } from "../lib/api";
import { kg, num, qualityColor, tempColor } from "../lib/format";
import { ErrorBox, Spinner, cn } from "../components/ui";
import { useLang, useT } from "./i18n";

const GRADE_COLOR: Record<string, string> = { A1: "#3f9b62", A2: "#e0a92e", A3: "#e07a3a", rejected: "#EB4D3D", uncertain: "#8A9099" };

export function BagTab({ lot }: { lot: any }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<any>(null);
  const g = lot.grading;
  const start = async () => {
    setBusy(true); setError(null);
    try { await post(`/flow/lots/${lot.id}/scan`, {}, true); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  if (lot.stage === "intake") return <div className="p-6 text-ink-400">Wait until loading into the godown finishes.</div>;
  return (
    <div className="space-y-4 p-4 pb-28">
      {!g ? (
        <>
          <div className="rounded-2xl border border-paper-300 bg-white p-4 text-sm text-ink-400">
            The lot moves to the scan &amp; sort house. Every item passes the scanner and drops into a box:
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              {[["A1", "Best · ≥ 85"], ["A2", "Medium · 70–85"], ["A3", "Low · below 70"]].map(([k, d]) => (
                <div key={k} className="rounded-xl border-2 p-2" style={{ borderColor: GRADE_COLOR[k] }}><div className="font-display text-xl font-black" style={{ color: GRADE_COLOR[k] }}>{k}</div><div className="text-ink-400">{d}</div></div>
              ))}
            </div>
            <div className="mt-2 text-[11px]">Below saleable quality is rejected. Watch it happen on the laptop.</div>
          </div>
          <button className="w-full rounded-2xl bg-gold py-4 text-lg font-bold text-ink disabled:opacity-40" disabled={busy || lot.stage !== "storage"} onClick={start}>
            {busy ? <Spinner /> : <span className="inline-flex items-center gap-2"><ScanLine className="h-5 w-5" /> {t("Start scanning")}</span>}
          </button>
          {error && <ErrorBox error={error} />}
        </>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {["A1", "A2", "A3"].map((k) => (
              <div key={k} className="rounded-2xl border-2 bg-white p-3 text-center" style={{ borderColor: GRADE_COLOR[k] }}>
                <div className="font-display text-2xl font-black" style={{ color: GRADE_COLOR[k] }}>{k}</div>
                <div className="font-mono text-2xl font-bold">{g.bags_filled[k]}<span className="text-sm text-ink-400">/{g.bags[k]}</span></div>
                <div className="text-[11px] text-ink-400">{t("Boxes")} · {kg(g.kg[k])}</div>
              </div>
            ))}
          </div>
          <div>
            <div className="flex justify-between text-xs text-ink-400"><span>{lot.stage === "grading" ? "Scanning and sorting…" : "Sorting complete"}</span><span>{kg(g.processed_kg)} / {kg(g.total_kg)}</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-paper-200"><div className="h-2 rounded-full bg-teal transition-all" style={{ width: `${(g.processed_kg / g.total_kg) * 100}%` }} /></div>
          </div>
          <div className="rounded-2xl border border-paper-300 bg-white p-3 text-xs">
            <div className="mb-2 font-bold">Items on the line</div>
            <div className="flex flex-wrap gap-1">{(g.items || []).map((it: any, i: number) => <span key={i} title={`${it.grade}${it.quality ? ` · Q ${it.quality}` : ""}`} className="h-3.5 w-3.5 rounded-full" style={{ background: GRADE_COLOR[it.grade] }} />)}</div>
            <div className="mt-2 text-ink-400">{t("Rejected")}: {kg(g.kg.rejected)}</div>
          </div>
          <div className="text-[10px] text-ink-400">{g.label}</div>
        </>
      )}
    </div>
  );
}

export function TrackTab({ lot, onHelp }: { lot: any; onHelp: () => void }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  if (!lot.shipments?.length) return <div className="p-6 text-ink-400">Nothing dispatched yet. Choose where to sell in Predict → Decision.</div>;
  return (
    <div className="space-y-4 p-4 pb-28">
      {lot.shipments.map((s: any) => {
        const lv = s.live || {};
        const pct = lv.total_km ? Math.min(100, (lv.total_done_km / lv.total_km) * 100) : s.status === "in_transit" ? 0 : 100;
        const eta = lv.route?.eta_h;
        const sp = lv.setpoint ?? 13;
        return (
          <div key={s.id} className="border border-paper-300">
            <div className={cn("flex items-center justify-between p-3", s.status === "delivered" ? "bg-ok text-white" : "bg-white")}>
              <div className="flex items-center gap-2"><Truck className="h-5 w-5" /><div><div className="font-bold">{s.grade === "ALL" ? kg(s.quantity_kg) : `${s.grade} · ${kg(s.quantity_kg)}`} → {s.destination.name}</div>
                <div className="text-[11px] opacity-80">{s.status === "delivered" ? t("Delivered") : s.status === "arrived" ? `${t("Arrived")} · unloading ${Math.round(s.unload_progress * 100)}%` : `${t("In transit")} · ${lv.refrigerated ? "refrigerated" : "open truck"}`}</div></div></div>
              {s.reroute_count > 0 && <span className="bg-gold px-1.5 text-[10px] font-bold text-ink">REROUTED</span>}
            </div>
            <div className="space-y-3 p-3">
              <div>
                <div className="flex justify-between font-mono text-xs"><span>{num(lv.total_done_km)} km</span><span>{num(lv.total_km)} km</span></div>
                <div className="relative mt-1 h-2 bg-paper-200"><div className="h-2 bg-teal transition-all" style={{ width: `${pct}%` }} />
                  {s.checkpoints.map((c: any, i: number) => <span key={i} className={cn("absolute top-1/2 h-3 w-1 -translate-y-1/2", c.passed ? "bg-ok" : "bg-ink-400")} style={{ left: `${Math.min(100, (c.km / (lv.total_km || 1)) * 100)}%` }} />)}
                </div>
                <div className="mt-1 text-[11px] text-ink-400">{s.status === "in_transit" ? `ETA ${eta != null ? num(eta) + " h" : "—"}${lv.route?.delay_s > 600 ? ` · delay ${num(lv.route.delay_s / 3600)} h` : ""}` : ""}</div>
              </div>
              {!lv.refrigerated && <div className="rounded-xl bg-paper-200 px-3 py-2 text-xs text-ink-400">Open truck from traditional storage: tracked by location and checkpoints.</div>}
              {lv.refrigerated && lv.produce && (
                <div className="grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="rounded-xl border border-paper-300 p-2"><div className="font-mono text-lg font-bold">{num((lv.flows?.decay_rate_per_day ?? 0) * (lv.produce?.quality ?? 0), 1)}</div>quality points lost / day</div>
                  <div className="rounded-xl border border-paper-300 p-2"><div className="font-mono text-lg font-bold">{lv.prediction ? `${num(lv.prediction.shelf_life_days, 1)} d` : "—"}</div>shelf life left{lv.prediction ? ` · risk ${num(lv.prediction.spoilage_probability * 100, 0)}%` : ""}</div>
                </div>
              )}
              {lv.refrigerated && lv.readings && (
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="border border-paper-300 p-2"><div className="font-mono text-lg font-bold" style={{ color: tempColor(lv.readings.max_zone_c ?? lv.readings.temperature_c, sp) }}>{num(lv.readings.max_zone_c ?? lv.readings.temperature_c)}°</div>warmest cargo</div>
                  <div className="border border-paper-300 p-2"><div className="font-mono text-lg font-bold">{num(lv.readings.rh_pct, 0)}%</div>humidity</div>
                  <div className="border border-paper-300 p-2"><div className="font-mono text-lg font-bold" style={{ color: qualityColor(lv.produce.quality) }}>{num(lv.produce.quality, 0)}</div>quality</div>
                </div>
              )}
              <div>
                <div className="ph-label">{t("Checkpoints")}</div>
                <div className="space-y-1.5">
                  {s.checkpoints.map((c: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      {c.passed ? <CheckCircle2 className="h-4 w-4 text-ok" /> : <Circle className="h-4 w-4 text-ink-400" />}
                      <span className={c.passed ? "text-ink" : "text-ink-400"}>{(lang === "kn" && c.name_kn) || c.name || "…"}</span><span className="ml-auto font-mono text-[11px] text-ink-400">km {num(c.km, 0)}{c.passed_sim_time ? ` · ${new Date(c.passed_sim_time + "Z").toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 text-sm"><MapPin className={cn("h-4 w-4", s.status !== "in_transit" ? "text-ok" : "text-ink-400")} /><span>{s.destination.name}</span></div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
      {lot.shipments.some((s: any) => s.status === "delivered") && (
        <div className="border-2 border-ok p-4 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-ok" />
          <div className="mt-2 font-display text-xl font-bold">{t("Delivered")}</div>
          <div className="text-sm text-ink-400">Need to change something or ask a question?</div>
          <button className="mt-3 w-full bg-gold py-3 font-bold text-ink" onClick={onHelp}>Open help</button>
        </div>
      )}
    </div>
  );
}

export function HelpTab({ lot }: { lot: any }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const [msgs, setMsgs] = useState<{ role: "user" | "assistant"; content: string; warn?: boolean }[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<any>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);
  const send = async (q?: string) => {
    const m = (q ?? text).trim();
    if (!m) return;
    setText(""); setError(null);
    const history = msgs.map(({ role, content }) => ({ role, content }));
    setMsgs((x) => [...x, { role: "user", content: m }]);
    setBusy(true);
    try {
      const r = await post("/flow/chat", { lot_id: lot.id, message: m, language: lang, history }, true);
      setMsgs((x) => [...x, { role: "assistant", content: r.answer, warn: !r.verified }]);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const quick = lang === "kn" ? ["ನನ್ನ ಬೆಳೆ ಎಷ್ಟು ದಿನ ಉಳಿಯುತ್ತದೆ?", "ಯಾವಾಗ ಮಾರಬೇಕು?", "ಟ್ರಕ್ ಎಲ್ಲಿದೆ?"] : ["How long will my produce last?", "When should I sell?", "Where is my truck?"];
  return (
    <div className="flex h-[calc(100vh-150px)] flex-col p-4 pb-24">
      <div className="flex-1 space-y-3 overflow-y-auto">
        {msgs.length === 0 && (
          <div className="space-y-2">
            <div className="text-sm text-ink-400">Ask about your {lot.commodity} lot in English or ಕನ್ನಡ. Answers use this lot's live data.</div>
            {quick.map((q) => <button key={q} onClick={() => send(q)} className="block w-full border border-paper-300 p-3 text-left text-sm">{q}</button>)}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={cn("max-w-[85%] whitespace-pre-line p-3 text-sm", m.role === "user" ? "ml-auto bg-teal text-white" : "bg-white")}>
            {m.content}{m.warn && <div className="mt-1 text-[10px] text-gold">Some numbers here are not in the model data; check the Godown/Predict screens.</div>}
          </div>
        ))}
        {busy && <div className="w-16 bg-white p-3"><Spinner /></div>}
        {error && <ErrorBox error={error} />}
        <div ref={end} />
      </div>
      <div className="mt-2 flex gap-2">
        <input className="ph-input flex-1" placeholder={t("Ask anything")} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
        <button className="w-14 bg-gold text-ink" onClick={() => send()} aria-label={t("Send")}><Send className="mx-auto h-5 w-5" /></button>
      </div>
    </div>
  );
}
