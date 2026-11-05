import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Snowflake, Store, Truck, XCircle } from "lucide-react";
import { api, post } from "../lib/api";
import { days, inr, num, PRODUCE_EMOJI } from "../lib/format";
import { useLive, useSelection } from "../stores/live";
import { Badge, Card, cn, ConfidenceBadge, Empty, ErrorBox, Loading, Note, PageHeader, Segmented, Spinner } from "../components/ui";

const ICON: Record<string, any> = { SELL: Store, STORE: Snowflake, SHIP: Truck };

function Decision({ batchId }: { batchId: string }) {
  const version = useLive((s) => s.version);
  const { data, isLoading, error } = useQuery({ queryKey: ["decide", batchId, version], queryFn: () => api(`/decide/${batchId}`) });
  const [choice, setChoice] = useState<any>(null);
  const choose = useMutation({ mutationFn: (key: string) => post(`/decide/${batchId}/choice`, { kind: "decision", decision_id: data?.decision_id, chosen_key: key }), onSuccess: setChoice });
  if (isLoading) return <Loading label="Evaluating sell, store and ship options" />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  if (data.action === "INSUFFICIENT_DATA") {
    return <Card><div className="flex items-center gap-2 text-lg font-semibold text-rot"><AlertTriangle className="h-5 w-5" /> {data.message}</div><div className="mt-2 text-sm text-charcoal-500">Missing: {data.missing.join(", ")}</div></Card>;
  }
  if (data.action === "NO_FEASIBLE_OPTION") return <Card><div className="font-semibold text-rot">{data.message}</div></Card>;
  const Icon = ICON[data.action] || Store;
  const rec = data.recommended;
  const p = data.prediction;
  return (
    <div className="space-y-6">
      {p.conditions?.banner && <Note tone="amber">{p.conditions.banner}</Note>}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card overflow-hidden">
        <div className="grid gap-0 md:grid-cols-[1.3fr_1fr]">
          <div className="bg-forest p-6 text-cream-50">
            <div className="label text-sage-300">Recommended action · Rule-Based Decision Engine</div>
            <div className="mt-2 flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-cream-50/10"><Icon className="h-6 w-6" /></div>
              <div className="font-display text-4xl font-semibold tracking-tight">{data.action}{data.urgent && <span className="ml-3 rounded-md bg-rot px-2 py-0.5 align-middle text-xs font-bold">URGENT</span>}</div>
            </div>
            <p className="mt-4 text-lg leading-snug">{data.explanation}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              <ConfidenceBadge c={data.confidence} />
              <span className={cn("rounded-full px-2 py-0.5 font-semibold", data.depends_on_market ? "bg-amber text-white" : "bg-cream-50/15")}>{data.market_note}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 p-6">
            <div><div className="label">Expected net</div><div className="num mt-1 text-2xl font-semibold text-forest">{inr(rec.net)}</div><div className="text-xs text-charcoal-400">base price scenario</div></div>
            <div><div className="label">Quality at sale</div><div className="num mt-1 text-2xl font-semibold text-forest">{num(rec.quality_at_sale, 0)}%</div><div className="text-xs text-charcoal-400">{num(rec.saleable_kg, 0)} kg saleable</div></div>
            <div><div className="label">Low / high price</div><div className="num mt-1 text-sm font-semibold">{inr(rec.low?.net)} / {inr(rec.high?.net)}</div></div>
            <div><div className="label">Shelf life now</div><div className="num mt-1 text-sm font-semibold">{days(p.shelf_life.days, p.shelf_life.beyond_horizon)}</div><div className="text-xs text-charcoal-400">{num(p.shelf_life.p10_days, 1)}–{num(p.shelf_life.p90_days, 1)} d</div></div>
            <div className="col-span-2 text-[11px] text-charcoal-400">Scenario check — low: {data.scenario_check.low} · base: {data.scenario_check.base} · high: {data.scenario_check.high}. Observed price {inr(p.price?.observed?.price_per_kg)}/kg on {p.price?.observed?.date} ({p.price?.observed?.origin}).</div>
          </div>
        </div>
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card title="All feasible options" subtitle="Net = batch value at sale (already includes grade, weight loss and rejection) − transport − rent − handling − commission. Tap to choose; you can always override.">
          <div className="space-y-2">
            {data.alternatives.map((a: any) => {
              const I = ICON[a.kind] || Store;
              const isRec = a.key === rec.key;
              return (
                <button key={a.key} onClick={() => choose.mutate(a.key)}
                  className={cn("flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors", isRec ? "border-forest bg-forest-50" : "border-cream-200 hover:bg-cream-100", choice?.chosen === a.key && "ring-2 ring-leaf")}>
                  <I className="h-4 w-4 shrink-0 text-forest" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-forest">{a.label} {isRec && <Badge tone="forest" className="ml-1">Recommended</Badge>}</div>
                    <div className="text-xs text-charcoal-400">
                      Sell day {num(a.sale_day, 1)} · quality {num(a.quality_at_sale, 0)}% · {num(a.saleable_kg, 0)} kg · transport {inr(a.transport_cost)}{a.rent ? ` · rent ${inr(a.rent)}` : ""} · commission {inr(a.base?.commission)}
                      {a.meta?.auction_wait_h ? ` · waits ${a.meta.auction_wait_h} h for morning auction` : ""}
                    </div>
                  </div>
                  <div className="num text-right"><div className="font-semibold text-forest">{inr(a.net)}</div><div className="text-[10px] text-charcoal-400">{inr(a.low?.net, { compact: true })} – {inr(a.high?.net, { compact: true })}</div></div>
                </button>
              );
            })}
          </div>
          {choice && <div className={cn("mt-3 rounded-lg px-3 py-2 text-sm", choice.difference < 0 ? "bg-amber-50 text-amber-600" : "bg-leaf/10 text-leaf-600")}>{choice.message} Choice recorded.</div>}
        </Card>
        <Card title="Rejected options" subtitle="Infeasible options are removed before ranking, with the reason.">
          <div className="space-y-2">
            {data.rejected.length === 0 && <div className="text-sm text-charcoal-400">None.</div>}
            {data.rejected.map((r: any) => (
              <div key={r.key} className="flex gap-2 rounded-lg bg-cream-100 px-3 py-2 text-xs"><XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rot" /><div><div className="font-medium text-forest">{r.label}</div><div className="text-charcoal-500">{r.reason}</div></div></div>
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-cream-200 p-3 text-[11px] text-charcoal-500">
            <div className="label mb-1">Thresholds evaluated (demo defaults)</div>
            Store ≥ {data.thresholds.store_gain * 100}% above selling now · Ship ≥ {data.thresholds.ship_gain * 100}% above local · shelf life &gt; trip + {data.thresholds.buffer_hours} h ·
            urgent sell if value falls ≥ {data.thresholds.sell_urgent_drop_48h * 100}% in 48 h and shelf life ≤ {data.thresholds.sell_urgent_shelf_days} days.
          </div>
        </Card>
      </div>
    </div>
  );
}

const CONDS = [{ value: "normal", label: "Normal" }, { value: "price_crash", label: "Price crash" }, { value: "festival", label: "Festival demand" }, { value: "heavy_rain", label: "Heavy rain" }];

function MarketShift({ batchId }: { batchId: string }) {
  const { data: dash } = useQuery({ queryKey: ["dashboard"], queryFn: () => api("/dashboard") });
  const [cond, setCond] = useState<string | null>(null);
  useEffect(() => { if (cond === null && dash) setCond(dash.market_condition?.condition || "normal"); }, [dash, cond]);
  const { data, isLoading, error } = useQuery({ queryKey: ["shift", batchId, cond], queryFn: () => api(`/decide/${batchId}/market-shift?condition=${cond}`), enabled: !!cond });
  const [res, setRes] = useState<any>(null);
  useEffect(() => setRes(null), [cond, batchId]);
  const choose = useMutation({ mutationFn: (key: string) => post(`/decide/${batchId}/choice`, { kind: "market_shift", plan_id: data?.plan_id, chosen_key: key }), onSuccess: setRes });
  return (
    <Card title={<span className="flex items-center gap-2"><CalendarClock className="h-4 w-4" /> Market Shift Planner</span>}
      subtitle="When to sell: Today, Day 2, Day 4 or Day 7. Quality from the decay engine at this batch's actual storage; prices are labelled scenarios, never guarantees."
      action={<Segmented value={(cond || "normal") as any} onChange={(v) => setCond(v)} options={CONDS as any} />}>
      {isLoading || !data ? (error ? <ErrorBox error={error} /> : <Loading />) : (
        <>
          <div className={cn("mb-4 flex items-start gap-2 rounded-lg px-3 py-2 text-sm", data.shift_detected ? "bg-amber-50 text-amber-600" : "bg-cream-100 text-charcoal-500")}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><b>{data.condition_label}</b> at {data.market.name}: {data.banner}</div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.periods.map((p: any) => (
              <motion.button layout key={p.key} onClick={() => choose.mutate(p.key)}
                className={cn("relative rounded-xl border p-4 text-left transition-shadow hover:shadow-soft", p.recommended ? "border-forest bg-forest-50" : "border-cream-200 bg-white", res?.chosen === p.key && "ring-2 ring-leaf")}>
                {p.recommended && <span className="absolute -top-2.5 left-3 rounded-full bg-forest px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cream-50">Recommended</span>}
                <div className="font-display text-xl font-semibold text-forest">{p.label}</div>
                <div className="mt-3 space-y-1 text-xs text-charcoal-500">
                  <div className="flex justify-between"><span>Predicted price</span><b className="num text-charcoal">{inr(p.price_per_kg)}/kg</b></div>
                  <div className="flex justify-between"><span>Crop quality</span><b className="num text-charcoal">{num(p.quality, 0)}%</b></div>
                  <div className="flex justify-between"><span>Saleable</span><b className="num text-charcoal">{num(p.saleable_kg, 0)} kg</b></div>
                  <div className="flex justify-between"><span>Storage rent</span><b className="num text-charcoal">{inr(p.rent)}</b></div>
                </div>
                <div className="mt-3 border-t border-cream-200 pt-2">
                  <div className="label">Net earnings</div>
                  <div className="num text-xl font-semibold text-forest">{inr(p.net)}</div>
                  {!p.recommended && <div className="text-[11px] text-charcoal-400">{inr(p.diff_vs_recommended)} vs recommended</div>}
                </div>
              </motion.button>
            ))}
          </div>
          {res && <div className={cn("mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm", res.difference < 0 ? "bg-amber-50 text-amber-600" : "bg-leaf/10 text-leaf-600")}>
            <CheckCircle2 className="h-4 w-4" /> {res.message} Your choice is recorded.</div>}
          <div className="mt-3 text-[11px] text-charcoal-400">{data.storage.label}{data.storage.rent_per_kg_day ? ` · rent ${inr(data.storage.rent_per_kg_day)}/kg/day` : ""} · {data.price_method} · {data.labels.scenario}</div>
        </>
      )}
    </Card>
  );
}

export default function Decide() {
  const { batchId, setBatch } = useSelection();
  const [sp] = useSearchParams();
  useEffect(() => { const b = sp.get("batch"); if (b) setBatch(b); }, [sp, setBatch]);
  const { data: b } = useQuery({ queryKey: ["batch", batchId], queryFn: () => api(`/batches/${batchId}`), enabled: !!batchId });
  if (!batchId) return <Empty title="No batch selected">Choose a batch in the header.</Empty>;
  return (
    <div className="space-y-6">
      <PageHeader kicker="Decide" title="Sell, store or ship?" subtitle={b ? `${PRODUCE_EMOJI[b.produce]} ${b.id} · ${b.produce_name} · ${b.quantity_kg} kg · ${b.district_name}. The LLM never makes this decision.` : ""}
        actions={<a href="#planner" className="btn-secondary">Market Shift Planner <ArrowRight className="h-4 w-4" /></a>} />
      <Decision batchId={batchId} />
      <div id="planner"><MarketShift batchId={batchId} /></div>
    </div>
  );
}

export { Spinner };
