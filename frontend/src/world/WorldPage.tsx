import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { Bug, Camera, ChevronRight, Eye, EyeOff, History, LogOut, Pause, Play, QrCode, RotateCcw, ScrollText, SkipForward, Smartphone, X } from "lucide-react";
import { api, post } from "../lib/api";
import { days, kg, num, qualityColor, tempColor } from "../lib/format";
import { useAuth } from "../stores/auth";
import { useStationLive } from "../phone/usePhone";
import { cn } from "../components/ui";
import { LocationPicker, type Loc } from "../components/shared";
import { WorldScene, autoView, type CamView, type Daylight, type Quality } from "./WorldScene";

const STAGES = [["intake", "Intake"], ["storage", "Godown"], ["grading", "Scan & sort"], ["dispatched", "Transit"], ["delivered", "Delivered"]] as const;
const STAGE_IDX: Record<string, number> = { intake: 0, storage: 1, grading: 2, graded: 2, dispatched: 3, arrived: 3, delivered: 4 };
const SPEEDS: [number, string][] = [[1, "1× real time"], [10, "10×"], [60, "1 min/s"], [300, "5 min/s"], [900, "15 min/s"], [3600, "1 h/s"]];
const GODOWN_SCEN: Record<string, string[]> = { traditional: ["normal", "heat_wave", "vents_closed", "door_open"], advanced: ["normal", "cooling_failure", "door_open", "cooling_degradation", "heat_wave", "humidity_deviation"] };
const TRUCK_SCEN = ["road_blocked", "refrigeration_failure", "door_open", "high_external_temp", "extended_delay", "cooling_degradation", "normal"];
const VIEWS: [CamView, string][] = [["auto", "Auto"], ["overview", "Overview"], ["farm", "Farm"], ["trad", "Traditional"], ["adv", "Advanced"], ["grading", "Scan & sort"], ["truck", "Truck"], ["mandi", "Mandi"]];

type Station = { id: number; token: string; pin: string; url: string; expires_at: string };

function useStation() {
  const [st, setSt] = useState<Station | null>(null);
  const [error, setError] = useState<any>(null);
  const create = async () => {
    try {
      const s = await post("/flow/stations", { ttl_minutes: 720 });
      const v: Station = { id: s.id, token: s.token, pin: s.pin, url: s.url, expires_at: s.expires_at };
      try { localStorage.setItem("zr-station", JSON.stringify(v)); } catch { /* ignore */ }
      setSt(v);
    } catch (e) { setError(e); }
  };
  useEffect(() => {
    (async () => {
      let saved: Station | null = null;
      try { saved = JSON.parse(localStorage.getItem("zr-station") || "null"); } catch { /* ignore */ }
      if (saved) {
        try {
          const list = await api("/flow/stations");
          if (list.stations.some((x: any) => x.id === saved!.id)) { setSt(saved); return; }
        } catch (e) { setError(e); return; }
      }
      await create();
    })();
  }, []);
  return { station: st, error, regenerate: create };
}

function Pairing({ station, onClose, big }: { station: Station; onClose?: () => void; big?: boolean }) {
  return (
    <div className="hud p-5 text-center">
      {onClose && <button className="float-right text-ink-500 hover:text-gold" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>}
      <div className="hud-label mb-3 flex items-center justify-center gap-2"><Smartphone className="h-3.5 w-3.5" /> Scan with your phone</div>
      <div className="inline-block bg-white p-3"><QRCodeSVG value={station.url} size={big ? 220 : 170} /></div>
      <div className="mt-3 hud-label">PIN</div>
      <div className="font-mono text-4xl font-bold tracking-[0.35em] text-gold">{station.pin}</div>
      <div className="mt-2 max-w-[260px] break-all text-[10px] text-ink-500">{station.url}</div>
      <div className="mt-1 text-[10px] text-ink-400">Phone and laptop must be on the same network. Expires {new Date(station.expires_at + "Z").toLocaleString()}.</div>
    </div>
  );
}

