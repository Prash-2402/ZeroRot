import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Bot, Crosshair, DoorOpen, Fan, Languages, LineChart, MapPin, PackageCheck, Plus, Search, Snowflake, Thermometer, Truck, Warehouse, Wind } from "lucide-react";
import { api, post } from "../lib/api";
import { COMMODITY_EMOJI, days, kg, num, qualityColor, tempColor } from "../lib/format";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../stores/auth";
import { enablePush, pushSupported } from "../lib/push";
import { ErrorBox, Spinner, cn } from "../components/ui";
import { useLang, useT } from "./i18n";
import { useStationLive } from "./usePhone";
import { PredictTab } from "./PhonePredict";
import { TrackTab } from "./PhoneTrack";
import { AssistantTab, HistoryTab, LogList, LossBars, QualityTrend, VoiceEntry } from "./PhoneExtras";
import { History } from "lucide-react";
import { post as postFix } from "../lib/api";

export const CROPS = [
  { id: "tomato", name: "Tomato", kn: "ಟೊಮೆಟೊ", img: "/produce/tomato_fresh.jpg" },
  { id: "mango", name: "Mango", kn: "ಮಾವು", img: "/produce/mango_fresh.jpg" },
  { id: "banana", name: "Banana", kn: "ಬಾಳೆಹಣ್ಣು", img: "/produce/banana_fresh.jpg" },
  { id: "potato", name: "Potato", kn: "ಆಲೂಗಡ್ಡೆ", img: null },
];
// openly licensed Wikimedia Commons photos (credits in public/produce/credits.json)
const PHOTO_CROPS = ["brinjal", "cabbage", "carrot", "cauliflower", "grapes", "green_chilli", "maize", "okra", "orange", "papaya", "pomegranate", "potato", "rice", "wheat"];
export const STAGE_LABEL: Record<string, string> = { intake: "Loading", storage: "Stored", grading: "Scanning", graded: "Sorted", dispatched: "In transit", arrived: "Arrived", delivered: "Delivered" };

/* ---------------- pairing ---------------- */
function Pair({ token }: { token: string }) {
  const t = useT();
  const setMobile = useAuth((s) => s.setMobile);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<any>(null);
  const go = async () => {
    setBusy(true); setError(null);
    try {
      const d = await post("/qr/verify", { token, pin });
      if (d.scope.type !== "station") throw new Error("This QR code is not a ZERO ROT station");
      setMobile(d.access_token, { ...d.scope, link: token, expires_at: d.expires_at });
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <div className="flex min-h-[80vh] flex-col justify-center px-6">
      <div className="mb-8 text-center">
        <img src="/logo.png" alt="ZERO ROT" className="mx-auto mb-6 h-16 w-auto" />
        <h1 className="font-display text-3xl font-bold text-ink">{t("Enter PIN")}</h1>
        <p className="mt-2 text-sm text-ink-400">The 6-digit PIN is shown on the laptop next to the QR code.</p>
      </div>
      <input className="w-full border-2 border-paper-400 bg-white py-4 text-center font-mono text-4xl tracking-[0.5em] text-ink outline-none focus:border-teal"
        inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} autoFocus aria-label="PIN" />
      {error && <div className="mt-3"><ErrorBox error={error} /></div>}
      <button className="mt-4 w-full bg-gold py-4 text-lg font-bold text-ink disabled:opacity-40" disabled={pin.length !== 6 || busy} onClick={go}>{busy ? <Spinner /> : t("Connect")}</button>
    </div>
  );
}

