import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FlaskConical, RotateCcw } from "lucide-react";
import { api } from "../lib/api";
import { days, inr, MATURITY, num } from "../lib/format";
import { Badge, Card, cn, Spinner } from "../components/ui";

type Inputs = {
  temperature?: number; humidity?: number; storage_days?: number; transport_hours?: number; transport_temp?: number;
  maturity?: string; initial_quality?: number; quantity_kg?: number; destination_market?: string; sell_day?: number;
};

function Slider({ label, value, min, max, step, unit, onChange, enabled, onToggle }: any) {
  return (
    <div className={cn("rounded-lg border p-2.5 transition-colors", enabled ? "border-forest/30 bg-forest-50/50" : "border-cream-200")}>
      <div className="flex items-center justify-between text-xs">
        <label className="flex items-center gap-1.5 font-medium text-forest"><input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} /> {label}</label>
        <input type="number" step={step} min={min} max={max} disabled={!enabled} value={value} onChange={(e) => onChange(Number(e.target.value))}
          className="num w-20 rounded border border-cream-200 px-1.5 py-0.5 text-right text-xs disabled:opacity-50" />
      </div>
      <input type="range" className="mt-1.5 w-full" min={min} max={max} step={step} value={value} disabled={!enabled} onChange={(e) => onChange(Number(e.target.value))} />
      <div className="flex justify-between text-[10px] text-charcoal-300"><span>{min}{unit}</span><span>{max}{unit}</span></div>
    </div>
  );
}

const DEFAULTS: Required<Omit<Inputs, "destination_market" | "maturity">> & { maturity: string; destination_market: string } = {
  temperature: 17.3, humidity: 85, storage_days: 3, transport_hours: 6, transport_temp: 25, maturity: "turning", initial_quality: 90,
  quantity_kg: 500, destination_market: "m_bengaluru", sell_day: 2,
};