function LaptopEntry({ stationId, onDone }: { stationId: number; onDone: () => void }) {
  const [f, setF] = useState({ commodity: "tomato", qty: 2000, mode: "advanced" });
  const [loc, setLoc] = useState<Loc | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<any>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try { await api("/flow/lots", { method: "POST", timeoutMs: 60000, json: { commodity: f.commodity, quantity_kg: Number(f.qty), quality: 92, maturity: "turning", mode: f.mode, lat: loc!.lat, lng: loc!.lng, location_name: loc!.name, station_id: stationId, speed: 60 } }); onDone(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div className="hud space-y-2 p-4 text-left text-xs">
      <div className="hud-label">Or start from the laptop (testing)</div>
      <div className="grid grid-cols-3 gap-2">
        <select className="input" value={f.commodity} onChange={(e) => setF({ ...f, commodity: e.target.value })}>{["tomato", "mango", "banana", "potato"].map((c) => <option key={c}>{c}</option>)}</select>
        <input className="input" type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: Number(e.target.value) })} aria-label="kg" />
        <select className="input" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="advanced">advanced</option><option value="traditional">traditional</option></select>
      </div>
      <LocationPicker value={loc} onChange={setLoc} />
      {err && <div className="text-critical">{err.message}</div>}
      <button className="btn-gold w-full" disabled={!loc || busy} onClick={go}>{busy ? "…" : "Start lot"}</button>
    </div>
  );
}

function Stat({ label, value, unit, color, sub }: { label: string; value: any; unit?: string; color?: string; sub?: string }) {
  return (
    <div className="border border-ink/10 bg-white/70 px-2.5 py-2">
      <div className="hud-label">{label}</div>
      <div className="font-mono text-lg font-semibold" style={{ color }}>{value}<span className="ml-0.5 text-[11px] text-ink-500">{unit}</span></div>
      {sub && <div className="text-[10px] text-ink-500">{sub}</div>}
    </div>
  );
}

