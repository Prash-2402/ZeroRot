import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download } from "lucide-react";
import { api, download, post } from "../lib/api";
import { inr, kg, num } from "../lib/format";
import { Empty, ErrorBox, Field, Metric, Note, PageHead, Panel, Spinner } from "../components/ui";
import { useSims } from "../components/shared";

export default function Analytics() {
  const sims = useSims();
  const fac = useQuery({ queryKey: ["facilities"], queryFn: () => api("/storage/facilities") });
  const summary = useQuery({ queryKey: ["summary"], queryFn: () => api("/analytics/summary") });
  const [f, setF] = useState({ sim: "", zone: "", fault: "refrigeration_failure", price: "" });
  const list = (sims.data?.simulations || []);
  const s = list.find((x: any) => String(x.id) === f.sim);
  const mode = s?.kind === "cold_chain" ? "cold_chain" : "storage";
  const zones = (fac.data?.facilities || []).flatMap((x: any) => x.zones.map((z: any) => ({ ...z, fname: x.name })));
  const body = { mode, simulation_id: Number(f.sim), other_zone_id: f.zone ? Number(f.zone) : null, fault_scenario: f.fault, price_per_kg: f.price ? Number(f.price) : null };
  const m = useMutation({ mutationFn: () => post("/analytics/compare", body, false) });
  const [exp, setExp] = useState<string | null>(null);
  const doExport = async (fmt: "csv" | "pdf") => {
    setExp(null);
    try { await download(`/analytics/compare/export?fmt=${fmt}`, body, `zerorot-comparison-${f.sim}.${fmt}`); } catch (e: any) { setExp(e.message); }
  };
  const r = m.data;
  const chart = r ? [
    { metric: "Lost kg", [r.baseline.label]: r.baseline.lost_kg, [r.improved.label]: r.improved.lost_kg },
    { metric: "Saleable kg", [r.baseline.label]: r.baseline.final_saleable_kg, [r.improved.label]: r.improved.final_saleable_kg },
  ] : [];
  return (
    <div className="space-y-4">
      <PageHead kicker="Analytics" title="Loss & profit comparison" sub="Both sides are run through the same simulation engine with the same batch, weather and duration. Results are counterfactual estimates, not measured savings." />
      {summary.data && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Metric label="Completed simulations" value={summary.data.completed_simulations} />
          <Metric label="Loss in completed sims" value={summary.data.completed_loss_pct != null ? `${num(summary.data.completed_loss_pct)}%` : "—"} />
          <Metric label="Market prices stored" value={summary.data.market_prices_stored} />
          <Metric label="Simulations by type" value={`${summary.data.simulations_by_kind.traditional_storage} / ${summary.data.simulations_by_kind.cold_storage} / ${summary.data.simulations_by_kind.cold_chain}`} sub="traditional / cold room / cold chain" />
        </div>
      )}
      <Panel title="Run a comparison">
        {list.length === 0 ? <Empty title="No simulations to compare">Create a storage or cold-chain simulation first.</Empty> : (
          <form className="grid gap-3 md:grid-cols-5" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
            <div className="md:col-span-2"><Field label="Simulation"><select className="input" value={f.sim} onChange={(e) => setF({ ...f, sim: e.target.value })}><option value="">Choose</option>{list.map((x: any) => <option key={x.id} value={x.id}>#{x.id} {x.name}</option>)}</select></Field></div>
            {s?.kind === "traditional_storage" && <Field label="Compare with cold zone"><select className="input" value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })}><option value="">Choose</option>{zones.map((z: any) => <option key={z.id} value={z.id}>{z.fname} / {z.name}</option>)}</select></Field>}
            {s?.kind === "cold_chain" && <Field label="Fault scenario"><select className="input" value={f.fault} onChange={(e) => setF({ ...f, fault: e.target.value })}>{["refrigeration_failure", "door_open", "cooling_degradation", "high_external_temp", "extended_delay", "humidity_deviation"].map((x) => <option key={x} value={x}>{x.replace(/_/g, " ")}</option>)}</select></Field>}
            <Field label="Price ₹/kg" hint="For revenue (optional)"><input className="input" type="number" step="0.5" min={0} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
            <div className="flex items-end"><button className="btn-gold w-full" disabled={!f.sim || (s?.kind === "traditional_storage" && !f.zone) || m.isPending}>{m.isPending ? <Spinner /> : "Compare"}</button></div>
          </form>
        )}
        {m.isPending && <Note>Running both simulations to completion on the server… this can take up to a minute.</Note>}
        <ErrorBox error={m.error} />
      </Panel>
      {r && (
        <Panel title={`${r.baseline.label} vs ${r.improved.label}`} sub={r.label}
          action={<div className="flex gap-2"><button className="btn-line" onClick={() => doExport("csv")}><Download className="h-4 w-4" /> CSV</button><button className="btn-ink" onClick={() => doExport("pdf")}><Download className="h-4 w-4" /> PDF</button></div>}>
          {exp && <ErrorBox error={{ message: exp }} />}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Metric label="Loss prevented" value={kg(r.loss_prevented_kg)} tone={r.loss_prevented_kg > 0 ? "#5FB37C" : "#EB4D3D"} sub={`${num(r.loss_prevented_pct_points)} percentage points`} />
            <Metric label="Net profit difference" value={r.net_profit_difference != null ? inr(r.net_profit_difference) : "—"} sub={r.net_profit_difference == null ? "no price given" : undefined} />
            <Metric label={`${r.baseline.label} loss`} value={`${num(r.baseline.loss_pct)}%`} sub={`quality ${num(r.baseline.final_quality)}`} />
            <Metric label={`${r.improved.label} loss`} value={`${num(r.improved.loss_pct)}%`} sub={`quality ${num(r.improved.final_quality)}`} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={chart} margin={{ left: 0, right: 8 }}>
                  <CartesianGrid stroke="#E2DFD8" vertical={false} /><XAxis dataKey="metric" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 10 }} />
                  <Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey={r.baseline.label} fill="#0A2624" isAnimationActive={false} /><Bar dataKey={r.improved.label} fill="#FF684A" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <table className="w-full text-xs">
              <thead><tr className="table-head"><th className="py-1 text-left">Metric</th><th className="text-right">{r.baseline.label}</th><th className="text-right">{r.improved.label}</th></tr></thead>
              <tbody className="table-body">
                {[["Final quality", "final_quality", num], ["Saleable kg", "final_saleable_kg", num], ["Lost kg", "lost_kg", num], ["Weight loss %", "weight_loss_pct", num], ["Energy kWh", "energy_kwh", num], ["Duration d", "duration_days", num]].map(([l, k, fmt]: any) => (
                  <tr key={k}><td className="py-1">{l}</td><td className="text-right font-mono">{fmt(r.baseline[k])}</td><td className="text-right font-mono">{fmt(r.improved[k])}</td></tr>
                ))}
                {[["Revenue", "revenue"], ["Storage cost", "storage_cost"], ["Transport cost", "transport_cost"], ["Energy cost", "energy_cost"], ["Net profit", "net_profit"]].map(([l, k]) => (
                  <tr key={k}><td className="py-1">{l}</td><td className="text-right font-mono">{inr(r.baseline.money[k])}</td><td className="text-right font-mono">{inr(r.improved.money[k])}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {Object.entries(r.context || {}).length > 0 && <div className="mt-3 text-[11px] text-ink-400">{Object.entries(r.context).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div>}
        </Panel>
      )}
    </div>
  );
}