export function WhatIf({ batch }: { batch: any }) {
  const [vals, setVals] = useState({ ...DEFAULTS, quantity_kg: batch.quantity_kg, maturity: batch.maturity || "mature_green", initial_quality: Math.round(batch.quality) });
  const [on, setOn] = useState<Record<string, boolean>>({ temperature: true, humidity: true });
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reqId = useRef(0);
  const ctrl = useRef<AbortController | null>(null);
  const { data: pts } = useQuery({ queryKey: ["points"], queryFn: () => api("/geo/points"), staleTime: Infinity });
  const mandis = (pts?.points || []).filter((p: any) => p.kind === "mandi");

  useEffect(() => {
    const t = setTimeout(async () => {
      const id = ++reqId.current;
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      const body: any = { batch_id: batch.id, request_id: id };
      for (const k of Object.keys(on)) if (on[k]) body[k] = (vals as any)[k];
      setBusy(true);
      setErr(null);
      try {
        const r = await api("/simulations/recalculate", { method: "POST", json: body, signal: c.signal });
        if (r.request_id === reqId.current) setRes(r); // only the latest slider value is ever shown
      } catch (e: any) {
        if (e.name !== "AbortError" && id === reqId.current) setErr(e.message);
      } finally {
        if (id === reqId.current) setBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [vals, on, batch.id]);

  const set = (k: string, v: any) => setVals((x: any) => ({ ...x, [k]: v }));
  const tog = (k: string) => (b: boolean) => setOn((x) => ({ ...x, [k]: b }));
  const chart = res ? res.baseline_trajectory.map((p: any, i: number) => ({ day: p.day, baseline: p.quality, whatif: res.whatif_trajectory[i]?.quality })) : [];
  const rows: [string, (s: any) => string][] = [
    ["Quality now", (s) => `${num(s.quality_now, 1)}%`],
    [`Quality at day ${res?.whatif?.at_day ?? ""}`, (s) => `${num(s.quality_at, 1)}%`],
    ["Shelf life", (s) => (s.beyond_horizon ? "> 30 days" : `${days(s.shelf_life_days)} (${num(s.shelf_p10, 1)}–${num(s.shelf_p90, 1)})`)],
    ["Value now", (s) => inr(s.value_now)],
    [`Value at day ${res?.whatif?.at_day ?? ""}`, (s) => inr(s.value_at)],
    ["Saleable quantity", (s) => `${num(s.saleable_kg, 0)} kg`],
    ["Net profit (recommended)", (s) => inr(s.net_profit)],
    ["Recommended action", (s) => s.action_label || s.action || "—"],
  ];
  return (
    <Card title={<span className="flex items-center gap-2"><FlaskConical className="h-4 w-4" /> What-if simulation</span>}
      subtitle="Tick a factor and move it. Every change re-runs the same decay, value and decision engines on the server. What-if never changes the batch's real history."
      action={<div className="flex items-center gap-2">{busy && <span className="flex items-center gap-1 text-xs text-charcoal-400"><Spinner className="h-3 w-3" /> recalculating</span>}
        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => { setOn({}); }}><RotateCcw className="h-3.5 w-3.5" /> Clear</button></div>}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="grid gap-2 sm:grid-cols-2">
          <Slider label="Storage temperature" unit="°C" min={0} max={40} step={0.1} value={vals.temperature} onChange={(v: number) => set("temperature", v)} enabled={!!on.temperature} onToggle={tog("temperature")} />
          <Slider label="Humidity" unit="%" min={30} max={100} step={1} value={vals.humidity} onChange={(v: number) => set("humidity", v)} enabled={!!on.humidity} onToggle={tog("humidity")} />
          <Slider label="Storage duration" unit=" d" min={0} max={14} step={0.5} value={vals.storage_days} onChange={(v: number) => set("storage_days", v)} enabled={!!on.storage_days} onToggle={tog("storage_days")} />
          <Slider label="Transport duration" unit=" h" min={0} max={48} step={1} value={vals.transport_hours} onChange={(v: number) => set("transport_hours", v)} enabled={!!on.transport_hours} onToggle={tog("transport_hours")} />
          <Slider label="Transport temperature" unit="°C" min={0} max={40} step={0.5} value={vals.transport_temp} onChange={(v: number) => set("transport_temp", v)} enabled={!!on.transport_temp} onToggle={tog("transport_temp")} />
          <Slider label="Starting quality" unit="" min={40} max={100} step={1} value={vals.initial_quality} onChange={(v: number) => set("initial_quality", v)} enabled={!!on.initial_quality} onToggle={tog("initial_quality")} />
          <Slider label="Quantity" unit=" kg" min={100} max={10000} step={50} value={vals.quantity_kg} onChange={(v: number) => set("quantity_kg", v)} enabled={!!on.quantity_kg} onToggle={tog("quantity_kg")} />
          <Slider label="Selling date" unit=" d" min={0} max={14} step={0.5} value={vals.sell_day} onChange={(v: number) => set("sell_day", v)} enabled={!!on.sell_day} onToggle={tog("sell_day")} />
          <div className={cn("rounded-lg border p-2.5", on.maturity ? "border-forest/30 bg-forest-50/50" : "border-cream-200")}>
            <label className="flex items-center gap-1.5 text-xs font-medium text-forest"><input type="checkbox" checked={!!on.maturity} onChange={(e) => tog("maturity")(e.target.checked)} /> Maturity</label>
            <select disabled={!on.maturity} className="input mt-1.5 py-1 text-xs" value={vals.maturity} onChange={(e) => set("maturity", e.target.value)}>
              {Object.entries(MATURITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className={cn("rounded-lg border p-2.5", on.destination_market ? "border-forest/30 bg-forest-50/50" : "border-cream-200")}>
            <label className="flex items-center gap-1.5 text-xs font-medium text-forest"><input type="checkbox" checked={!!on.destination_market} onChange={(e) => tog("destination_market")(e.target.checked)} /> Destination market</label>
            <select disabled={!on.destination_market} className="input mt-1.5 py-1 text-xs" value={vals.destination_market} onChange={(e) => set("destination_market", e.target.value)}>
              {mandis.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        </div>
        <div className="min-w-0">
          {err && <div className="mb-2 rounded-lg bg-rot-50 px-3 py-2 text-xs text-rot">{err}</div>}
          {res ? (
            <div className={cn("transition-opacity", busy && "opacity-60")}>
              <div className="overflow-hidden rounded-lg border border-cream-200">
                <table className="w-full text-sm">
                  <thead className="bg-cream-100"><tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left"><th className="label">Metric</th><th className="label">Baseline</th><th className="label text-forest">What-if</th></tr></thead>
                  <tbody>
                    {rows.map(([l, f]) => {
                      const a = f(res.baseline), b = f(res.whatif);
                      return <tr key={l} className="border-t border-cream-100 [&>td]:px-3 [&>td]:py-1.5"><td className="text-xs text-charcoal-500">{l}</td><td className="num">{a}</td><td className={cn("num font-semibold", a !== b ? "text-forest" : "text-charcoal-500")}>{b}</td></tr>;
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 text-xs text-charcoal-500">{res.whatif.explanation}</div>
              <div className="mt-3 h-44">
                <ResponsiveContainer>
                  <LineChart data={chart} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke="#EEE7D4" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(d) => `D${Math.round(d)}`} interval={7} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: any) => `${num(v, 1)}%`} labelFormatter={(d) => `Day ${num(d as number, 2)}`} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line dataKey="baseline" name="Baseline quality" stroke="#A9BFA8" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line dataKey="whatif" name="What-if quality" stroke="#1F4D3A" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-charcoal-400"><Badge tone="grey">{res.whatif.confidence_category}</Badge> {res.engine}</div>
            </div>
          ) : <div className="flex h-40 items-center justify-center text-sm text-charcoal-400"><Spinner className="mr-2" /> Running baseline…</div>}
        </div>
      </div>
    </Card>
  );
}
