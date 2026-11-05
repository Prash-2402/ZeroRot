import { lazy, Suspense, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Pause, Play, RotateCcw } from "lucide-react";
import { api, post } from "../lib/api";
import { useSimulationLive } from "../lib/live";
import { days, dur, num, qualityColor, tempColor, when } from "../lib/format";
import { ErrorBox, Loading, Metric, Note, Origin, Panel, Seg, Severity, Spinner, cn } from "./ui";
import { ExplainButton, QRShare, useCommodities } from "./shared";

const TraditionalRoom = lazy(() => import("../three/Rooms").then((m) => ({ default: m.TraditionalRoom })));
const ColdRoom = lazy(() => import("../three/Rooms").then((m) => ({ default: m.ColdRoom })));
const ReeferTruck = lazy(() => import("../three/Truck").then((m) => ({ default: m.ReeferTruck })));

const SPEEDS = [[60, "1 min/s"], [600, "10 min/s"], [1800, "30 min/s"], [3600, "1 h/s"], [7200, "2 h/s"]] as const;

export function useSimulation(id: number | null, mobile = false) {
  const q = useQuery({ queryKey: ["simulation", id, mobile], queryFn: () => api(`/simulations/${id}`, { mobile }), enabled: !!id, refetchInterval: 20000 });
  const { msg, connected } = useSimulationLive(id, mobile);
  const live = msg?.data ?? q.data?.live;
  const status = msg?.status ?? q.data?.status;
  return { sim: q.data, live, status, speed: msg?.speed ?? q.data?.speed, connected, query: q, error: msg?.error };
}

