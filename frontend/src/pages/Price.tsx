import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RefreshCw } from "lucide-react";
import { api, post } from "../lib/api";
import { inr, kg, num } from "../lib/format";
import { Empty, ErrorBox, Field, Metric, Note, Origin, PageHead, Panel, Spinner, cn } from "../components/ui";
import { BatchSelect, ExplainButton, useCommodities } from "../components/shared";

function Profit({ markets }: { markets: string[] }) {
  const [f, setF] = useState({ batch: "" as number | "", market: "", price: "", storage: "cold", temp: "", cost: "", transport: 0, commission: 6, other: 0, max_days: 14 });
  const m = useMutation({
    mutationFn: () => post("/profit/evaluate", {
      batch_id: f.batch, market_name: f.market || null, price_per_kg: f.price ? Number(f.price) : null, storage: f.storage,
      storage_temp_c: f.temp !== "" ? Number(f.temp) : null, storage_cost_per_kg_day: f.cost !== "" ? Number(f.cost) : null,
      transport_cost: Number(f.transport), commission_pct: Number(f.commission), other_costs: Number(f.other), max_days: Number(f.max_days),
    }),
  });
  const r = m.data;
  return (
    <Panel title="Sell now or store and sell later?" sub="Deterioration model × price × storage, transport and commission costs. Waiting is only recommended when it beats selling today within the pessimistic (P10) shelf life.">
      <form className="grid gap-3 md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <div className="md:col-span-2"><Field label="Batch"><BatchSelect value={f.batch} onChange={(v) => setF({ ...f, batch: v })} filter={(b) => b.commodity_id !== "onion"} /></Field></div>
        <Field label="Market (verified price)"><select className="input" value={f.market} onChange={(e) => setF({ ...f, market: e.target.value })}><option value="">— enter price manually —</option>{markets.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Manual price ₹/kg" hint={f.market ? "Used only if the market has no stored price" : "Labelled MANUAL"}><input className="input" type="number" step="0.5" min={0} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        <Field label="Storage"><select className="input" value={f.storage} onChange={(e) => setF({ ...f, storage: e.target.value })}><option value="cold">Cold storage</option><option value="traditional">Traditional</option></select></Field>
        <Field label="Storage temp °C" hint={f.storage === "cold" ? "Blank = recommended" : "Required"}><input className="input" type="number" step="0.5" value={f.temp} onChange={(e) => setF({ ...f, temp: e.target.value })} /></Field>
        <Field label="Storage ₹/kg/day"><input className="input" type="number" step="0.05" min={0} value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></Field>
        <Field label="Transport ₹"><input className="input" type="number" min={0} value={f.transport} onChange={(e) => setF({ ...f, transport: e.target.value as any })} /></Field>
        <Field label="Commission %"><input className="input" type="number" min={0} max={30} step="0.5" value={f.commission} onChange={(e) => setF({ ...f, commission: e.target.value as any })} /></Field>
        <Field label="Other costs ₹"><input className="input" type="number" min={0} value={f.other} onChange={(e) => setF({ ...f, other: e.target.value as any })} /></Field>
        <Field label="Horizon (days)"><input className="input" type="number" min={1} max={30} value={f.max_days} onChange={(e) => setF({ ...f, max_days: e.target.value as any })} /></Field>
        <div className="flex items-end"><button className="btn-gold w-full" disabled={!f.batch || (!f.market && !f.price) || m.isPending}>{m.isPending ? <Spinner /> : "Evaluate"}</button></div>
      </form>
      <ErrorBox error={m.error} />
      {r && (
        <div className="mt-4 space-y-3">
          <div className={cn("flex flex-wrap items-center justify-between gap-3 p-4", r.recommendation === "sell_now" ? "bg-ink text-paper" : "bg-gold text-ink")}>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.15em] opacity-70">Recommendation</div>
              <div className="font-display text-2xl font-bold">{r.recommendation === "sell_now" ? "Sell now" : `Store and sell on day ${r.best_day}`}</div>
            </div>
            <div className="text-right"><div className="text-xs opacity-70">{r.recommendation === "sell_now" ? "Net profit today" : "Extra profit vs today"}</div><div className="num text-2xl font-bold">{inr(r.recommendation === "sell_now" ? r.sell_now.net_profit : r.gain_vs_now)}</div></div>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Metric label="Sell today" value={inr(r.sell_now.net_profit)} sub={`${kg(r.sell_now.saleable_kg)} × ${inr(r.sell_now.price_per_kg)}/kg`} />
            <Metric label="Best option" value={inr(r.best.net_profit)} sub={`day ${r.best.day} · quality ${r.best.quality}`} />
            <Metric label="Shelf life" value={r.shelf_life_days != null ? `${num(r.shelf_life_days)} d` : `> ${f.max_days} d`} sub={`pessimistic P10 ${num(r.shelf_life_p10_days)} d`} />
            <Metric label="Spoilage at best day" value={kg(r.best.spoilage_loss_kg)} />
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <ComposedChart data={r.rows} margin={{ left: 10, right: 10 }}>
                <CartesianGrid stroke="#E2DFD8" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} unit="d" />
                <YAxis yAxisId="m" tick={{ fontSize: 10 }} tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} />
                <YAxis yAxisId="q" orientation="right" tick={{ fontSize: 10 }} domain={[0, 100]} />
                <Tooltip formatter={(v: any, n: any) => (n === "Quality" ? num(v) : inr(v))} labelFormatter={(l) => `Day ${l}`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area yAxisId="m" dataKey="net_profit" name="Net profit" fill="#FFC90055" stroke="#08090B" isAnimationActive={false} />
                <Line yAxisId="m" dataKey="revenue" name="Revenue" stroke="#5FB37C" dot={false} isAnimationActive={false} />
                <Line yAxisId="q" dataKey="quality" name="Quality" stroke="#EB4D3D" dot={false} strokeDasharray="4 3" isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <details className="text-xs"><summary className="cursor-pointer font-semibold">Day-by-day table and assumptions</summary>
            <div className="mt-2 overflow-x-auto"><table className="w-full"><thead><tr className="table-head"><th className="text-left">Day</th><th>Quality</th><th>Saleable</th><th>Price</th><th>Revenue</th><th>Storage</th><th>Commission</th><th>Net</th><th className="text-left">Price basis</th></tr></thead>
              <tbody className="table-body">{r.rows.map((x: any) => <tr key={x.day} className={x.within_shelf_life_p10 ? "" : "text-ink-300"}><td>{x.day}</td><td className="text-right">{x.quality}</td><td className="text-right">{kg(x.saleable_kg)}</td><td className="text-right">{inr(x.price_per_kg)}</td><td className="text-right">{inr(x.revenue)}</td><td className="text-right">{inr(x.storage_cost)}</td><td className="text-right">{inr(x.commission)}</td><td className="text-right font-semibold">{inr(x.net_profit)}</td><td className="pl-2">{x.price_basis}</td></tr>)}</tbody></table></div>
            <ul className="mt-2 list-disc pl-5">{r.assumptions.map((a: string, i: number) => <li key={i}>{a}</li>)}</ul>
          </details>
          <ExplainButton body={{ task: "profit", profit_scenario_id: r.scenario_id }} />
        </div>
      )}
    </Panel>
  );
}

