import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ExternalLink, Pause, Play, Thermometer } from "lucide-react";
import { api, post } from "../lib/api";
import { days, inr, kg, MATURITY, num, PRODUCE_EMOJI, qualityColor, RISK_STYLE, STORAGE, when } from "../lib/format";
import { useLive, useSelection } from "../stores/live";
import { ProduceVisual } from "../components/ProduceVisual";
import { Badge, Card, cn, ConfidenceBadge, Empty, ErrorBox, Gauge, Loading, Note, OriginTag, PageHeader, Spinner } from "../components/ui";
import { WhatIf } from "../features/WhatIf";

const CLASS_TONE: Record<string, string> = { experimental: "green", operating_range: "green", derived: "blue", calibrated: "amber", assumption: "amber", demo: "red" };

function ManualReading({ batchId }: { batchId: string }) {
  const qc = useQueryClient();
  const [t, setT] = useState(26.5);
  const [rh, setRh] = useState(70);
  const m = useMutation({ mutationFn: () => post(`/batches/${batchId}/readings`, { temperature: t, humidity: rh, origin: "manual" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["twin"] }) });
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <label className="text-xs">Measured °C<input className="input mt-0.5 w-24 py-1" type="number" step={0.1} value={t} onChange={(e) => setT(Number(e.target.value))} /></label>
      <label className="text-xs">RH %<input className="input mt-0.5 w-20 py-1" type="number" value={rh} onChange={(e) => setRh(Number(e.target.value))} /></label>
      <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending ? <Spinner className="h-3 w-3" /> : <Thermometer className="h-3.5 w-3.5" />} Add measured reading</button>
      {m.isSuccess && <span className="text-xs text-leaf-600">Recalculated with your reading.</span>}
      <ErrorBox error={m.error} />
    </div>
  );
}