function ContextPanel({ lot }: { lot: any }) {
  const st = lot.storage;
  const moving = lot.shipments?.filter((s: any) => s.status !== "delivered") || [];
  if (["dispatched", "arrived", "delivered"].includes(lot.stage) || lot.shipments?.length) {
    return (
      <div className="space-y-3">
        {lot.shipments.map((s: any) => {
          const lv = s.live || {};
          const sp = lv.setpoint ?? 13;
          return (
            <div key={s.id} className="space-y-2 border-b border-ink/10 pb-3 last:border-0">
              <div className="flex items-center justify-between text-sm"><b>{s.grade === "ALL" ? "All produce" : s.grade} → {s.destination.name}</b><span className={cn("px-1.5 text-[10px] font-bold", s.status === "delivered" ? "bg-ok" : s.status === "arrived" ? "bg-coldlight text-ink" : "bg-gold text-ink")}>{s.status.replace("_", " ").toUpperCase()}</span></div>
              <div className="h-1.5 bg-ink/10"><div className="h-1.5 bg-gold" style={{ width: `${Math.min(100, ((lv.total_done_km || 0) / (lv.total_km || 1)) * 100)}%` }} /></div>
              <div className="grid grid-cols-2 gap-1.5">
                <Stat label="Distance" value={num(lv.total_done_km)} unit={`/${num(lv.total_km, 0)} km`} />
                <Stat label="ETA" value={lv.route?.eta_h != null ? num(lv.route.eta_h) : "—"} unit="h" sub={lv.route?.delay_s > 300 ? `delay ${num(lv.route.delay_s / 3600)} h` : undefined} />
              </div>
              {!lv.refrigerated && <div className="rounded-lg bg-ink/5 px-2.5 py-2 text-[11px] text-ink-500">Open truck from traditional storage: tracked by location and checkpoints only (no temperature monitoring).</div>}
              {lv.refrigerated && (
                <div className="grid grid-cols-2 gap-1.5">
                  <Stat label="Warmest cargo" value={num(lv.readings?.max_zone_c)} unit="°C" color={lv.readings ? tempColor(lv.readings.max_zone_c, sp) : undefined} sub={`set ${num(sp)} °C · ${num(lv.readings?.rh_pct, 0)}% RH`} />
                  <Stat label="Quality" value={num(lv.produce?.quality, 1)} color={lv.produce ? qualityColor(lv.produce.quality) : undefined} sub={`loss ${num(lv.produce?.weight_loss_pct, 2)}%`} />
                  <Stat label="Spoilage rate" value={num((lv.flows?.decay_rate_per_day ?? 0) * (lv.produce?.quality ?? 0), 1)} unit="pts/day" sub="quality points lost per day now" />
                  <Stat label="Shelf life left" value={lv.prediction ? days(lv.prediction.shelf_life_days) : "—"} sub={lv.prediction ? `risk ${num(lv.prediction.spoilage_probability * 100, 0)}%` : undefined} />
                </div>
              )}
              {lv.refrigerated && lv.readings?.zone_temperatures_c && (
                <div>
                  <div className="hud-label mb-1">Cargo zones (front → door)</div>
                  <div className="flex gap-0.5">{lv.readings.zone_temperatures_c.map((z: number, i: number) => <div key={i} className="flex-1 rounded py-1 text-center font-mono text-[10px] font-bold text-ink" style={{ background: tempColor(z, sp) }}>{num(z)}°</div>)}</div>
                </div>
              )}
              <div className="space-y-0.5 text-[11px]">
                {s.checkpoints.map((c: any, i: number) => <div key={i} className={c.passed ? "text-ok" : "text-ink-500"}>{c.passed ? "✓" : "○"} {c.name || "…"} <span className="text-ink-400">km {num(c.km, 0)}</span></div>)}
                {s.reroute_count > 0 && <div className="text-gold">⟲ rerouted {s.reroute_count}×</div>}
              </div>
            </div>
          );
        })}
        {!moving.length && lot.stage === "delivered" && <div className="text-sm text-ok">All deliveries complete.</div>}
      </div>
    );
  }
  if (lot.grading) {
    const g = lot.grading;
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-1.5">{["A1", "A2", "A3"].map((k) => <Stat key={k} label={`${k} boxes`} value={`${g.bags_filled[k]}/${g.bags[k]}`} sub={kg(g.kg[k])} />)}</div>
        <div className="h-1.5 bg-ink/10"><div className="h-1.5 bg-gold" style={{ width: `${(g.processed_kg / g.total_kg) * 100}%` }} /></div>
        <div className="text-[11px] text-ink-500">Sample of {g.objects} items · rejected {g.counts.rejected} · uncertain {g.counts.uncertain} · {g.method === "virtual_scan" ? "simulated scanner" : g.method === "opencv_classical" ? "OpenCV classical" : g.method}</div>
      </div>
    );
  }
  if (!st) return null;
  const r = st.readings, eq = st.equipment;
  const sp = st.setpoint ?? 12;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5">
        <Stat label="Inside" value={num(r.temperature_c)} unit="°C" color={tempColor(r.temperature_c, sp)} sub={`outside ${num(st.ambient.t)} °C`} />
        <Stat label="Humidity" value={num(r.rh_pct, 0)} unit="%" sub={`outside ${num(st.ambient.rh, 0)} %`} />
        <Stat label="O₂ / CO₂" value={`${num(r.o2_pct, 2)} / ${num(r.co2_pct, 3)}`} unit="%" sub={`pO₂ ${num(r.o2_partial_pa / 1000, 2)} kPa`} />
        <Stat label="Pressure" value={num(r.pressure_pa / 100, 0)} unit="hPa" sub={st.ambient.source?.replace("_", " ")} />
        <Stat label="Quality" value={num(st.produce.quality, 1)} color={qualityColor(st.produce.quality)} sub={`loss ${num(st.produce.weight_loss_pct, 2)}%`} />
        <Stat label="Shelf life" value={st.prediction ? days(st.prediction.shelf_life_days) : "—"} sub={st.prediction ? `${days(st.prediction.shelf_life_p10)}–${days(st.prediction.shelf_life_p90)}` : undefined} />
      </div>
      <div className="flex flex-wrap gap-1 text-[10px]">
        <span className={cn("px-1.5 py-0.5", eq.door_open ? "bg-abnormal text-ink" : "bg-ink/10")}>DOOR {eq.door_open ? "OPEN" : "closed"}</span>
        {lot.mode === "traditional" ? <span className={cn("px-1.5 py-0.5", eq.vents_open ? "bg-gold text-ink" : "bg-ink/10")}>VENTS {eq.vents_open ? "open" : "closed"}</span>
          : <span className={cn("px-1.5 py-0.5", (st.flows?.q_cool_w ?? 0) > 0 ? "bg-coldlight text-ink" : "bg-ink/10")}>COOLING {num((st.flows?.q_cool_w ?? 0) / 1000, 1)} kW · set {num(sp)}°</span>}
        {st.faults?.map((f: string) => <span key={f} className="bg-critical px-1.5 py-0.5">{f.replace(/_/g, " ")}</span>)}
        {st.loading && !st.loading.done && <span className="bg-gold px-1.5 py-0.5 text-ink">LOADING {Math.round(st.loading.progress * 100)}%</span>}
      </div>
      {st.preaged && <div className="rounded-lg bg-gold/10 px-2.5 py-1.5 text-[11px]"><b>Entered {num(st.preaged.days, 0)} days after harvest</b> (kept {st.preaged.kept_label}): Q {num(st.preaged.quality_at_harvest, 0)} → {num(st.preaged.quality_now, 0)}</div>}
      <LossMini loss={st.loss} />
    </div>
  );
}

