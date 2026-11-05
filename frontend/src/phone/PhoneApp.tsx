import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Bot, Crosshair, DoorOpen, Fan, Languages, LineChart, MapPin, PackageCheck, Plus, ScanLine, Search, Snowflake, Thermometer, Truck, Warehouse, Wind } from "lucide-react";
import { api, post } from "../lib/api";
import { days, kg, num, qualityColor, tempColor } from "../lib/format";
import { useAuth } from "../stores/auth";
import { enablePush, pushSupported } from "../lib/push";
import { ErrorBox, Spinner, cn } from "../components/ui";
import { useLang, useT } from "./i18n";
import { useStationLive } from "./usePhone";
import { PredictTab } from "./PhonePredict";
import { BagTab, HelpTab, TrackTab } from "./PhoneTrack";

export const CROPS = [
  { id: "tomato", name: "Tomato", kn: "ಟೊಮೆಟೊ", img: "/produce/tomato_fresh.jpg" },
  { id: "mango", name: "Mango", kn: "ಮಾವು", img: "/produce/mango_fresh.jpg" },
  { id: "banana", name: "Banana", kn: "ಬಾಳೆಹಣ್ಣು", img: "/produce/banana_fresh.jpg" },
  { id: "potato", name: "Potato", kn: "ಆಲೂಗಡ್ಡೆ", img: null },
];
export const STAGE_LABEL: Record<string, string> = { intake: "Loading", storage: "Stored", grading: "Scan & bag", graded: "Bagged", dispatched: "In transit", arrived: "Arrived", delivered: "Delivered" };

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
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center bg-gold"><span className="font-display text-3xl font-black text-ink">Z</span></div>
        <h1 className="font-display text-3xl font-bold text-paper">{t("Enter PIN")}</h1>
        <p className="mt-2 text-sm text-ink-300">The 6-digit PIN is shown on the laptop next to the QR code.</p>
      </div>
      <input className="w-full border-2 border-ink-500 bg-ink-800 py-4 text-center font-mono text-4xl tracking-[0.5em] text-paper outline-none focus:border-gold"
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
  const [maturity, setMaturity] = useState("turning");
  const [mode, setMode] = useState<"traditional" | "advanced">("advanced");
  const [loc, setLoc] = useState<{ name: string; lat: number; lng: number } | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<any>(null);
  const kgVal = (Number(qty) || 0) * (unit === "t" ? 1000 : 1);
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
      const lot = await post("/flow/lots", { commodity: crop, quantity_kg: kgVal, quality: cond, maturity: ["tomato", "mango", "banana"].includes(crop) ? maturity : null,
        mode, lat: loc!.lat, lng: loc!.lng, location_name: loc!.name, speed: 60, plan_days: plan }, true);
      onCreated(lot.id);
    } catch (e) { setError(e); } finally { setBusy(null); }
  };
  return (
    <div className="space-y-6 p-4 pb-28">
      <section>
        <div className="ph-label">1 · {t("Crop")}</div>
        <div className="grid grid-cols-4 gap-2">
          {CROPS.map((c) => (
            <button key={c.id} onClick={() => setCrop(c.id)} className={cn("overflow-hidden border-2 text-center", crop === c.id ? "border-gold" : "border-ink-600")}>
              {c.img ? <img src={c.img} alt="" className="aspect-square w-full object-cover" /> : <div className="flex aspect-square items-center justify-center bg-ink-700 text-3xl">🥔</div>}
              <div className={cn("py-1 text-[11px] font-semibold", crop === c.id ? "bg-gold text-ink" : "bg-ink-800 text-paper")}>{lang === "kn" ? c.kn : c.name}</div>
            </button>
          ))}
        </div>
      </section>
      <section>
        <div className="ph-label">2 · {t("Quantity")}</div>
        <div className="flex">
          <input className="ph-input min-w-0 flex-1 text-2xl font-bold" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Quantity" />
          {(["t", "kg"] as const).map((u) => <button key={u} onClick={() => setUnit(u)} className={cn("w-16 shrink-0 border-2 text-sm font-bold", unit === u ? "border-gold bg-gold text-ink" : "border-ink-600 text-paper")}>{u === "t" ? "tonne" : "kg"}</button>)}
        </div>
        <div className="mt-1 text-xs text-ink-300">= {kg(kgVal)}{kgVal > 50000 || kgVal < 50 ? " · must be 50 kg – 50 t" : ""}</div>
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
        <div className="ph-label">{t("Plan to sell within")}</div>
        <div className="grid grid-cols-4 gap-2">{[2, 5, 7, 14].map((d) => <button key={d} onClick={() => setPlan(d)} className={cn("ph-chip text-xs", plan === d && "ph-chip-on")}>{d} d</button>)}</div>
      </section>
      <section>
        <div className="ph-label">4 · {t("Location")}</div>
        {loc ? (
          <div className="flex items-center justify-between border-2 border-gold bg-ink-800 p-3 text-paper">
            <span className="flex items-center gap-2 text-sm"><MapPin className="h-4 w-4 text-gold" />{loc.name}</span>
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
              <div className="border border-ink-600 bg-ink-800">
                {results.length === 0 && <div className="p-3 text-sm text-ink-300">No places found.</div>}
                {results.map((r, i) => (
                  <button key={i} className="block w-full border-b border-ink-700 px-3 py-2.5 text-left text-sm text-paper last:border-0"
                    onClick={() => setLoc({ name: [r.name, r.admin1].filter(Boolean).join(", "), lat: r.lat, lng: r.lng })}>
                    {r.name}<span className="text-ink-300">{r.admin1 ? `, ${r.admin1}` : ""}</span>
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
            <button key={m} onClick={() => setMode(m)} className={cn("border-2 p-3 text-left", mode === m ? "border-gold bg-gold/10" : "border-ink-600")}>
              <Icon className={cn("h-6 w-6", mode === m ? "text-gold" : "text-ink-300")} />
              <div className="mt-2 font-bold text-paper">{t(m === "traditional" ? "Traditional" : "Advanced")}</div>
              <div className="mt-1 text-[11px] leading-snug text-ink-300">{d}</div>
            </button>
          ))}
        </div>
      </section>
      {error && <ErrorBox error={error} />}
      <button className="w-full bg-gold py-4 text-lg font-bold text-ink disabled:opacity-40" disabled={!loc || kgVal < 50 || kgVal > 50000 || busy === "submit"} onClick={submit}>
        {busy === "submit" ? <Spinner /> : t("Send to godown")}
      </button>
    </div>
  );
}

/* ---------------- godown ---------------- */
function Big({ icon: Icon, label, value, unit, color, sub }: any) {
  return (
    <div className="border border-ink-600 bg-ink-800 p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-ink-300"><Icon className="h-3.5 w-3.5" />{label}</div>
      <div className="mt-1 font-mono text-3xl font-bold" style={{ color: color || "#F5F3EF" }}>{value}<span className="ml-1 text-sm text-ink-300">{unit}</span></div>
      {sub && <div className="text-[11px] text-ink-300">{sub}</div>}
    </div>
  );
}

function GodownTab({ lot, refresh }: { lot: any; refresh: () => void }) {
  const t = useT();
  const st = lot.storage;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<any>(null);
  if (!st) return <div className="p-6 text-ink-300">Godown state unavailable.</div>;
  const r = st.readings, eq = st.equipment, pred = st.prediction;
  const sp = st.setpoint ?? 13;
  const ctl = async (name: string, value: any) => {
    setBusy(true); setError(null);
    try { await post(`/flow/lots/${lot.id}/control`, { name, value }, true); refresh(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const active = ["intake", "storage"].includes(lot.stage);
  const activeCodes = new Set(Object.keys(st.active_alerts || {}).map((c) => c.toLowerCase()));
  const latest = new Map<string, any>();
  for (const e of lot.events || []) if (e.severity !== "INFO" && activeCodes.has(e.kind)) latest.set(e.kind, e);   // newest per alert type
  const alerts = active ? [...latest.values()].reverse() : [];
  return (
    <div className="space-y-4 p-4 pb-28">
      {st.loading && !st.loading.done && (
        <div className="border border-gold bg-gold/10 p-3">
          <div className="flex justify-between text-sm font-bold text-gold"><span>{t("Loading")}…</span><span>{kg(st.loading.kg_loaded)} / {kg(lot.quantity_kg)}</span></div>
          <div className="mt-2 h-2 bg-ink-700"><div className="h-2 bg-gold transition-all" style={{ width: `${st.loading.progress * 100}%` }} /></div>
          <div className="mt-1 text-[11px] text-ink-300">Door stays open while crates are carried in.</div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Big icon={Thermometer} label={`${t("Temperature")} · ${t("Inside")}`} value={num(r.temperature_c)} unit="°C" color={tempColor(r.temperature_c, lot.mode === "advanced" ? sp : 12)} sub={`${t("Outside")} ${num(st.ambient.t)} °C`} />
        <Big icon={Wind} label={t("Humidity")} value={num(r.rh_pct, 0)} unit="%" sub={`${t("Outside")} ${num(st.ambient.rh, 0)} %`} />
        <Big icon={PackageCheck} label={t("Quality")} value={num(st.produce.quality, 0)} unit="/100" color={qualityColor(st.produce.quality)} sub={`weight loss ${num(st.produce.weight_loss_pct, 2)}%`} />
        <Big icon={LineChart} label={t("Shelf life")} value={pred ? days(pred.shelf_life_days) : "—"} sub={pred ? `range ${days(pred.shelf_life_p10)} – ${days(pred.shelf_life_p90)}` : "calculating…"} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className={cn("border p-2", eq.door_open ? "border-abnormal text-abnormal" : "border-ink-600 text-paper")}><DoorOpen className="mx-auto h-5 w-5" />{t("Door")}: {eq.door_open ? t("Open") : t("Closed")}</div>
        {lot.mode === "traditional"
          ? <div className={cn("border p-2", eq.vents_open ? "border-gold text-gold" : "border-ink-600 text-paper")}><Wind className="mx-auto h-5 w-5" />{t("Vents")}: {eq.vents_open ? t("Open") : t("Closed")}</div>
          : <div className={cn("border p-2", st.flows?.q_cool_w > 0 ? "border-coldlight text-coldlight" : "border-ink-600 text-paper")}><Fan className="mx-auto h-5 w-5" />{t("Cooling")}: {num((st.flows?.q_cool_w || 0) / 1000, 1)} kW</div>}
        <div className="border border-ink-600 p-2 text-paper"><Snowflake className="mx-auto h-5 w-5" />{lot.mode === "advanced" ? `set ${num(sp)} °C` : "no cooling"}</div>
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
          {lot.mode === "advanced" && <div className="text-[11px] text-ink-300">Automatic control is on: it corrects temperature, humidity and gases within safe limits and logs each action.</div>}
        </div>
      )}
      <div>
        <div className="ph-label">{t("Alerts")} & {t("Suggestions")}</div>
        {alerts.length === 0 && <div className="border border-ink-600 p-3 text-sm text-ink-300">No alerts. Conditions are within the recommended range.</div>}
        <div className="space-y-2">
          {alerts.map((a: any, i: number) => (
            <div key={i} className={cn("border-l-4 bg-ink-800 p-3", a.severity === "CRITICAL" ? "border-critical" : "border-gold")}>
              <div className="text-sm font-bold text-paper">{a.title}</div>
              <div className="text-xs text-ink-300">{a.message}</div>
              {a.recommendation && <div className="mt-1 text-xs text-gold">→ {a.recommendation}</div>}
            </div>
          ))}
        </div>
      </div>
      <div className="text-center text-[10px] uppercase tracking-wider text-ink-400">Godown readings are simulated virtual sensors · outside weather: {st.ambient.source?.replace("_", " ")}</div>
    </div>
  );
}

/* ---------------- shell ---------------- */
const TABS = [
  { id: "entry", label: "New entry", icon: Plus },
  { id: "godown", label: "Godown", icon: Warehouse },
  { id: "predict", label: "Predict", icon: LineChart },
  { id: "bag", label: "Scan & bag", icon: ScanLine },
  { id: "track", label: "Track", icon: Truck },
  { id: "help", label: "Help", icon: Bot },
] as const;

function App({ stationId }: { stationId: number }) {
  const t = useT();
  const { lang, set } = useLang();
  const { state, events, connected } = useStationLive(stationId, true);
  const [tab, setTab] = useState<string>("entry");
  const [lotId, setLotId] = useState<number | null>(null);
  const [toasts, setToasts] = useState<any[]>([]);
  const [pushState, setPushState] = useState<string | null>(null);
  const lots = state?.lots || [];
  const lot = useMemo(() => lots.find((l: any) => l.id === lotId) || lots[0], [lots, lotId]);
  useEffect(() => { if (!lotId && lots[0]) { setLotId(lots[0].id); setTab((x) => (x === "entry" ? "godown" : x)); } }, [lots, lotId]);
  useEffect(() => {
    const e = events[events.length - 1];
    if (!e) return;
    setToasts([e]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.key !== e.key)), 6000);
    if (["delivered", "completed"].includes(e.kind)) setTab("track");
  }, [events]);
  const refresh = () => undefined;   // WebSocket pushes the new state within a second
  const visible = TABS.filter((x) => x.id !== "bag" || lot?.mode === "advanced");
  return (
    <div className="flex min-h-screen flex-col bg-ink text-paper">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-ink-700 bg-ink/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2"><div className="flex h-8 w-8 items-center justify-center bg-gold font-display text-lg font-black text-ink">Z</div>
          <div className="leading-tight"><div className="font-display text-sm font-bold tracking-wider">ZERO ROT</div><div className="flex items-center gap-1 text-[10px] text-ink-300"><span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-ok" : "bg-critical")} />{t("Live on laptop")}</div></div></div>
        <div className="flex items-center gap-2">
          {pushSupported() && <button aria-label="Notifications" className="p-2 text-ink-300" onClick={async () => { try { await enablePush(true); setPushState("on"); } catch (e: any) { setPushState(e.message); } }}><Bell className={cn("h-5 w-5", pushState === "on" && "text-gold")} /></button>}
          <button onClick={() => set(lang === "en" ? "kn" : "en")} className="flex items-center gap-1 border border-ink-600 px-2 py-1 text-xs font-bold"><Languages className="h-3.5 w-3.5" />{lang === "en" ? "ಕನ್ನಡ" : "EN"}</button>
        </div>
      </header>
      {pushState && pushState !== "on" && <div className="bg-ink-800 px-3 py-1.5 text-[11px] text-gold">{pushState}</div>}
      {lots.length > 0 && tab !== "entry" && (
        <div className="flex gap-2 overflow-x-auto border-b border-ink-700 px-3 py-2">
          {lots.map((l: any) => (
            <button key={l.id} onClick={() => setLotId(l.id)} className={cn("shrink-0 border px-2.5 py-1.5 text-left text-[11px]", lot?.id === l.id ? "border-gold text-paper" : "border-ink-600 text-ink-300")}>
              <b className="capitalize">{l.commodity}</b> · {kg(l.quantity_kg)} · <span className="text-gold">{STAGE_LABEL[l.stage]}</span>
            </button>
          ))}
        </div>
      )}
      <main className="flex-1">
        {!state ? <div className="p-8 text-center"><Spinner /></div>
          : tab === "entry" || !lot ? <Entry onCreated={(id) => { setLotId(id); setTab("godown"); }} />
          : tab === "godown" ? <GodownTab lot={lot} refresh={refresh} />
          : tab === "predict" ? <PredictTab lot={lot} onDispatched={() => setTab("track")} />
          : tab === "bag" ? <BagTab lot={lot} />
          : tab === "track" ? <TrackTab lot={lot} onHelp={() => setTab("help")} />
          : <HelpTab lot={lot} />}
      </main>
      <div className="pointer-events-none fixed inset-x-3 bottom-20 z-40 space-y-2">
        <AnimatePresence>
          {toasts.map((e) => (
            <motion.div key={e.key} initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className={cn("border border-ink-600 border-l-4 bg-ink-800 p-3 shadow-2xl", e.severity === "CRITICAL" ? "border-critical" : e.severity === "WARNING" ? "border-gold" : "border-ok")}>
              <div className="text-sm font-bold">{e.title}</div><div className="text-xs text-ink-300">{e.message}</div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid border-t border-ink-700 bg-ink/95 backdrop-blur" style={{ gridTemplateColumns: `repeat(${visible.length}, 1fr)` }}>
        {visible.map((x) => (
          <button key={x.id} onClick={() => setTab(x.id)} disabled={x.id !== "entry" && !lot} className={cn("flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold disabled:opacity-30", tab === x.id ? "text-gold" : "text-ink-300")}>
            <x.icon className="h-5 w-5" />{t(x.label)}
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
    api("/flow/me", { mobile: true }).then((d) => setSid(d.station_id)).catch((e) => { setErr(e); useAuth.getState().setMobile("", null); });
  }, [valid]);
  return (
    <div className="min-h-screen bg-ink">
      {!valid ? <Pair token={token} /> : err ? <div className="p-6"><ErrorBox error={err} /></div> : sid ? <App stationId={sid} /> : <div className="p-8 text-center text-paper"><Spinner /></div>}
    </div>
  );
}