function SyncChart({ data, dataKey, band, idx, color, unit, domain, label, fmt }: any) {
  return (
    <div>
      <div className="label mb-1">{label}</div>
      <div className="h-40">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 4, right: 8, left: -14, bottom: 0 }} syncId="twin">
            <CartesianGrid stroke="#EEE7D4" vertical={false} />
            <XAxis dataKey="day" type="number" domain={[0, "dataMax"]} tick={{ fontSize: 10 }} tickFormatter={(d) => `D${Math.round(d)}`} />
            <YAxis tick={{ fontSize: 10 }} domain={domain || ["auto", "auto"]} tickFormatter={fmt} width={56} />
            <Tooltip formatter={(v: any) => (Array.isArray(v) ? `${fmt ? fmt(v[0]) : num(v[0])} – ${fmt ? fmt(v[1]) : num(v[1])}` : `${fmt ? fmt(v) : num(v)}${unit || ""}`)}
              labelFormatter={(d) => `Day ${num(d as number, 2)}`} />
            {band && <Area dataKey={band} stroke="none" fill={color} fillOpacity={0.15} isAnimationActive={false} name="P10–P90" />}
            <Line dataKey={dataKey} stroke={color} strokeWidth={2.4} dot={false} isAnimationActive={false} name={label} />
            <ReferenceLine x={data[idx]?.day} stroke="#2B2B2B" strokeDasharray="3 3" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function Twin() {
  const { batchId } = useSelection();
  const version = useLive((s) => s.version);
  const simNow = useLive((s) => s.simNow);
  const { data, isLoading, error } = useQuery({
    queryKey: ["twin", batchId, version, simNow?.slice(0, 13)], queryFn: () => api(`/batches/${batchId}/twin?horizon_days=14`), enabled: !!batchId,
    placeholderData: (prev) => prev,
  });
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const traj = data?.trajectory || [];
  useEffect(() => { setIdx(0); setPlaying(false); }, [batchId]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setIdx((i) => { if (i >= traj.length - 1) { setPlaying(false); return i; } return i + 1; }), 220);
    return () => clearInterval(t);
  }, [playing, traj.length]);
  const chartData = useMemo(() => traj.map((p: any) => ({ ...p, qband: [p.quality_p10, p.quality_p90], vband: [p.value_low, p.value_high] })), [traj]);
  if (!batchId) return <Empty title="No batch selected">Choose a batch in the header or register one on the Batches page.</Empty>;
  if (isLoading && !data) return <Loading label="Running the decay engine" />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const b = data.batch;
  const pt = traj[Math.min(idx, traj.length - 1)] || traj[0];
  const sl = data.shelf_life;
  const insufficient = data.insufficient;
  return (
    <div className="space-y-6">
      <PageHeader kicker="Digital twin" title={<span>{PRODUCE_EMOJI[b.produce]} {b.id}</span>}
        subtitle={`${b.produce_name}${b.variety ? ` · ${b.variety}` : ""} · ${kg(b.quantity_kg)} · ${b.district_name} · ${b.status === "in_transit" ? `In transit (${b.storage_type === "reefer" ? "reefer" : "open truck"})` : b.status === "delivered" ? `Delivered${b.facility_name ? ` to ${b.facility_name}` : ""}` : `${STORAGE[b.storage_type]}${b.facility_name ? ` (${b.facility_name})` : ""}`} · harvested ${when(b.harvest_time)}`}
        actions={<>
          <OriginTag origin={b.origin} /><Badge tone={data.price?.observed?.origin === "simulated" ? "amber" : "blue"}>prices {data.price?.observed?.origin}</Badge>
          <span className={cn("chip", RISK_STYLE[sl.risk])}>{sl.risk}</span>
          <Link to="/decide" className="btn-primary">Decide: sell / store / ship</Link>
        </>} />

      {data.conditions.banner && (
        <div className="rounded-xl border border-amber/40 bg-amber-50 p-4">
          <div className="flex items-start gap-2 text-sm text-amber-600"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><b>Estimated conditions.</b> {data.conditions.banner}</div></div>
          <ManualReading batchId={b.id} />
        </div>
      )}
      {insufficient && <Note tone="red">Confidence is INSUFFICIENT ({data.confidence.text}). Numbers below are not reliable enough to act on; add batch details or readings.</Note>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <Card>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="flex flex-col items-center">
              <ProduceVisual produce={b.produce} quality={pt.quality} size={150} />
              <div className="mt-1 text-center text-xs text-charcoal-400">Colour and spotting follow predicted quality<br />Day {num(pt.day, 2)} · {when(pt.ts)}</div>
            </div>
            <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-1">
              <Gauge value={pt.quality} label="Quality" color={qualityColor(pt.quality)} display={insufficient ? "—" : `${num(pt.quality, 1)}%`} sub={`${pt.category} · P10–P90 ${num(pt.quality_p10, 0)}–${num(pt.quality_p90, 0)}`} />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Gauge value={Math.min(30, pt.shelf_life_days ?? 30)} max={Math.max(14, sl.p90_days || 14)} label="Shelf life left" color="#1F4D3A"
              display={insufficient ? "—" : idx === 0 ? days(sl.days, sl.beyond_horizon) : days(pt.shelf_life_days, sl.beyond_horizon)}
              sub={idx === 0 && !sl.beyond_horizon ? `${num(sl.p10_days, 1)}–${num(sl.p90_days, 1)} days (P10–P90)` : sl.beyond_horizon ? "beyond 30-day horizon" : "central estimate"} />
            <Gauge value={pt.value || 0} max={Math.max(1, traj[0]?.value_high || 1)} label="Batch value" color="#3E8E5A" display={insufficient ? "—" : inr(pt.value, { compact: true })}
              sub={`${inr(pt.price_per_kg)}/kg · ${num(pt.saleable_kg, 0)} kg saleable`} />
          </div>
          <div className="mt-5 space-y-2 rounded-lg bg-cream-100 p-3 text-xs">
            <div className="flex items-center justify-between"><span className="label">Confidence</span><ConfidenceBadge c={data.confidence} /></div>
            <div className="text-charcoal-500">{data.confidence.reasons?.join("; ") || "All factors strong."}</div>
            <div className="text-[10px] text-charcoal-300">{data.confidence.label}. {data.confidence.n_readings} valid readings{data.confidence.excluded_readings ? `, ${data.confidence.excluded_readings} excluded` : ""}.</div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            {(["24h", "48h", "72h"] as const).map((k) => (
              <div key={k} className="rounded-lg border border-cream-200 p-2">
                <div className="label">{k}</div>
                <div className="num font-semibold text-forest">{num(data.future[k].quality, 1)}%</div>
                <div className="text-charcoal-400">{inr(data.future[k].value, { compact: true })}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Quality, shelf life and value over time" subtitle={`Sale market: ${data.sale_market.name}. Price: ${data.price?.label || ""}`}>
          <div className="mb-4 flex items-center gap-3">
            <button className="btn-secondary px-2.5 py-1.5" onClick={() => { if (idx >= traj.length - 1) setIdx(0); setPlaying(!playing); }} aria-label="Play">
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <input type="range" min={0} max={traj.length - 1} value={idx} onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} className="flex-1" />
            <div className="num w-24 text-right text-sm font-semibold text-forest">Day {num(pt.day, 2)}</div>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div className="rounded-lg bg-cream-100 p-2"><div className="label">Conditions</div><div className="num font-semibold">{pt.temp_c} °C · {pt.rh}%</div></div>
            <div className="rounded-lg bg-cream-100 p-2"><div className="label">Weight loss</div><div className="num font-semibold">{num(pt.weight_loss_pct, 2)}%</div></div>
            <div className="rounded-lg bg-cream-100 p-2"><div className="label">Rejected</div><div className="num font-semibold">{num(pt.rejected_pct, 2)}%</div></div>
            <div className="rounded-lg bg-cream-100 p-2"><div className="label">Status</div><div className="font-semibold">{pt.category}</div></div>
          </div>
          <div className="space-y-3">
            <SyncChart data={chartData} dataKey="quality" band="qband" idx={idx} color="#1F4D3A" unit="%" domain={[0, 100]} label="Quality (with P10–P90 band)" />
            <SyncChart data={chartData} dataKey="shelf_life_days" idx={idx} color="#3E8E5A" unit=" d" label="Shelf life remaining (days)" />
            <SyncChart data={chartData} dataKey="value" band="vband" idx={idx} color="#D99A2B" label="Batch value (₹, low–high price scenarios)" fmt={(v: number) => inr(v, { compact: true })} />
          </div>
          {pt.breakdown && idx > 0 && (
            <div className="mt-4 rounded-lg border border-cream-200 p-3 text-xs">
              <div className="label mb-1.5">Value change since now, by cause (sums exactly; nothing counted twice)</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                <div>Quality grade <b className="num block text-forest">{inr(pt.breakdown.quality_grade)}</b></div>
                <div>Weight loss <b className="num block text-forest">{inr(pt.breakdown.weight_loss)}</b></div>
                <div>Rejected units <b className="num block text-forest">{inr(pt.breakdown.rejected_units)}</b></div>
                <div>Market price <b className="num block text-forest">{inr(pt.breakdown.market_price)}</b></div>
              </div>
              <div className="mt-1.5 text-charcoal-400">Total loss {inr(pt.breakdown.total_loss)} = {inr(pt.breakdown.start_value)} − {inr(pt.breakdown.end_value)}</div>
            </div>
          )}
        </Card>
      </div>

      <WhatIf key={b.id} batch={b} />

      <Card title="Parameters used" subtitle={`Model ${data.model_version} · parameter registry v${data.parameter_version}. k_ref is calibrated to hit the minimum sellable score at the published storage life; this does not validate the curve shape.`}>
        <div className="grid gap-2 md:grid-cols-2">
          {data.parameters_used.map((p: any) => (
            <div key={p.id} className="flex items-start justify-between gap-3 rounded-lg border border-cream-200 px-3 py-2 text-xs">
              <div className="min-w-0">
                <div className="font-medium text-forest">{p.name}</div>
                {p.derivation && <div className="mt-0.5 truncate font-mono text-[10px] text-charcoal-400" title={p.derivation}>{p.derivation}</div>}
                {p.source?.url ? <a className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-leaf-600 hover:underline" href={p.source.url} target="_blank" rel="noreferrer">{p.source.publisher.split(";")[0]} <ExternalLink className="h-2.5 w-2.5" /></a>
                  : <div className="text-[10px] text-charcoal-300">No published source</div>}
              </div>
              <div className="shrink-0 text-right">
                <div className="num font-semibold">{p.value} <span className="font-normal text-charcoal-400">{p.unit}</span></div>
                <Badge tone={CLASS_TONE[p.classification]}>{p.classification_label}</Badge>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 text-xs text-charcoal-400">Maturity: {b.maturity ? MATURITY[b.maturity] : "unknown (mature-green rate used; confidence reduced)"} · Data origins: {data.data_origins.join(", ")}</div>
      </Card>
    </div>
  );
}