/* ---------------- entry ---------------- */
function Entry({ onCreated }: { onCreated: (id: number) => void }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const [crop, setCrop] = useState("tomato");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState<"t" | "kg">("t");
  const [cond, setCond] = useState(85);
  const [plan, setPlan] = useState(5);
  const [aged, setAged] = useState(0);
  const [kept, setKept] = useState<"open" | "shade" | "cold">("shade");
  const [heardNote, setHeardNote] = useState<string | null>(null);
  const [maturity, setMaturity] = useState("turning");
  const [mode, setMode] = useState<"traditional" | "advanced">("advanced");
  const [loc, setLoc] = useState<{ name: string; lat: number; lng: number } | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<any>(null);
  const kgVal = (Number(qty) || 0) * (unit === "t" ? 1000 : 1);
  const comms = useQuery({ queryKey: ["commodities"], queryFn: () => api("/commodities"), staleTime: 3600000 });
  const PHOTO: Record<string, string | null> = { ...Object.fromEntries(CROPS.filter((c) => c.img).map((c) => [c.id, c.img])),
    ...Object.fromEntries(PHOTO_CROPS.map((id) => [id, `/produce/${id}_fresh.jpg`])) };
  const crops = (comms.data?.commodities || []).filter((c: any) => c.prediction_supported)
    .map((c: any) => ({ id: c.id, name: c.name, kn: c.name_kn || c.name, img: PHOTO[c.id] || null, life: c.storage?.storage_life_days, t: c.storage?.temperature_c }));
  const gps = () => {
    if (!window.isSecureContext || !navigator.geolocation) { setError({ message: "GPS needs a secure (HTTPS) connection on phones. Search your village or town instead." }); return; }
    setBusy("gps"); setError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => { setLoc({ name: `GPS ${p.coords.latitude.toFixed(4)}, ${p.coords.longitude.toFixed(4)}`, lat: p.coords.latitude, lng: p.coords.longitude }); setBusy(null); },
      (e) => { setError({ message: `Location unavailable: ${e.message}` }); setBusy(null); }, { enableHighAccuracy: true, timeout: 12000 });
  };
  const search = async () => {
    if (q.trim().length < 2) return;
    setBusy("search"); setError(null);
    try { setResults((await api(`/weather/geocode?q=${encodeURIComponent(q.trim())}`, { mobile: true })).results); } catch (e) { setError(e); } finally { setBusy(null); }
  };
  const submit = async () => {
    setBusy("submit"); setError(null);
    try {
      const lot = await api("/flow/lots", { method: "POST", mobile: true, timeoutMs: 60000, json: { commodity: crop, quantity_kg: kgVal, quality: cond, maturity: ["tomato", "mango", "banana"].includes(crop) ? maturity : null,
        mode, lat: loc!.lat, lng: loc!.lng, location_name: loc!.name, speed: 60, plan_days: plan, days_since_harvest: aged, kept_as: kept } });
      onCreated(lot.id);
    } catch (e) { setError(e); } finally { setBusy(null); }
  };
  return (
    <div className="space-y-6 p-4 pb-28">
      <VoiceEntry onParsed={(d) => {
        if (d.commodity) setCrop(d.commodity);
        if (d.quantity_kg) { if (d.quantity_kg >= 1000 && d.quantity_kg % 100 === 0) { setUnit("t"); setQty(String(d.quantity_kg / 1000)); } else { setUnit("kg"); setQty(String(d.quantity_kg)); } }
        if (d.days_since_harvest) setAged(d.days_since_harvest);
        setHeardNote(d.commodity || d.quantity_kg ? `Filled from voice: ${d.commodity ?? "crop ?"} · ${d.quantity_kg ? kg(d.quantity_kg) : "quantity ?"}. Check and continue.` : "Could not find a crop and quantity. Try e.g. “tomato 500 kilo”.");
      }} />
      {heardNote && <div className="-mt-3 rounded-xl bg-coral/10 p-2 text-xs text-[#b8401f]">{heardNote}</div>}
      <section>
        <div className="ph-label">1 · {t("Crop")}</div>
        <div className="grid grid-cols-4 gap-2">
          {(crops.length ? crops : CROPS).map((c: any) => (
            <button key={c.id} onClick={() => setCrop(c.id)} className={cn("overflow-hidden border-2 text-center", crop === c.id ? "border-teal" : "border-paper-300")}>
              {c.img ? <img src={c.img} alt="" className="aspect-square w-full object-cover" /> : <div className="flex aspect-square items-center justify-center bg-paper-200 text-4xl">{COMMODITY_EMOJI[c.id] || "🌱"}</div>}
              <div className={cn("py-1 text-[11px] font-semibold", crop === c.id ? "bg-teal text-white" : "bg-white text-ink")}>{lang === "kn" ? c.kn : c.name}</div>
            </button>
          ))}
        </div>
        {(() => { const c = crops.find((x: any) => x.id === crop); return c ? <div className="mt-2 text-[11px] text-ink-400">Keeps about {Math.round(c.life)} days at {c.t} °C (published storage life); faster when warmer.</div> : null; })()}
      </section>
      <section>
        <div className="ph-label">2 · {t("Quantity")}</div>
        <div className="flex">
          <input className="ph-input min-w-0 flex-1 text-2xl font-bold" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Quantity" />
          {(["t", "kg"] as const).map((u) => <button key={u} onClick={() => setUnit(u)} className={cn("w-16 shrink-0 border-2 text-sm font-bold", unit === u ? "border-teal bg-teal text-white" : "border-paper-300 text-ink")}>{u === "t" ? "tonne" : "kg"}</button>)}
        </div>
        <div className="mt-1 text-xs text-ink-400">= {kg(kgVal)}{kgVal > 50000 || kgVal < 50 ? " · must be 50 kg – 50 t" : ""}</div>
      </section>
      <section>
        <div className="ph-label">3 · {t("Harvest condition")}</div>
        <div className="grid grid-cols-3 gap-2">
          {[[95, "Excellent"], [85, "Good"], [72, "Fair"]].map(([v, l]) => <button key={v} onClick={() => setCond(v as number)} className={cn("ph-chip", cond === v && "ph-chip-on")}>{t(l as string)}</button>)}
        </div>
        {["tomato", "mango", "banana"].includes(crop) && (
          <div className="mt-2 grid grid-cols-3 gap-2">
            {[["mature_green", "Mature green"], ["turning", "Turning"], ["ripe", "Ripe"]].map(([v, l]) => <button key={v} onClick={() => setMaturity(v)} className={cn("ph-chip text-xs", maturity === v && "ph-chip-on")}>{t(l)}</button>)}
          </div>
        )}
      </section>
      <section>
        <div className="ph-label">{lang === "kn" ? "ಕೊಯ್ಲಿನಿಂದ ಎಷ್ಟು ದಿನ ಆಯಿತು?" : "Days since harvest"}</div>
        <div className="grid grid-cols-5 gap-2">{[0, 2, 7, 30, 90].map((d) => <button key={d} onClick={() => setAged(d)} className={cn("ph-chip text-xs", aged === d && "ph-chip-on")}>{d === 0 ? "Today" : d < 30 ? `${d} d` : `${d / 30} mo`}</button>)}</div>
        <div className="mt-2 flex items-center gap-2"><input className="ph-input w-24 py-2 text-sm" inputMode="numeric" value={aged} onChange={(e) => setAged(Math.min(365, Number(e.target.value.replace(/\D/g, "")) || 0))} aria-label="Days since harvest" /><span className="text-xs text-ink-400">days (0–365)</span></div>
        {aged > 0 && (
          <div className="mt-2 grid grid-cols-3 gap-2">
            {([["open", "In the open"], ["shade", "Shed / shade"], ["cold", "Cold store"]] as const).map(([v, l]) => <button key={v} onClick={() => setKept(v)} className={cn("ph-chip text-xs", kept === v && "ph-chip-on")}>{l}</button>)}
          </div>
        )}
        {aged > 0 && <div className="mt-1 text-[11px] text-ink-400">Not fresh: the past {aged} days are replayed through the decay model with this place's recorded weather{kept === "cold" ? " (cold store: recommended conditions)" : ""}, so the lot starts at its present quality.</div>}
      </section>
      <section>
        <div className="ph-label">{t("Plan to sell within")}</div>
        <div className="grid grid-cols-4 gap-2">{[2, 5, 7, 14].map((d) => <button key={d} onClick={() => setPlan(d)} className={cn("ph-chip text-xs", plan === d && "ph-chip-on")}>{d} d</button>)}</div>
      </section>
      <section>
        <div className="ph-label">4 · {t("Location")}</div>
        {loc ? (
          <div className="flex items-center justify-between border-2 border-gold bg-white p-3 text-ink">
            <span className="flex items-center gap-2 text-sm"><MapPin className="h-4 w-4 text-teal" />{loc.name}</span>
            <button className="text-xs font-bold text-gold underline" onClick={() => { setLoc(null); setResults(null); }}>Change</button>
          </div>
        ) : (
          <div className="space-y-2">
            <button onClick={gps} className="ph-btn-line w-full">{busy === "gps" ? <Spinner /> : <Crosshair className="h-4 w-4" />} {t("Use my location")}</button>
            <div className="flex gap-2">
              <input className="ph-input flex-1" placeholder={t("Search place") + " (e.g. Kolar)"} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
              <button className="ph-btn-line w-14" onClick={search} aria-label="Search">{busy === "search" ? <Spinner /> : <Search className="h-5 w-5" />}</button>
            </div>
            {results && (
              <div className="border border-paper-300 bg-white">
                {results.length === 0 && <div className="p-3 text-sm text-ink-400">No places found.</div>}
                {results.map((r, i) => (
                  <button key={i} className="block w-full border-b border-paper-300 px-3 py-2.5 text-left text-sm text-ink last:border-0"
                    onClick={() => setLoc({ name: [r.name, r.admin1].filter(Boolean).join(", "), lat: r.lat, lng: r.lng })}>
                    {r.name}<span className="text-ink-400">{r.admin1 ? `, ${r.admin1}` : ""}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
      <section>
        <div className="ph-label">5 · {t("Choose godown")}</div>
        <div className="grid grid-cols-2 gap-2">
          {([["traditional", Warehouse, "Weather-based predictions, alerts and suggestions. No sensors."], ["advanced", Snowflake, "Sensors inside; temperature and humidity adjusted automatically. Scan & bag."]] as const).map(([m, Icon, d]) => (
            <button key={m} onClick={() => setMode(m)} className={cn("border-2 p-3 text-left", mode === m ? "border-teal bg-teal/10" : "border-paper-300")}>
              <Icon className={cn("h-6 w-6", mode === m ? "text-teal" : "text-ink-400")} />
              <div className="mt-2 font-bold text-ink">{t(m === "traditional" ? "Traditional" : "Advanced")}</div>
              <div className="mt-1 text-[11px] leading-snug text-ink-400">{d}</div>
            </button>
          ))}
        </div>
      </section>
      {error && <ErrorBox error={error} />}
      {(!loc || kgVal < 50 || kgVal > 50000) && (
        <div className="text-center text-xs text-gold">
          {!loc ? "Choose a location (step 4) to continue." : `Quantity reads ${kg(kgVal)} — it must be between 50 kg and 50 t (check the tonne / kg toggle).`}
        </div>
      )}
      <button className="w-full bg-gold py-4 text-lg font-bold text-ink disabled:opacity-40" disabled={!loc || kgVal < 50 || kgVal > 50000 || busy === "submit"} onClick={submit}>
        {busy === "submit" ? <Spinner /> : t("Send to godown")}
      </button>
    </div>
  );
}

/* ---------------- godown ---------------- */
function Big({ icon: Icon, label, value, unit, color, sub }: any) {
  return (
    <div className="border border-paper-300 bg-white p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-ink-400"><Icon className="h-3.5 w-3.5" />{label}</div>
      <div className="mt-1 font-mono text-3xl font-bold" style={{ color: color || "#17645F" }}>{value}<span className="ml-1 text-sm text-ink-400">{unit}</span></div>
      {sub && <div className="text-[11px] text-ink-400">{sub}</div>}
    </div>
  );
}

function GodownTab({ lot, refresh }: { lot: any; refresh: () => void }) {
  const t = useT();
  const st = lot.storage;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<any>(null);
  if (!st) return <div className="p-6 text-ink-400">Godown state unavailable.</div>;
  const r = st.readings, eq = st.equipment, pred = st.prediction;
  const sp = st.setpoint ?? 13;
  const ctl = async (name: string, value: any) => {
    setBusy(true); setError(null);
    try { await post(`/flow/lots/${lot.id}/control`, { name, value }, true); refresh(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const active = ["intake", "storage"].includes(lot.stage);
  const activeCodes = new Set(Object.keys(st.active_alerts || {}).map((c) => c.toLowerCase()));
  const latest = new Map<string, any>();
  for (const e of lot.events || []) if (!e.log && e.severity !== "INFO" && activeCodes.has(e.kind)) latest.set(e.kind, e);   // newest per alert type
  const alerts = active ? [...latest.values()].reverse() : [];
  return (
    <div className="space-y-4 p-4 pb-28">
      {st.loading && !st.loading.done && (
        <div className="border border-teal/40 bg-teal/10 p-3">
          <div className="flex justify-between text-sm font-bold text-teal"><span>{t("Loading")}…</span><span>{kg(st.loading.kg_loaded)} / {kg(lot.quantity_kg)}</span></div>
          <div className="mt-2 h-2 bg-paper-200"><div className="h-2 bg-teal transition-all" style={{ width: `${st.loading.progress * 100}%` }} /></div>
          <div className="mt-1 text-[11px] text-ink-400">Door stays open while crates are carried in.</div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Big icon={Thermometer} label={`${t("Temperature")} · ${t("Inside")}`} value={num(r.temperature_c)} unit="°C" color={tempColor(r.temperature_c, lot.mode === "advanced" ? sp : 12)} sub={`${t("Outside")} ${num(st.ambient.t)} °C`} />
        <Big icon={Wind} label={t("Humidity")} value={num(r.rh_pct, 0)} unit="%" sub={`${t("Outside")} ${num(st.ambient.rh, 0)} %`} />
        <Big icon={PackageCheck} label={t("Quality")} value={num(st.produce.quality, 0)} unit="/100" color={qualityColor(st.produce.quality)} sub={`weight loss ${num(st.produce.weight_loss_pct, 2)}%`} />
        <Big icon={LineChart} label={t("Shelf life")} value={pred ? days(pred.shelf_life_days) : "—"} sub={pred ? `range ${days(pred.shelf_life_p10)} – ${days(pred.shelf_life_p90)}` : "calculating…"} />
      </div>
      {st.preaged && (
        <div className="rounded-2xl border border-coral/40 bg-coral/5 p-3 text-xs">
          <b className="text-[#b8401f]">Already {num(st.preaged.days, 0)} days since harvest</b> · kept {st.preaged.kept_label}<div className="text-ink-400">Quality at harvest {num(st.preaged.quality_at_harvest, 0)} → on entry {num(st.preaged.quality_now, 0)}</div>
        </div>
      )}
      <QualityTrend history={st.history} />
      <LossBars loss={st.loss} />
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className={cn("border p-2", eq.door_open ? "border-abnormal text-abnormal" : "border-paper-300 text-ink")}><DoorOpen className="mx-auto h-5 w-5" />{t("Door")}: {eq.door_open ? t("Open") : t("Closed")}</div>
        {lot.mode === "traditional"
          ? <div className={cn("border p-2", eq.vents_open ? "border-gold text-gold" : "border-paper-300 text-ink")}><Wind className="mx-auto h-5 w-5" />{t("Vents")}: {eq.vents_open ? t("Open") : t("Closed")}</div>
          : <div className={cn("border p-2", st.flows?.q_cool_w > 0 ? "border-coldlight text-coldlight" : "border-paper-300 text-ink")}><Fan className="mx-auto h-5 w-5" />{t("Cooling")}: {num((st.flows?.q_cool_w || 0) / 1000, 1)} kW</div>}
        <div className="border border-paper-300 p-2 text-ink"><Snowflake className="mx-auto h-5 w-5" />{lot.mode === "advanced" ? `set ${num(sp)} °C` : "no cooling"}</div>
      </div>
      {active && (
        <div className="space-y-2">
          <div className="ph-label">Controls</div>
          <div className="grid grid-cols-2 gap-2">
            <button disabled={busy || (st.loading && !st.loading.done)} className="ph-btn-line" onClick={() => ctl("door_open", !eq.door_open)}>{eq.door_open ? "Close door" : "Open door"}</button>
            {lot.mode === "traditional"
              ? <button disabled={busy} className="ph-btn-line" onClick={() => ctl("vents_open", !eq.vents_open)}>{eq.vents_open ? "Close vents" : "Open vents"}</button>
              : <div className="flex"><button disabled={busy} className="ph-btn-line flex-1" onClick={() => ctl("setpoint", sp - 0.5)}>− 0.5°</button><button disabled={busy} className="ph-btn-line flex-1" onClick={() => ctl("setpoint", sp + 0.5)}>+ 0.5°</button></div>}
          </div>
          {error && <ErrorBox error={error} />}
          {lot.mode === "advanced" && <div className="text-[11px] text-ink-400">Automatic control is on: it corrects temperature, humidity and gases within safe limits and logs each action.</div>}
        </div>
      )}
      <div>
        <div className="ph-label">{t("Alerts")} & {t("Suggestions")}</div>
        {alerts.length === 0 && <div className="border border-paper-300 p-3 text-sm text-ink-400">{lot.mode === "advanced" ? "No emergencies. Small issues are fixed automatically and listed in the log below." : "No alerts. Conditions are within the recommended range."}</div>}
        <div className="space-y-2">
          {alerts.map((a: any, i: number) => (
            <div key={i} className={cn("border-l-4 bg-white p-3", a.severity === "CRITICAL" ? "border-critical" : "border-gold")}>
              <div className="text-sm font-bold text-ink">{a.title}</div>
              <div className="text-xs text-ink-400">{a.message}</div>
              {a.recommendation && <div className="mt-1 text-xs text-gold">→ {a.recommendation}</div>}
            </div>
          ))}
        </div>
      </div>
      <LogList events={lot.events || []} />
      <div className="text-center text-[10px] uppercase tracking-wider text-ink-400">Godown readings are simulated virtual sensors · outside weather: {st.ambient.source?.replace("_", " ")}</div>
    </div>
  );
}

/* ---------------- alerts: which part of the app they belong to, and a short ding ---------------- */
const TRACK_KINDS = ["dispatched", "checkpoint", "rerouted", "arrived", "dispatch_failed", "route_delay", "road_blocked", "refrigeration_failure", "extended_delay", "high_external_temp"];
function sectionOf(e: any): string {
  if (e.kind === "delivered" || e.kind?.startsWith("choice_")) return "history";
  if (e.where === "truck" || TRACK_KINDS.includes(e.kind)) return "track";
  if (["unsellable_on_entry", "spoilage_risk", "high_spoilage_risk"].includes(e.kind)) return "predict";
  return "godown";
}
let dingCtx: AudioContext | null = null;
function ding(critical: boolean) {
  try {
    dingCtx = dingCtx || new (window.AudioContext || (window as any).webkitAudioContext)();
    const ctx = dingCtx, t0 = ctx.currentTime;
    (critical ? [988, 1319, 988] : [880, 1319]).forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.14);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.14 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.14 + 0.45);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + i * 0.14); o.stop(t0 + i * 0.14 + 0.5);
    });
  } catch { /* sound not available */ }
}

/* ---------------- shell ---------------- */
const TABS = [
  { id: "entry", label: "New entry", icon: Plus },
  { id: "godown", label: "Godown", icon: Warehouse },
  { id: "predict", label: "Predict", icon: LineChart },
  { id: "track", label: "Track", icon: Truck },
  { id: "history", label: "History", icon: History },
  { id: "help", label: "Help", icon: Bot },
] as const;

function App({ stationId }: { stationId: number }) {
  const t = useT();
  const { lang, set } = useLang();
  const { state, events, connected } = useStationLive(stationId, true);
  const [tab, setTab] = useState<string>("entry");
  const [lotId, setLotId] = useState<number | null>(null);
  const [toasts, setToasts] = useState<any[]>([]);
  const [flagged, setFlagged] = useState<Record<string, boolean>>({});   // tabs with an unseen alert (red dot)
  const [pushState, setPushState] = useState<string | null>(null);
  const lots = state?.lots || [];
  const lot = useMemo(() => lots.find((l: any) => l.id === lotId) || lots[0], [lots, lotId]);
  useEffect(() => { if (!lotId && lots[0]) { setLotId(lots[0].id); setTab((x) => (x === "entry" ? "godown" : x)); } }, [lots, lotId]);
  useEffect(() => {
    const e = events[events.length - 1];
    if (!e || e.log) return;
    const sec = sectionOf(e);
    setToasts([{ ...e, section: sec }]);
    setFlagged((f) => ({ ...f, [sec]: true }));
    ding(e.severity === "CRITICAL");
    setTimeout(() => setToasts((x) => x.filter((y) => y.key !== e.key)), 2200);
    if (e.kind === "delivered") setTab("history");
  }, [events]);
  useEffect(() => { setFlagged((f) => (f[tab] ? { ...f, [tab]: false } : f)); }, [tab]);
  const openAlert = (e: any) => {
    if (e.lot_id) setLotId(e.lot_id);
    setTab(e.section);
    setToasts([]);
  };
  const refresh = () => undefined;   // WebSocket pushes the new state within a second
  const visible = TABS;
  return (
    <div className="phone-ui mx-auto flex min-h-screen max-w-md flex-col bg-paper text-ink shadow-[0_0_60px_rgba(10,38,36,0.12)]">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b-2 border-coral/60 bg-paper/90 px-3 py-2 shadow-[0_4px_20px_rgba(255,104,74,0.12)] backdrop-blur">
        <div className="flex items-center gap-2"><img src="/logo.png" alt="ZERO ROT" className="h-8 w-auto" />
          <div className="leading-tight"><div className="flex items-center gap-1 text-[10px] text-ink-400"><span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-ok" : "bg-critical")} />{t("Live on laptop")}</div></div></div>
        <div className="flex items-center gap-2">
          {pushSupported() && <button aria-label="Notifications" className="p-2 text-ink-400" onClick={async () => { try { await enablePush(true); setPushState("on"); } catch (e: any) { setPushState(e.message); } }}><Bell className={cn("h-5 w-5", pushState === "on" && "text-gold")} /></button>}
          <button onClick={() => set(lang === "en" ? "kn" : "en")} className="flex items-center gap-1 border border-paper-300 px-2 py-1 text-xs font-bold"><Languages className="h-3.5 w-3.5" />{lang === "en" ? "ಕನ್ನಡ" : "EN"}</button>
        </div>
      </header>
      {pushState && pushState !== "on" && <div className="bg-white px-3 py-1.5 text-[11px] text-gold">{pushState}</div>}
      {lots.length > 0 && tab !== "entry" && (
        <div className="flex gap-2 overflow-x-auto border-b border-paper-300 px-3 py-2">
          {lots.map((l: any) => (
            <button key={l.id} onClick={() => setLotId(l.id)} className={cn("shrink-0 border px-2.5 py-1.5 text-left text-[11px]", lot?.id === l.id ? "border-teal bg-teal text-white" : "border-paper-300 text-ink-400")}>
              <b className="capitalize">{l.commodity}</b> · {kg(l.quantity_kg)} · <span className="text-gold">{STAGE_LABEL[l.stage]}</span>
            </button>
          ))}
        </div>
      )}
      <main className="flex-1">
        {lot?.pending_fixes?.length > 0 && tab !== "entry" && (
          <div className="m-3 space-y-2 rounded-2xl border-2 border-critical/50 bg-white p-3 shadow-lg">
            <div className="text-xs font-bold uppercase tracking-wider text-critical">Needs your approval</div>
            {lot.pending_fixes.map((f: any) => (
              <div key={f.id} className="flex items-center justify-between gap-2 rounded-xl bg-paper-200 p-2">
                <div className="min-w-0 text-xs"><b>{f.alert}</b> · {f.where}<div className="text-ink-400">{f.label}</div></div>
                <button className="shrink-0 rounded-xl bg-teal px-3 py-2 text-xs font-bold text-white" onClick={() => postFix(`/flow/lots/${lot.id}/fixes/${f.id}/approve`, {}, true).catch(() => undefined)}>Approve</button>
              </div>
            ))}
          </div>
        )}
        {!state ? <div className="p-8 text-center"><Spinner /></div>
          : tab === "history" ? <HistoryTab history={state.history || []} />
          : tab === "help" ? <AssistantTab lot={lot} />
          : tab === "entry" || !lot ? <Entry onCreated={(id) => { setLotId(id); setTab("godown"); }} />
          : tab === "godown" ? <GodownTab lot={lot} refresh={refresh} />
          : tab === "predict" ? <PredictTab lot={lot} onDispatched={() => setTab("track")} />
          : tab === "track" ? <TrackTab lot={lot} onHelp={() => setTab("help")} />
          : null}
      </main>
      <div className="pointer-events-none fixed inset-x-3 top-3 z-50 mx-auto flex max-w-[420px] justify-center">
        <AnimatePresence>
          {toasts.map((e) => (
            <motion.button key={e.key} onClick={() => openAlert(e)} initial={{ opacity: 0, y: -70, scale: 0.85 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -70, scale: 0.9 }} transition={{ type: "spring", stiffness: 420, damping: 30 }}
              className={cn("pointer-events-auto flex max-w-full items-center gap-2.5 rounded-full py-2 pl-2 pr-4 text-left text-white shadow-2xl",
                e.severity === "CRITICAL" ? "bg-critical" : e.severity === "WARNING" ? "bg-[#e8542f]" : "bg-teal")} aria-label={`Open ${e.section}: ${e.title}`}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20"><Bell className="h-4 w-4" /></span>
              <span className="min-w-0"><span className="block truncate text-sm font-bold">{e.title}</span>
                <span className="block truncate text-[11px] opacity-90">{e.message}</span></span>
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-md border-t border-paper-300 bg-white/95 shadow-[0_-6px_24px_rgba(10,38,36,0.08)] backdrop-blur" style={{ gridTemplateColumns: `repeat(${visible.length}, 1fr)` }}>
        {visible.map((x) => (
          <button key={x.id} onClick={() => setTab(x.id)} disabled={!["entry", "history", "help"].includes(x.id) && !lot} className={cn("flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold disabled:opacity-30", tab === x.id ? "text-coral" : "text-ink-400")}>
            <span className={cn("relative rounded-full px-3 py-1", tab === x.id && "bg-coral/15", flagged[x.id] && tab !== x.id && "bg-critical/15 text-critical")}><x.icon className="h-5 w-5" />
              {flagged[x.id] && tab !== x.id && <span className="absolute right-1 top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-critical ring-2 ring-white" />}</span>{t(x.label)}
          </button>
        ))}
      </nav>
    </div>
  );
}

export default function PhoneApp() {
  const { token = "" } = useParams();
  const { mobileToken, mobileScope } = useAuth();
  const valid = mobileToken && mobileScope?.type === "station" && mobileScope?.link === token && new Date(mobileScope.expires_at + "Z") > new Date();
  const [sid, setSid] = useState<number | null>(null);
  const [err, setErr] = useState<any>(null);
  useEffect(() => {
    if (!valid) return;
    let stop = false, timer: number | undefined;
    const check = () => api("/flow/me", { mobile: true }).then((d) => { if (!stop) { setErr(null); setSid(d.station_id); } }).catch((e) => {
      if (stop) return;
      if (e.status === 401 || e.status === 403) { setErr(e); useAuth.getState().setMobile("", null); }
      else timer = window.setTimeout(check, 2000);   // backend restarting or network blip: keep the pairing and retry
    });
    check();
    return () => { stop = true; clearTimeout(timer); };
  }, [valid]);
  return (
    <div className="min-h-screen bg-paper-200">
      {!valid ? <div className="mx-auto max-w-md bg-paper"><Pair token={token} /></div> : err ? <div className="p-6"><ErrorBox error={err} /></div> : sid ? <App stationId={sid} /> : <div className="p-8 text-center text-ink"><Spinner /></div>}
    </div>
  );
}