export default function Price() {
  const qc = useQueryClient();
  const comms = useCommodities();
  const [c, setC] = useState("tomato");
  const [market, setMarket] = useState("");
  const status = useQuery({ queryKey: ["market-status"], queryFn: () => api("/market/status") });
  const prices = useQuery({ queryKey: ["prices", c], queryFn: () => api(`/market/prices?commodity=${c}`) });
  const refresh = useMutation({ mutationFn: () => post(`/market/refresh?commodity=${c}&state=Karnataka`), onSuccess: () => qc.invalidateQueries({ queryKey: ["prices", c] }) });
  const fc = useMutation({ mutationFn: () => post(`/market/forecast?commodity=${c}&market_name=${encodeURIComponent(market)}&horizon=14`) });
  const events = useMutation({ mutationFn: () => api(`/market/events?commodity=${c}`, { timeoutMs: 45000 }) });
  const p = prices.data;
  const hist = (p?.history || []).filter((h: any) => !market || h.market === market);
  const fcRows = fc.data?.status === "ok" ? [...hist.slice(-60).map((h: any) => ({ date: h.date, actual: h.modal_per_kg })), ...fc.data.points.map((x: any) => ({ date: x.date, forecast: x.price, band: [x.low, x.high] }))] : [];
  return (
    <div className="space-y-4">
      <PageHead kicker="Module 5" title="Price Intelligence" sub="Verified mandi prices (Agmarknet via data.gov.in), a statistical forecast that is backtested against a naive baseline, and a profit engine. AI only explains."
        actions={<div className="flex gap-2">{(comms.data?.commodities || []).map((x: any) => <button key={x.id} onClick={() => { setC(x.id); setMarket(""); fc.reset(); events.reset(); }} className={cn("border px-3 py-1.5 text-xs font-semibold", c === x.id ? "border-ink bg-ink text-gold" : "border-paper-300 bg-white")}>{x.name}</button>)}</div>} />
      <div className="flex flex-wrap gap-2">
        {(status.data?.sources || []).map((s: any) => <span key={s.name} className={cn("chip", s.status === "configured" ? "bg-ok text-white" : "bg-critical text-white")} title={s.detail}>{s.name}: {s.status}</span>)}
        <span className={cn("chip", status.data?.groq ? "bg-ink text-gold" : "bg-paper-300")}>Groq AI: {status.data?.groq ? "configured" : "not configured"}</span>
      </div>
      <Panel title="Mandi prices" sub="Rs/kg converted from Rs/quintal" action={<button className="btn-ink" onClick={() => refresh.mutate()} disabled={refresh.isPending}>{refresh.isPending ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Fetch latest</button>}>
        <ErrorBox error={refresh.error} />
        {refresh.data && <Note>{refresh.data.added} new records stored.{refresh.data.errors?.length ? ` Errors: ${refresh.data.errors.join("; ")}` : ""}</Note>}
        {p?.status === "data_unavailable" ? (
          <div className="flex items-center gap-3 border border-dashed border-paper-400 p-6"><Origin kind="unavailable" /><span className="text-sm">{p.message}</span></div>
        ) : p && (
          <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-xs">
                <thead><tr className="table-head"><th className="py-1 text-left">Market</th><th className="text-right">Modal</th><th className="text-right">Range</th><th className="text-left pl-2">Date</th></tr></thead>
                <tbody className="table-body">{p.latest.map((x: any) => (
                  <tr key={x.market} onClick={() => setMarket(x.market)} className={cn("cursor-pointer hover:bg-gold-50", market === x.market && "bg-gold-50")}>
                    <td className="py-1"><b>{x.market}</b><div className="text-ink-400">{x.district} · {x.variety}</div></td>
                    <td className="text-right font-mono font-semibold">{inr(x.modal_per_kg)}</td>
                    <td className="text-right font-mono">{x.min_per_kg}–{x.max_per_kg}</td>
                    <td className="pl-2">{x.observation_date}<div className={x.freshness_days > 7 ? "text-critical" : "text-ink-400"}>{x.freshness_days} d old · {x.source}</div></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="h-72">
              <ResponsiveContainer>
                <LineChart data={hist} margin={{ left: -10, right: 8 }}>
                  <CartesianGrid stroke="#E2DFD8" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={30} /><YAxis tick={{ fontSize: 10 }} unit="₹" />
                  <Tooltip /><Line dataKey="modal_per_kg" name={market || "All markets"} stroke="#08090B" dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Price forecast" sub={`Gradient-boosted model on lagged prices; needs ≥ ${status.data?.forecast_min_points ?? 60} daily points.`}
          action={<button className="btn-ink" disabled={!market || fc.isPending} onClick={() => fc.mutate()}>{fc.isPending ? <Spinner /> : "Train & forecast"}</button>}>
          {!market && <div className="text-sm text-ink-400">Select a market in the table above.</div>}
          <ErrorBox error={fc.error} />
          {fc.data?.status === "insufficient_data" && <div className="flex items-center gap-2 text-sm"><Origin kind="unavailable" />{fc.data.message}</div>}
          {fc.data?.status === "ok" && (
            <div className="space-y-2">
              <div className="h-64">
                <ResponsiveContainer>
                  <ComposedChart data={fcRows} margin={{ left: -10, right: 8 }}>
                    <CartesianGrid stroke="#E2DFD8" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={30} /><YAxis tick={{ fontSize: 10 }} unit="₹" />
                    <Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area dataKey="band" name="P10–P90 band" fill="#FFC90055" stroke="none" isAnimationActive={false} />
                    <Line dataKey="actual" name="Observed" stroke="#08090B" dot={false} isAnimationActive={false} />
                    <Line dataKey="forecast" name="Forecast" stroke="#B88A00" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="text-xs">
                Backtest MAPE (7-day): model {fc.data.metrics.h7?.model_mape_pct ?? "—"}% vs naive {fc.data.metrics.h7?.naive_mape_pct ?? "—"}% ·{" "}
                <b className={fc.data.beats_naive_baseline_7d ? "text-ok" : "text-critical"}>{fc.data.beats_naive_baseline_7d ? "beats naive baseline" : "does NOT beat naive baseline — treat with caution"}</b>
                <div className="text-ink-400">{fc.data.trained_points} points · {fc.data.label}</div>
              </div>
              <ExplainButton body={{ task: "price_forecast", commodity: c, market_name: market }} />
            </div>
          )}
        </Panel>
        <Panel title="Market events" sub="Recent news (GDELT) for context; AI tags possible supply/demand events. News is not evidence of price movement."
          action={<button className="btn-ink" disabled={events.isPending} onClick={() => events.mutate()}>{events.isPending ? <Spinner /> : "Scan news"}</button>}>
          <ErrorBox error={events.error} />
          {events.data?.status === "unavailable" && <div className="flex items-center gap-2 text-sm"><Origin kind="unavailable" />{events.data.message}</div>}
          {events.data?.ai && <div className="mb-2 border-l-4 border-gold bg-white p-2 text-xs"><span className="chip bg-ink text-gold">AI</span> {events.data.ai.summary}</div>}
          {events.data?.ai_error && <ErrorBox error={{ message: events.data.ai_error }} />}
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {(events.data?.articles || []).map((a: any, i: number) => <a key={i} href={a.url} target="_blank" rel="noreferrer noopener" className="block border-b border-paper-300 py-1 text-xs hover:text-gold-700"><b>{a.title}</b><div className="text-ink-400">{a.domain} · {a.seen}</div></a>)}
            {events.data && !events.data.articles?.length && events.data.status === "ok" && <div className="text-sm text-ink-400">No recent articles found.</div>}
          </div>
          {!events.data && !events.isPending && <Empty title="Not scanned">Scanning fetches live news for this commodity.</Empty>}
        </Panel>
      </div>
      <Profit markets={p?.markets || []} />
    </div>
  );
}