const CAUSE_COLOR: Record<string, string> = { ageing: "#9DBFBA", temperature: "#FF684A", humidity: "#7FC4FF", chilling: "#2F80ED", ripeness: "#e0a92e", gas: "#8a5cf6" };
function LossMini({ loss }: { loss?: Record<string, number> }) {
  const items = Object.entries(loss || {}).filter(([, v]) => v > 0.05).sort((a, b) => b[1] - a[1]);
  if (!items.length) return null;
  const total = items.reduce((a, [, v]) => a + v, 0);
  return (
    <div>
      <div className="hud-label mb-1">Why quality dropped · −{num(total, 1)} pts</div>
      <div className="flex h-2.5 overflow-hidden rounded-full">{items.map(([k, v]) => <div key={k} style={{ width: `${(v / total) * 100}%`, background: CAUSE_COLOR[k] || "#999" }} title={`${k} −${v.toFixed(1)}`} />)}</div>
      <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-ink-500">{items.map(([k, v]) => <span key={k}><span className="mr-0.5 inline-block h-2 w-2 rounded-full" style={{ background: CAUSE_COLOR[k] }} />{k} −{num(v, 1)}</span>)}</div>
    </div>
  );
}

function HistoryPanel({ history, onClose }: { history: any[]; onClose: () => void }) {
  return (
    <div className="hud pointer-events-auto absolute right-3 top-28 z-40 max-h-[60vh] w-[380px] overflow-auto p-3">
      <div className="mb-2 flex items-center justify-between"><div className="hud-label">History · delivered & discarded</div><button onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button></div>
      {!history.length && <div className="text-xs text-ink-500">Nothing finished yet. Delivered lots leave the world and appear here.</div>}
      {history.map((h) => (
        <div key={h.id} className="border-b border-ink/10 py-2 text-[11px] last:border-0">
          <div className="flex justify-between"><b className="capitalize">{h.commodity.replace("_", " ")} · {kg(h.quantity_kg)}</b><span className={h.stage === "delivered" ? "text-ok" : "text-ink-500"}>{h.stage}</span></div>
          <div className="text-ink-500">{h.code} · {h.mode} · {h.location}</div>
          {h.shipments.map((s: any, i: number) => <div key={i}>✓ {s.grade === "ALL" ? "All" : s.grade} {kg(s.kg)} → {s.to}{s.final_quality != null ? ` · Q ${num(s.final_quality, 0)}` : ""}{s.reroutes ? ` · rerouted ${s.reroutes}×` : ""}</div>)}
        </div>
      ))}
    </div>
  );
}