/** Full digital-twin view: 3D scene, live sensors, controls, scenarios, history, alerts and AI explanation. */
export function SimulationView({ id, mobile = false, canControl = true }: { id: number; mobile?: boolean; canControl?: boolean }) {
  const qc = useQueryClient();
  const { sim, live, status, speed, connected, query, error } = useSimulation(id, mobile);
  const [cutaway, setCutaway] = useState(true);
  const comms = useCommodities();
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: any }) => post(`/simulations/${id}/${path}`, body, mobile),
    onSuccess: (d) => { qc.setQueryData(["simulation", id, mobile], d); qc.invalidateQueries({ queryKey: ["simulations"] }); },
  });
  if (query.isLoading) return <Loading label="Loading simulation" />;
  if (query.error) return <ErrorBox error={query.error} />;
  if (!sim) return null;
  const kind = sim.kind as string;
  const tRef = (comms.data?.commodities || []).find((c: any) => c.id === sim.batch?.commodity)?.storage?.temperature_c ?? 12;
  const setpoint = sim.setpoint ?? live?.equipment?.setpoint ?? tRef;
  const r = live?.readings || {};
  const pred = live?.prediction;
  const amb = live?.ambient || {};
  const ctl = (name: string, value: any) => act.mutate({ path: "control", body: { name, value } });
  const scene = kind === "cold_chain" ? <ReeferTruck live={live} setpoint={setpoint} cutaway={cutaway} commodity={sim.batch?.commodity} />
    : kind === "cold_storage" ? <ColdRoom live={live} cfg={sim} setpoint={setpoint} />
    : <TraditionalRoom live={live} cfg={sim} refTemp={tRef} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-ink px-4 py-3 text-paper">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-lg font-semibold">{sim.name}</span>
            <span className={cn("chip", status === "running" ? "bg-ok text-white" : status === "failed" ? "bg-critical text-white" : "bg-ink-600 text-paper")}>{status?.toUpperCase()}</span>
            <Origin kind="simulated" title="All sensor values come from the physics model" />
            <Origin kind={amb.source || "unavailable"} title="Ambient conditions source" />
            {sim.scenario && <span className="chip bg-abnormal text-white">SCENARIO · {sim.scenario.replace(/_/g, " ")}</span>}
          </div>
          <div className="mt-1 font-mono text-[11px] text-ink-300">
            sim time {live?.sim_time?.replace("T", " ") || "—"} · elapsed {dur(live?.t_seconds || 0)}{sim.duration_days ? ` of ${sim.duration_days} d` : sim.route ? ` · trip ${sim.route.distance_km} km` : ""} · {connected ? "● stream live" : "○ stream reconnecting"}
            {sim.weather?.retrieved_at && ` · weather retrieved ${when(sim.weather.retrieved_at)}`}
          </div>
        </div>
        {canControl && (
          <div className="flex flex-wrap items-center gap-2">
            <select className="input w-auto border-ink-500 bg-ink-800 py-1.5 text-xs text-paper" value={speed} onChange={(e) => act.mutate({ path: "speed", body: { speed: Number(e.target.value) } })} aria-label="Simulation speed">
              {SPEEDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {status === "running"
              ? <button className="btn-line-dark" onClick={() => act.mutate({ path: "pause" })}><Pause className="h-4 w-4" /> Pause</button>
              : <button className="btn-gold" disabled={status === "completed" || status === "failed"} onClick={() => act.mutate({ path: "start" })}><Play className="h-4 w-4" /> {sim.sim_seconds > 0 ? "Resume" : "Start"}</button>}
            {!mobile && <button className="btn-line-dark" onClick={() => confirm("Reset this simulation to its initial state?") && act.mutate({ path: "reset" })}><RotateCcw className="h-4 w-4" /> Reset</button>}
            {!mobile && <QRShare resourceType="simulation" resourceId={id} label="QR" />}
          </div>
        )}
      </div>
      <ErrorBox error={act.error} />
      {(error || sim.last_error) && <ErrorBox error={{ message: error || sim.last_error }} />}
      {status === "completed" && sim.summary && <SummaryPanel s={sim.summary} />}

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="relative overflow-hidden border border-ink-600">
          <Suspense fallback={<div className="flex h-[460px] items-center justify-center bg-ink text-ink-300"><Spinner /> Loading 3D twin…</div>}>{scene}</Suspense>
          <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1">
            <span className="chip bg-ink/80 text-paper">DRAG ROTATE · SCROLL ZOOM · RIGHT-DRAG PAN</span>
            {kind === "cold_chain" && <span className="chip bg-ink/80 text-paper">{cutaway ? "CUTAWAY · HEATMAP" : "EXTERIOR"}</span>}
          </div>
          {kind === "cold_chain" && (
            <div className="absolute right-3 top-3"><Seg dark value={cutaway ? "cut" : "ext"} onChange={(v) => setCutaway(v === "cut")} options={[{ value: "ext", label: "Exterior" }, { value: "cut", label: "Cutaway" }]} /></div>
          )}
          <TempLegend setpoint={setpoint} />
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Metric label={kind === "cold_chain" ? "Mean cargo temp" : "Air temperature"} value={num(r.temperature_c)} unit="°C" tone={r.temperature_c != null ? tempColor(r.temperature_c, setpoint) : undefined} sub={kind !== "traditional_storage" ? `setpoint ${num(setpoint)} °C` : `outside ${num(amb.t)} °C`} />
            <Metric label="Relative humidity" value={num(r.rh_pct, 0)} unit="%" sub={`outside ${num(amb.rh, 0)} %`} />
            <Metric label="Oxygen" value={num(r.o2_pct, 2)} unit="%" sub={`pO₂ ${num((r.o2_partial_pa || 0) / 1000, 2)} kPa`} />
            <Metric label="Carbon dioxide" value={num(r.co2_pct, 3)} unit="%" sub={`pCO₂ ${num(r.co2_partial_pa, 0)} Pa`} />
            <Metric label="Quality index" value={num(live?.produce?.quality)} unit="/100" tone={live?.produce?.quality != null ? qualityColor(live.produce.quality) : undefined} sub={`weight loss ${num(live?.produce?.weight_loss_pct, 2)} %`} />
            <Metric label="Shelf life left" value={pred ? days(pred.shelf_life_days) : "—"} sub={pred ? `P10–P90 ${days(pred.shelf_life_p10)} – ${days(pred.shelf_life_p90)}` : "first prediction pending"} />
          </div>
          {kind === "cold_chain" && r.zone_temperatures_c && (
            <Panel title="Cargo zones" sub="Front (unit) → rear (door)">
              <div className="flex gap-1">
                {r.zone_temperatures_c.map((z: number, i: number) => (
                  <div key={i} className="flex-1 py-2 text-center font-mono text-[11px] font-semibold text-ink" style={{ background: tempColor(z, setpoint) }}>{num(z)}°</div>
                ))}
              </div>
            </Panel>
          )}
          <Panel title="Dalton's law" sub="Gas partial pressures in the storage air">
            <div className="space-y-1 font-mono text-[11px]">
              <div>P_atm = {num((r.pressure_pa || 0) / 100, 1)} hPa <span className="text-ink-400">({amb.p ? "live surface pressure" : "standard"})</span></div>
              <div>P_O₂ = x_O₂ × P_atm = {num((r.o2_pct || 0) / 100, 4)} × {num(r.pressure_pa, 0)} = <b>{num(r.o2_partial_pa, 0)} Pa</b></div>
              <div>P_CO₂ = {num(r.co2_partial_pa, 1)} Pa</div>
              <div className="text-ink-400">Outside air: P_O₂ = 0.2095 × (P_atm − P_w)</div>
            </div>
          </Panel>
          {pred && (
            <Panel title="Spoilage risk" sub={pred.assumes}>
              <div className="flex items-baseline gap-2"><span className="num text-3xl font-semibold" style={{ color: pred.spoilage_probability > 0.5 ? "#EB4D3D" : pred.spoilage_probability > 0.2 ? "#F2994A" : "#5FB37C" }}>{num(pred.spoilage_probability * 100, 0)}%</span><span className="text-xs text-ink-400">probability of falling below saleable quality within the remaining {kind === "cold_chain" ? "trip" : "period"}</span></div>
              <div className="mt-1 text-[11px] text-ink-400">Monte Carlo over parameter uncertainty · category {pred.category}</div>
            </Panel>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {canControl && <ControlsPanel sim={sim} live={live} kind={kind} onControl={ctl} onScenario={(s) => act.mutate({ path: "scenario", body: { scenario: s } })} pending={act.isPending} mobile={mobile} />}
        <SensorsPanel sensors={live?.sensors || []} setpoint={setpoint} />
      </div>
      {kind === "cold_chain" && sim.route_geometry && <RoutePanel sim={sim} live={live} />}
      <HistoryPanel id={id} mobile={mobile} kind={kind} setpoint={setpoint} tick={Math.floor((live?.t_seconds || 0) / 3600)} />
      <AlertsPanel id={id} mobile={mobile} />
      {!mobile && <Panel title="AI explanation" sub="Groq explains the numbers above; it does not produce them."><ExplainButton body={{ task: kind === "cold_chain" ? "cold_chain" : "simulation", simulation_id: id }} /></Panel>}
    </div>
  );
}

function TempLegend({ setpoint }: { setpoint: number }) {
  const items = [[-2, "below"], [0, "on target"], [2.5, "+2–3.5"], [4.5, "+3.5–6"], [8, ">+6"]] as const;
  return (
    <div className="absolute bottom-3 left-3 flex gap-1 bg-ink/80 p-1.5 font-mono text-[10px] text-paper">
      {items.map(([d, l]) => <span key={l} className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5" style={{ background: tempColor(setpoint + d, setpoint) }} />{l}</span>)}
    </div>
  );
}

function SummaryPanel({ s }: { s: any }) {
  return (
    <Panel title="Simulation completed" sub="Final state of the simulated batch" className="border-l-4 border-gold">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Metric label="Final quality" value={num(s.final_quality)} unit="/100" />
        <Metric label="Saleable" value={num(s.final_saleable_kg, 0)} unit="kg" />
        <Metric label="Lost" value={num(s.lost_kg, 0)} unit="kg" tone="#EB4D3D" sub={`${num(s.loss_pct)} %`} />
        <Metric label="Energy" value={num(s.energy_kwh)} unit="kWh" />
        <Metric label="Duration" value={num(s.duration_days, 2)} unit="d" />
      </div>
    </Panel>
  );
}

function ControlsPanel({ sim, live, kind, onControl, onScenario, pending, mobile }: { sim: any; live: any; kind: string; onControl: (n: string, v: any) => void; onScenario: (s: string) => void; pending: boolean; mobile: boolean }) {
  const { data } = useQuery({ queryKey: ["scenarios"], queryFn: () => api("/simulations/scenarios", { mobile }), staleTime: 3600000 });
  const eq = live?.equipment || {};
  const ov = live?.overrides || {};
  const scen = data?.scenarios?.[kind] || {};
  const [sp, setSp] = useState<number | null>(null);
  const [ambT, setAmbT] = useState<string>("");
  useEffect(() => { setSp(eq.setpoint ?? null); }, [eq.setpoint]);
  return (
    <Panel title="Controls & scenarios" sub="Changes act on the physics model; values evolve over time, they do not jump." action={pending ? <Spinner /> : null}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Toggle on={!!eq.door_open} label="Door open" onClick={() => onControl("door_open", !eq.door_open)} />
          {kind !== "traditional_storage" && <Toggle on={!!eq.refrigeration_on} label="Refrigeration" onClick={() => onControl("refrigeration_on", !eq.refrigeration_on)} />}
          {kind !== "traditional_storage" && <Toggle on={!!eq.backup_cooling} label="Backup cooling" onClick={() => onControl("backup_cooling", !eq.backup_cooling)} />}
          {kind === "traditional_storage" && <Toggle on={!!eq.vents_open} label="Vents open" onClick={() => onControl("vents_open", !eq.vents_open)} />}
        </div>
        {kind !== "traditional_storage" && sp !== null && (
          <div>
            <div className="label">Setpoint · {num(sp)} °C</div>
            <input type="range" min={-1} max={20} step={0.5} value={sp} onChange={(e) => setSp(Number(e.target.value))} onMouseUp={() => onControl("setpoint", sp)} onTouchEnd={() => onControl("setpoint", sp)} className="w-full accent-[#FF684A]" aria-label="Setpoint" />
          </div>
        )}
        {kind === "cold_chain" && (
          <div>
            <div className="label">Truck speed · {num(live?.route?.speed_kmh, 0)} km/h</div>
            <input type="range" min={0} max={90} step={5} defaultValue={live?.route?.speed_kmh ?? 45} onMouseUp={(e) => onControl("speed_kmh", Number((e.target as HTMLInputElement).value))} className="w-full accent-[#FF684A]" aria-label="Truck speed" />
          </div>
        )}
        {!mobile && (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <div className="label">Manual outside temperature</div>
              <input className="input w-28" type="number" placeholder={ov.ambient_t != null ? String(ov.ambient_t) : "live"} value={ambT} onChange={(e) => setAmbT(e.target.value)} />
            </div>
            <button className="btn-line" disabled={ambT === ""} onClick={() => { onControl("ambient_t", Number(ambT)); setAmbT(""); }}>Override</button>
            {ov.ambient_t != null && <button className="btn-line" onClick={() => onControl("ambient_t", null)}>Back to live</button>}
          </div>
        )}
        {!mobile && Object.keys(scen).length > 0 && (
          <div>
            <div className="label mb-1">Scenarios</div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {Object.entries(scen).map(([k, d], i) => (
                <button key={k} title={d as string} onClick={() => onScenario(k)}
                  className={cn("border px-2 py-1.5 text-left text-xs", (sim.scenario || "normal") === k ? "border-gold bg-gold-50 font-semibold" : "border-paper-300 bg-white hover:border-ink")}>
                  <span className="font-mono text-ink-400">{i + 1}.</span> {k.replace(/_/g, " ")}
                </button>
              ))}
            </div>
            <div className="mt-1 text-[11px] text-ink-400">{scen[sim.scenario || "normal"]}</div>
          </div>
        )}
        {live?.faults?.length > 0 && <Note tone="warn">Active faults: {live.faults.join(", ")}</Note>}
      </div>
    </Panel>
  );
}

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return <button onClick={onClick} className={cn("border px-3 py-1.5 text-xs font-semibold", on ? "border-ink bg-ink text-gold" : "border-paper-300 bg-white text-ink-400")}>{label}: {on ? "ON" : "OFF"}</button>;
}

function SensorsPanel({ sensors, setpoint }: { sensors: any[]; setpoint: number }) {
  return (
    <Panel title="Virtual sensors" sub="SIMULATED readings generated from the model state">
      <div className="max-h-[340px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead><tr className="table-head"><th className="py-1 text-left">ID</th><th className="text-left">Sensor</th><th className="text-right">Value</th></tr></thead>
          <tbody className="table-body">
            {sensors.map((s) => (
              <tr key={s.id}>
                <td className="py-1 font-mono">{s.id}</td>
                <td>{s.label}</td>
                <td className="text-right font-mono font-semibold" style={s.kind === "temperature" ? { color: tempColor(s.value, setpoint) } : undefined}>
                  {s.kind === "door" || s.kind === "vents" ? (s.value ? "open" : "closed") : s.kind === "cooling_status" ? (s.value ? "on" : "off")
                    : s.kind === "gps" ? `${s.lat?.toFixed(4)}, ${s.lng?.toFixed(4)}` : s.kind === "pressure" ? `${num(s.value / 100, 1)} hPa`
                    : `${num(s.value, s.kind === "co2" ? 3 : s.kind === "power" ? 2 : 1)} ${s.unit === "degC" ? "°C" : s.unit}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!sensors.length && <div className="p-3 text-xs text-ink-400">No readings yet — start the simulation.</div>}
      </div>
    </Panel>
  );
}

function RoutePanel({ sim, live }: { sim: any; live: any }) {
  const g: [number, number][] = sim.route_geometry || [];
  if (g.length < 2) return null;
  const lats = g.map((p) => p[0]), lngs = g.map((p) => p[1]);
  const [a, b, c, d] = [Math.min(...lngs), Math.max(...lngs), Math.min(...lats), Math.max(...lats)];
  const W = 600, H = 260, pad = 20;
  const sx = (lng: number) => pad + ((lng - a) / (b - a || 1)) * (W - 2 * pad);
  const sy = (lat: number) => H - pad - ((lat - c) / (d - c || 1)) * (H - 2 * pad);
  const path = g.map((p, i) => `${i ? "L" : "M"}${sx(p[1]).toFixed(1)},${sy(p[0]).toFixed(1)}`).join(" ");
  const gps = live?.route?.gps;
  const prog = live?.route ? (live.route.progress_m / (live.route.distance_m || 1)) * 100 : 0;
  return (
    <Panel title="Route" sub={`${sim.route?.origin} → ${sim.route?.dest} · OSRM road geometry`} action={<Origin kind="osrm_live" />}>
      <div className="grid gap-4 md:grid-cols-[1fr_240px]">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full bg-ink">
          <path d={path} fill="none" stroke="#3A3F47" strokeWidth={5} />
          <path d={path} fill="none" stroke="#FF684A" strokeWidth={2} strokeDasharray="1000" />
          <circle cx={sx(g[0][1])} cy={sy(g[0][0])} r={6} fill="#F3EEE8" />
          <circle cx={sx(g[g.length - 1][1])} cy={sy(g[g.length - 1][0])} r={6} fill="#5FB37C" />
          {gps && <circle cx={sx(gps[1])} cy={sy(gps[0])} r={8} fill="#FF684A" stroke="#0A2624" strokeWidth={2} />}
        </svg>
        <div className="space-y-2 text-sm">
          <div><div className="label">Progress</div><div className="mt-1 h-2 bg-paper-300"><div className="h-2 bg-gold" style={{ width: `${Math.min(100, prog)}%` }} /></div><div className="mt-1 font-mono text-xs">{num((live?.route?.progress_m || 0) / 1000)} / {num((live?.route?.distance_m || 0) / 1000)} km</div></div>
          <div><div className="label">ETA (remaining)</div><div className="num">{live?.route?.eta_h != null ? `${num(live.route.eta_h)} h` : "—"}</div></div>
          <div><div className="label">Delay</div><div className="num">{dur(live?.route?.delay_s || 0)}{live?.route?.delay_remaining_s > 0 ? ` (stopped, ${dur(live.route.delay_remaining_s)} left)` : ""}</div></div>
          <div><div className="label">GPS</div><div className="font-mono text-xs">{gps ? `${gps[0].toFixed(4)}, ${gps[1].toFixed(4)}` : "—"}</div></div>
        </div>
      </div>
    </Panel>
  );
}

function HistoryPanel({ id, mobile, kind, setpoint, tick }: { id: number; mobile: boolean; kind: string; setpoint: number; tick: number }) {
  const { data, refetch } = useQuery({ queryKey: ["sim-history", id], queryFn: () => api(`/simulations/${id}/history`, { mobile }) });
  useEffect(() => { refetch(); }, [tick, refetch]);
  const rows = (data?.series || []).map((h: any) => ({ ...h, hours: +(h.t / 3600).toFixed(2) }));
  return (
    <Panel title="History" sub={data?.label || "SIMULATED"}>
      {rows.length < 2 ? <div className="p-4 text-xs text-ink-400">History appears after the simulation runs for a while.</div> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={rows} margin={{ left: -10, right: 8 }}>
                <CartesianGrid stroke="#E2DFD8" vertical={false} />
                <XAxis dataKey="hours" type="number" tick={{ fontSize: 10 }} unit=" h" domain={["dataMin", "dataMax"]} tickFormatter={(v) => String(Math.round(v))} />
                <YAxis tick={{ fontSize: 10 }} unit="°" />
                <Tooltip formatter={(v: any) => num(v)} labelFormatter={(l) => `${l} h`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line dataKey="temp" name="Inside °C" stroke="#0A2624" dot={false} strokeWidth={2} isAnimationActive={false} />
                {kind === "cold_chain" && <Line dataKey="max_zone" name="Warmest zone °C" stroke="#EB4D3D" dot={false} isAnimationActive={false} />}
                <Line dataKey="amb_t" name="Outside °C" stroke="#F2994A" dot={false} strokeDasharray="4 3" isAnimationActive={false} />
                {kind !== "traditional_storage" && <Line dataKey={() => setpoint} name="Setpoint" stroke="#2F80ED" dot={false} strokeDasharray="2 4" isAnimationActive={false} />}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={rows} margin={{ left: -10, right: 8 }}>
                <CartesianGrid stroke="#E2DFD8" vertical={false} />
                <XAxis dataKey="hours" type="number" tick={{ fontSize: 10 }} unit=" h" domain={["dataMin", "dataMax"]} tickFormatter={(v) => String(Math.round(v))} />
                <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                <Tooltip formatter={(v: any) => num(v)} labelFormatter={(l) => `${l} h`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line dataKey="q" name="Quality index" stroke="#FF684A" dot={false} strokeWidth={2} isAnimationActive={false} />
                <Line dataKey="rh" name="RH %" stroke="#7FC4FF" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Panel>
  );
}

const fmtVal = (v: any): string => v == null ? "—" : typeof v === "object"
  ? Object.entries(v).map(([k, x]) => `${k.replace(/_/g, " ")} ${typeof x === "number" ? +x.toFixed(3) : String(x)}`).join(", ") : String(v);

export function AlertRow({ a, mobile = false, onAck }: { a: any; mobile?: boolean; onAck?: () => void }) {
  return (
    <div className={cn("border-l-4 bg-white p-3", a.severity === "CRITICAL" ? "border-critical" : a.severity === "WARNING" ? "border-gold" : "border-coldlight")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2"><Severity s={a.severity} /><span className="text-sm font-semibold">{a.title}</span>{a.status !== "open" && <span className="chip bg-paper-300">{a.status}</span>}</div>
        <span className="font-mono text-[11px] text-ink-400">{when(a.created_at)} · sim +{dur(a.sim_seconds || 0)}</span>
      </div>
      <div className="mt-1 text-xs">{a.message}</div>
      <div className="mt-2 grid gap-1 text-[11px] sm:grid-cols-3">
        <div><span className="label">Reading </span>{fmtVal(a.reading)}</div>
        <div><span className="label">Expected </span>{fmtVal(a.expected)}</div>
        <div><span className="label">Risk </span>{fmtVal(a.risk)}</div>
      </div>
      {a.recommendation && <div className="mt-1 text-xs"><b>Recommended:</b> {a.recommendation}</div>}
      {a.status === "open" && onAck && <button className="btn-line mt-2 py-1 text-xs" onClick={onAck}>Acknowledge</button>}
      {!mobile && <div className="hidden" />}
    </div>
  );
}

function AlertsPanel({ id, mobile }: { id: number; mobile: boolean }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["alerts", "sim", id], queryFn: () => api(`/simulations/${id}/alerts`, { mobile }), refetchInterval: 15000 });
  const actions = useQuery({ queryKey: ["actions", id], queryFn: () => api(`/corrective-actions?simulation_id=${id}`), enabled: !mobile, refetchInterval: 15000 });
  const ack = useMutation({ mutationFn: (aid: number) => post(`/alerts/${aid}/acknowledge`, {}, mobile), onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }) });
  const apply = useMutation({ mutationFn: (cid: number) => post(`/corrective-actions/${cid}/apply`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["actions", id] }); qc.invalidateQueries({ queryKey: ["simulation", id] }); } });
  const list = data?.alerts || [];
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <Panel title={`Events & alerts (${list.length})`} sub="Raised by threshold rules on the simulated readings">
        <div className="max-h-[420px] space-y-2 overflow-y-auto">
          {list.length === 0 && <div className="p-3 text-xs text-ink-400">No events. Alerts appear when a reading leaves its safe range.</div>}
          {list.map((a: any) => <AlertRow key={a.id} a={a} mobile={mobile} onAck={() => ack.mutate(a.id)} />)}
        </div>
      </Panel>
      {!mobile && (
        <Panel title="Corrective actions" sub="Recommended and automatic responses">
          <ErrorBox error={apply.error} />
          <div className="max-h-[420px] space-y-2 overflow-y-auto">
            {(actions.data?.actions || []).length === 0 && <div className="p-3 text-xs text-ink-400">None yet.</div>}
            {(actions.data?.actions || []).map((c: any) => (
              <div key={c.id} className="border border-paper-300 bg-white p-2 text-xs">
                <div className="flex items-center justify-between gap-2"><b>{c.action.replace(/_/g, " ")}</b>{c.automatic ? <span className="chip bg-ink text-gold">AUTO</span> : c.applied ? <span className="chip bg-ok text-white">APPLIED</span> : <button className="btn-gold py-0.5 text-[11px]" onClick={() => apply.mutate(c.id)}>Apply</button>}</div>
                <div className="mt-0.5 text-ink-400">{c.reason}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