export default function WorldPage() {
  const nav = useNavigate();
  const logout = useAuth((s) => s.logout);
  const { station, error, regenerate } = useStation();
  const { state, events, connected } = useStationLive(station?.id ?? null, false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [view, setView] = useState<CamView>("auto");
  const [quality, setQuality] = useState<Quality>(() => (localStorage.getItem("zr-quality") as Quality) || "high");
  const [labels, setLabels] = useState(true);
  const [debug, setDebug] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [toasts, setToasts] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [actErr, setActErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [daylight, setDaylight] = useState<Daylight>("auto");
  const [scripts, setScripts] = useState<any[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const resetDemo = () => { if (station && window.confirm("Remove every lot of this station and start the demo again?")) act("reset", () => post(`/flow/stations/${station.id}/reset`, {})); };
  useEffect(() => { api("/flow/scripts").then((d) => setScripts(d.scripts)).catch(() => undefined); }, []);
  const startScript = (name: string) => act(`script-${name}`, () => api(`/flow/scripts/${name}`, { method: "POST", timeoutMs: 60000, json: { station_id: station?.id } }));
  const lots = state?.lots || [];
  const lot = useMemo(() => lots.find((l: any) => l.id === activeId) || lots[0] || null, [lots, activeId]);
  useEffect(() => { if (lots[0] && (!activeId || !lots.some((l: any) => l.id === activeId))) setActiveId(lots[0].id); }, [lots.map((l: any) => l.id).join(",")]);
  useEffect(() => {
    const e = events[events.length - 1];
    if (!e) return;
    if (e.kind === "intake_started") setActiveId(e.lot_id);
    if (e.log) return;
    setToasts((x) => [...x.slice(-3), e]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.key !== e.key)), 7000);
  }, [events]);
  useEffect(() => { try { localStorage.setItem("zr-quality", quality); } catch { /* ignore */ } }, [quality]);
  const auto = autoView(lot);
  const resolved = view === "auto" ? auto : view === "truck" || view === "mandi" ? { view, ship: auto.ship ?? lot?.shipments?.slice(-1)[0]?.id } : { view: (view === "trad" && lot?.mode === "traditional" && lot?.stage === "storage" ? "trad-in" : view === "adv" && lot?.mode === "advanced" && lot?.stage === "storage" ? "adv-in" : view) as any };
  const act = async (label: string, fn: () => Promise<any>) => {
    setBusy(label); setActErr(null);
    try { await fn(); } catch (e: any) { setActErr(e.message); } finally { setBusy(null); }
  };
  const moving = lot?.shipments?.find((s: any) => s.status === "in_transit");
  const scen = lot ? (moving ? TRUCK_SCEN.filter((s) => moving.live?.refrigerated || !["refrigeration_failure", "cooling_degradation"].includes(s)) : ["intake", "storage"].includes(lot.stage) ? GODOWN_SCEN[lot.mode] : []) : [];
  const simTime = moving?.live?.sim_time || lot?.storage?.sim_time;
  const amb = moving?.live?.ambient || lot?.storage?.ambient;
  const wx = moving?.live?.weather_extras || lot?.storage?.weather_extras || {};
  return (
    <div className="world-ui relative h-screen w-screen overflow-hidden bg-ink text-ink">
      <div className="absolute inset-0"><WorldScene lots={lots} activeLot={lot} view={resolved.view} ship={resolved.ship} quality={quality} labels={labels} onQuality={setQuality} onReady={() => setReady(true)} daylight={daylight} /></div>
      {!ready && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-paper">
          <img src="/logo.png" alt="ZERO ROT" className="h-14 w-auto animate-pulse drop-shadow-[0_0_8px_rgba(243,238,232,0.35)]" />
          <div className="text-xs uppercase tracking-[0.2em] text-ink-500">Building the world on your GPU…</div>
        </div>
      )}

      {/* top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-3 p-3">
        <div className="pointer-events-auto flex flex-col gap-2">
          <div className="hud flex items-center gap-3 px-3 py-2">
            <img src="/logo.png" alt="ZERO ROT" className="h-9 w-auto drop-shadow-[0_0_6px_rgba(243,238,232,0.35)]" />
            <div className="leading-tight"><div className="flex items-center gap-1.5 text-[10px] text-ink-500"><span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-ok" : "bg-critical")} />{connected ? "live · backend authoritative" : "reconnecting"}</div></div>
            <button className="ml-2 flex items-center gap-1 border border-gold/50 px-2 py-1 text-[11px] font-semibold text-gold hover:bg-gold hover:text-ink" onClick={() => setShowQR((x) => !x)}><QrCode className="h-3.5 w-3.5" /> Pair phone</button>
          </div>
          {lots.length > 0 && (
            <div className="flex max-w-[60vw] flex-wrap gap-1.5">
              {lots.map((l: any) => (
                <button key={l.id} onClick={() => setActiveId(l.id)} className={cn("hud px-2.5 py-1.5 text-left text-[11px]", lot?.id === l.id && "!border-gold")}>
                  <b className="capitalize">{l.commodity}</b> {kg(l.quantity_kg)} · <span className="text-gold">{l.stage}</span><span className="ml-1 text-ink-400">{l.mode === "advanced" ? "ADV" : "TRAD"}</span>
                </button>
              ))}
            </div>
          )}
          {showQR && station && <div className="w-[300px]"><Pairing station={station} onClose={() => setShowQR(false)} /></div>}
        </div>
        <div className="pointer-events-auto flex flex-col items-end gap-2">
          <div className="hud px-3 py-2 text-right">
            <div className="font-mono text-lg font-semibold">{simTime ? new Date(simTime + "Z").toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</div>
            <div className="text-[10px] text-ink-500">{lot ? `${lot.location.name} · ${amb?.t != null ? `${num(amb.t)} °C ${num(amb.rh, 0)}%` : "weather —"}${wx.cloud_pct != null ? ` · cloud ${Math.round(wx.cloud_pct)}%` : ""}${wx.precip_mm ? ` · rain ${num(wx.precip_mm)} mm/h` : ""}` : "simulated time"} · {amb?.source?.replace("_", " ") || ""}</div>
          </div>
          <div className="hud flex flex-wrap justify-end gap-0.5 p-1">
            {VIEWS.map(([v, l]) => <button key={v} onClick={() => setView(v)} className={cn("px-2 py-1 text-[11px] font-semibold", view === v ? "bg-gold text-ink" : "text-ink-500 hover:text-ink")}>{v === "auto" && <Camera className="mr-1 inline h-3 w-3" />}{l}</button>)}
          </div>
        </div>
      </div>

      {/* no lot yet: pairing */}
      {!lots.length && station && (
        <div className="absolute inset-x-0 bottom-0 top-24 z-20 overflow-y-auto">
          <div className="flex min-h-full flex-wrap items-start justify-center gap-4 px-4 pb-20 pt-4">
            <div className="max-w-sm space-y-3">
              <div className="hud p-5">
                <div className="font-display text-3xl font-bold leading-tight">Field to market,<br /><span className="text-gold">live.</span></div>
                <p className="mt-2 text-sm text-ink-500">Scan the QR code with a phone and enter a crop. This world then shows it being loaded into the godown, stored, graded, sold and driven to the mandi — all from the backend's live simulation.</p>
                <ol className="mt-3 space-y-1 text-xs text-ink-500">{["Live entry on the phone", "Godown: traditional or advanced", "Predict: mandi rates, spoilage, decision", "Scan & sort into A1 / A2 / A3 boxes (advanced)", "Track the truck to the mandi"].map((x, i) => <li key={i}><span className="text-gold">{i + 1}.</span> {x}</li>)}</ol>
              </div>
              {scripts.length > 0 && (
                <div className="hud space-y-2 p-4">
                  <div className="hud-label">Play a sample situation</div>
                  {scripts.map((sc) => (
                    <button key={sc.name} disabled={!!busy} onClick={() => startScript(sc.name)} className="block w-full rounded-xl border border-paper-300 bg-white p-3 text-left hover:border-teal">
                      <div className="flex items-center justify-between text-sm font-semibold"><span>▶ {sc.title}</span><span className="text-[10px] text-ink-500">{sc.steps} events</span></div>
                      <div className="mt-1 text-[11px] leading-snug text-ink-500">{sc.summary}</div>
                    </button>
                  ))}
                </div>
              )}
              <LaptopEntry stationId={station.id} onDone={() => undefined} />
            </div>
            <Pairing station={station} big />
          </div>
        </div>
      )}
      {error && <div className="absolute left-1/2 top-24 -translate-x-1/2 border-l-4 border-critical bg-paper px-4 py-2 text-sm shadow-xl">{error.message} <button className="ml-2 underline" onClick={regenerate}>Retry</button></div>}

      {/* left: lot card */}
      {lot && (
        <div className="pointer-events-auto absolute bottom-20 left-3 z-30 w-[330px] space-y-2">
          <div className="hud p-3">
            <div className="flex items-start justify-between">
              <div><div className="hud-label">{lot.code} · {lot.mode} godown</div><div className="font-display text-xl font-bold capitalize">{lot.commodity} · {kg(lot.quantity_kg)}</div></div>
              <span className="bg-gold px-1.5 py-0.5 text-[10px] font-bold uppercase text-ink">{lot.stage}</span>
            </div>
            {lot.script && <div className="mt-1 rounded-full bg-teal/10 px-2 py-0.5 text-[10px] font-semibold text-teal">▶ {lot.script.title} · {lot.script.done ? "all events played" : `event ${lot.script.step}/${lot.script.steps}`}</div>}
            <div className="hidden">
            </div>
            <div className="mt-3 flex items-center gap-1">
              {STAGES.map(([k, l], i) => {
                const idx = STAGE_IDX[lot.stage];
                const skipped = k === "grading" && lot.mode === "traditional";
                return (
                  <div key={k} className="flex flex-1 flex-col items-center gap-1">
                    <div className={cn("h-1.5 w-full", skipped ? "bg-ink/5" : i < idx ? "bg-gold" : i === idx ? "animate-pulse bg-gold" : "bg-ink/15")} />
                    <div className={cn("text-[9px] uppercase tracking-wider", i === idx ? "text-gold" : "text-ink-400", skipped && "line-through")}>{l}</div>
                  </div>
                );
              })}
            </div>
          </div>
          {lot.pending_fixes?.length > 0 && (
            <div className="hud space-y-1.5 border-critical/40 p-3">
              <div className="hud-label !text-critical">Needs approval</div>
              {lot.pending_fixes.map((f: any) => (
                <div key={f.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/70 p-2 text-[11px]">
                  <div className="min-w-0"><b>{f.alert}</b> · {f.where}<div className="text-ink-500">{f.label}</div></div>
                  <button className="shrink-0 bg-teal px-2.5 py-1.5 font-bold text-white" disabled={!!busy} onClick={() => act(`fix-${f.id}`, () => post(`/flow/lots/${lot.id}/fixes/${f.id}/approve`, {}))}>Approve</button>
                </div>
              ))}
            </div>
          )}
          <div className="hud max-h-[46vh] overflow-y-auto p-3"><ContextPanel lot={lot} /></div>
        </div>
      )}

      {/* right: event feed */}
      <div className="pointer-events-none absolute bottom-20 right-3 z-30 w-[340px] space-y-2">
        <AnimatePresence>
          {toasts.map((e) => (
            <motion.div key={e.key} initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className={cn("hud border-l-4 p-3", e.severity === "CRITICAL" ? "!border-l-critical" : e.severity === "WARNING" ? "!border-l-gold" : "!border-l-ok")}>
              <div className="text-sm font-semibold">{e.title}</div><div className="text-[11px] text-ink-500">{e.message}</div>
              {e.sim_time && <div className="mt-0.5 font-mono text-[10px] text-ink-400">{new Date(e.sim_time + "Z").toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · simulated</div>}
            </motion.div>
          ))}
        </AnimatePresence>
        {lot && showLogs && (
          <div className="hud pointer-events-auto max-h-[34vh] overflow-y-auto p-3">
            <div className="hud-label mb-1 flex justify-between"><span>Log · auto-fixes & minor issues</span><button onClick={() => setShowLogs(false)} aria-label="Hide logs"><X className="h-3.5 w-3.5" /></button></div>
            {[...(lot.events || [])].reverse().slice(0, 40).map((e: any, i: number) => (
              <div key={i} className="border-b border-ink/5 py-1 text-[11px] last:border-0"><span className={e.severity === "CRITICAL" ? "text-critical" : e.severity === "WARNING" ? "text-gold" : e.log ? "text-ink-500" : "text-ink"}>{e.log ? "· " : ""}{e.title}</span> <span className="text-ink-400">{e.sim_time ? new Date(e.sim_time + "Z").toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : ""}</span>
                {e.log && <div className="text-[10px] text-ink-400">{e.message}</div>}</div>
            ))}
          </div>
        )}
      </div>

      {/* bottom: playback + scenarios */}
      {lot && (
        <div className="pointer-events-auto absolute inset-x-3 bottom-3 z-30 flex flex-wrap items-center gap-2">
          <div className="hud flex items-center gap-1 p-1">
            <button className="px-2 py-1.5 hover:text-gold" title={lot.paused ? "Resume" : "Pause"} onClick={() => act("pause", () => post(`/flow/lots/${lot.id}/pause`, { paused: !lot.paused }))}>{lot.paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}</button>
            {[[60, "+1 min"], [600, "+10 min"], [3600, "+1 h"]].map(([s, l]) => (
              <button key={s} className="flex items-center gap-1 px-2 py-1.5 text-[11px] font-semibold hover:text-gold" onClick={() => act("step", () => post(`/flow/lots/${lot.id}/step`, { seconds: s }))}><SkipForward className="h-3 w-3" />{l}</button>
            ))}
            <select className="border border-ink/10 bg-white px-2 py-1 text-[11px]" value={lot.speed} onChange={(e) => act("speed", () => post(`/flow/lots/${lot.id}/speed`, { speed: Number(e.target.value) }))} aria-label="Simulation speed">
              {SPEEDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <span className={cn("px-2 text-[10px] font-bold", lot.paused ? "text-gold" : "text-ok")}>{lot.paused ? "PAUSED" : "RUNNING"}</span>
          </div>
          {scen.length > 0 && (
            <div className="hud flex flex-wrap items-center gap-1 p-1">
              <span className="hud-label px-1">Test</span>
              {scen.map((s) => (
                <button key={s} disabled={!!busy} onClick={() => act(s, () => post(moving ? `/flow/shipments/${moving.id}/scenario` : `/flow/lots/${lot.id}/scenario`, { scenario: s }))}
                  className={cn("border px-2 py-1 text-[11px] font-semibold disabled:opacity-40", s === "road_blocked" ? "border-critical/60 text-critical hover:bg-critical hover:text-white" : "border-ink/10 hover:border-gold hover:text-gold")}>
                  {busy === s ? "…" : s.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          )}
          <div className="hud ml-auto flex items-center gap-1 p-1 text-[11px]">
            <button className={cn("flex items-center gap-1 px-2 py-1.5 font-semibold", showLogs ? "text-gold" : "hover:text-gold")} title="Show / hide logs" onClick={() => setShowLogs((x) => !x)}><ScrollText className="h-4 w-4" />Logs</button>
            <button className={cn("flex items-center gap-1 px-2 py-1.5 font-semibold", showHistory ? "text-gold" : "hover:text-gold")} title="History" onClick={() => setShowHistory((x) => !x)}><History className="h-4 w-4" />History{state?.history?.length ? ` (${state.history.length})` : ""}</button>
            <button className="px-2 py-1.5 hover:text-critical" title="Demo reset" onClick={resetDemo}><RotateCcw className="h-4 w-4" /></button>
            <button className="px-2 py-1.5 hover:text-gold" title="Labels" onClick={() => setLabels((x) => !x)}>{labels ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</button>
            <div className="flex overflow-hidden rounded-lg border border-ink/10">{(["auto", "day", "night"] as const).map((d) => <button key={d} onClick={() => setDaylight(d)} className={cn("px-2 py-1 text-[11px] font-semibold capitalize", daylight === d ? "bg-teal text-white" : "hover:text-teal")}>{d === "auto" ? "Sim time" : d}</button>)}</div>
            {scripts.length > 0 && (
              <select className="border border-ink/10 bg-white px-2 py-1" value="" onChange={(e) => e.target.value && startScript(e.target.value)} aria-label="Play a sample situation">
                <option value="">▶ Sample situation…</option>
                {scripts.map((sc) => <option key={sc.name} value={sc.name}>{sc.title}</option>)}
              </select>
            )}
            <select className="border border-ink/10 bg-white px-2 py-1" value={quality} onChange={(e) => setQuality(e.target.value as Quality)} aria-label="Graphics quality"><option value="high">GPU high</option><option value="medium">medium</option><option value="low">low</option></select>
            <button className={cn("px-2 py-1.5", debug ? "text-gold" : "hover:text-gold")} title="Debug values" onClick={() => setDebug((x) => !x)}><Bug className="h-4 w-4" /></button>
            <Link to="/docs" className="px-2 py-1.5 text-ink-500 hover:text-gold">Docs</Link>
            <button className="px-2 py-1.5 text-ink-500 hover:text-gold" title="Sign out" onClick={() => { logout(); nav("/login"); }}><LogOut className="h-4 w-4" /></button>
          </div>
          {actErr && <div className="w-full text-right text-[11px] text-critical">{actErr}</div>}
        </div>
      )}

      {showHistory && <HistoryPanel history={state?.history || []} onClose={() => setShowHistory(false)} />}
      {!lots.length && station && (state?.history?.length || 0) > 0 && (
        <div className="pointer-events-auto absolute bottom-3 right-3 z-40 flex gap-1">
          <button className="hud flex items-center gap-1 px-3 py-2 text-[11px] font-semibold hover:text-gold" onClick={() => setShowHistory((x) => !x)}><History className="h-4 w-4" />History ({state.history.length})</button>
          <button className="hud flex items-center gap-1 px-3 py-2 text-[11px] font-semibold hover:text-critical" onClick={resetDemo}><RotateCcw className="h-4 w-4" />Demo reset</button>
        </div>
      )}

      {/* debug drawer */}
      {debug && lot && (
        <div className="hud pointer-events-auto absolute right-3 top-28 z-40 max-h-[55vh] w-[380px] overflow-auto p-3 font-mono text-[10px]">
          <div className="hud-label mb-1 flex items-center justify-between">Raw backend values <ChevronRight className="h-3 w-3" /></div>
          <pre className="whitespace-pre-wrap text-ink-500">{JSON.stringify({
            stage: lot.stage, speed: lot.speed, paused: lot.paused, sim_time: lot.storage?.sim_time,
            storage: lot.storage && { readings: lot.storage.readings, ambient: lot.storage.ambient, equipment: lot.storage.equipment, flows: lot.storage.flows, loading: lot.storage.loading, prediction: lot.storage.prediction && { q: lot.storage.prediction.quality, sl: lot.storage.prediction.shelf_life_days, p10: lot.storage.prediction.shelf_life_p10, p90: lot.storage.prediction.shelf_life_p90 } },
            shipments: lot.shipments?.map((s: any) => ({ id: s.id, status: s.status, route: s.live?.route && { progress_m: Math.round(s.live.route.progress_m), distance_m: Math.round(s.live.route.distance_m), speed_kmh: s.live.route.speed_kmh, delay_s: Math.round(s.live.route.delay_s) }, pose: s.live?.pose, zones: s.live?.readings?.zone_temperatures_c })),
            camera: resolved,
          }, null, 1)}</pre>
        </div>
      )}
    </div>
  );
}
