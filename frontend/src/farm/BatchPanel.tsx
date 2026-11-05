import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, BarChart3, CalendarClock, Snowflake, Thermometer, Truck } from "lucide-react";
import { api, post } from "../lib/api";
import { inr, qualityColor } from "../lib/format";
import { useT } from "../lib/i18n";
import { useUI } from "../stores/ui";
import { useSelection } from "../stores/live";
import { cn, Spinner } from "../components/ui";
import { actionTitle, BigButton, ThreeAnswers, useDaysText } from "./common";

const T_REF: Record<string, number> = { tomato: 12.5, mango: 13, banana: 14 };

function WhatIfButtons({ card }: { card: any }) {
  const { t, market } = useT();
  const daysText = useDaysText();
  const [which, setWhich] = useState<string | null>(null);
  const body = which === "cool" ? { temperature: T_REF[card.produce], humidity: 92 } : which === "blr" ? { destination_market: "m_bengaluru" } : null;
  const { data, isFetching } = useQuery({
    queryKey: ["whatif", card.id, which], enabled: !!body,
    queryFn: () => api("/simulations/recalculate", { method: "POST", json: { batch_id: card.id, ...body } }),
  });
  const at2 = card.future.find((f: any) => f.day >= 2) || card.future[card.future.length - 1];
  let rows: [string, string, string][] = [];
  if (which === "sell2") rows = [[t("qualityAt"), `${Math.round(card.quality)}%`, `${Math.round(at2.quality)}%`], [t("worthAt"), inr(card.value_now), inr(at2.value)]];
  if (which === "cool" && data) rows = [[t("daysLeft"), daysText(data.baseline.shelf_life_days, data.baseline.beyond_horizon), daysText(data.whatif.shelf_life_days, data.whatif.beyond_horizon)],
    [`${t("worthAt")} · ${t("dayN", { n: 3 })}`, inr(data.baseline.value_at), inr(data.whatif.value_at)]];
  if (which === "blr" && data) {
    const ship = (data.whatif_decision.alternatives || []).find((a: any) => a.market_id === "m_bengaluru");
    const rej = (data.whatif_decision.rejected || []).find((a: any) => a.key === "SHIP_m_bengaluru");
    rows = [[t("youGetShort"), inr(card.action.net), ship ? inr(ship.net) : rej ? "✕" : "—"], [t("qualityAt"), `${Math.round(card.action.quality_at_sale ?? card.quality)}%`, ship ? `${Math.round(ship.quality_at_sale)}%` : "—"]];
  }
  const opts = [
    { id: "cool", label: t("keepCool"), icon: <Snowflake className="h-4 w-4" /> },
    { id: "sell2", label: t("sell2"), icon: <CalendarClock className="h-4 w-4" /> },
    { id: "blr", label: t("sendBlr"), icon: <Truck className="h-4 w-4" />, hide: card.place === "truck" },
  ].filter((o) => !o.hide);
  return (
    <div>
      <div className="mb-2 text-sm font-bold text-forest">{t("whatIf")}</div>
      <div className="flex flex-wrap gap-2">
        {opts.map((o) => (
          <button key={o.id} onClick={() => setWhich(which === o.id ? null : o.id)}
            className={cn("flex items-center gap-1.5 rounded-full border-2 px-3.5 py-2 text-sm font-semibold transition-colors",
              which === o.id ? "border-forest bg-forest text-cream-50" : "border-forest/15 bg-white text-forest hover:border-forest/40")}>
            {o.icon}{o.label}
          </button>
        ))}
      </div>
      {which && (
        <div className="mt-3 overflow-hidden rounded-2xl border border-cream-200">
          {isFetching && !rows.length ? <div className="flex items-center gap-2 p-3 text-sm text-charcoal-400"><Spinner /> …</div> : (
            <table className="w-full text-sm">
              <thead className="bg-cream-100 text-[11px] uppercase tracking-wide text-charcoal-400"><tr><th className="px-3 py-1.5 text-left" /><th className="px-3 py-1.5 text-left">{t("now")}</th><th className="px-3 py-1.5 text-left text-forest">{t("ifYouDo")}</th></tr></thead>
              <tbody>{rows.map(([l, a, b]) => (
                <tr key={l} className="border-t border-cream-100"><td className="px-3 py-2 text-charcoal-500">{l}</td><td className="num px-3 py-2">{a}</td><td className="num px-3 py-2 font-bold text-forest">{b}</td></tr>
              ))}</tbody>
            </table>
          )}
          {which === "blr" && data && <div className="border-t border-cream-100 px-3 py-2 text-xs text-charcoal-400">{market("m_bengaluru", "Bengaluru APMC")}</div>}
        </div>
      )}
    </div>
  );
}

function ShedReading({ card }: { card: any }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [v, setV] = useState(27);
  const m = useMutation({ mutationFn: () => post(`/batches/${card.id}/readings`, { temperature: v, humidity: 70 }), onSuccess: () => qc.invalidateQueries({ queryKey: ["farm"] }) });
  return (
    <div className="rounded-2xl border border-amber/30 bg-amber-50 p-3 text-sm text-amber-600">
      <div className="flex gap-2"><Thermometer className="mt-0.5 h-4 w-4 shrink-0" />{t("weatherNote")}</div>
      <div className="mt-2 flex items-center gap-2">
        <input type="number" step={0.5} value={v} onChange={(e) => setV(Number(e.target.value))} className="num w-20 rounded-xl border border-amber/30 bg-white px-2 py-1.5 text-charcoal" />
        <span>°C</span>
        <button onClick={() => m.mutate()} disabled={m.isPending} className="rounded-xl bg-amber px-3 py-1.5 font-bold text-white">{m.isPending ? <Spinner className="h-3 w-3" /> : t("saveReading")}</button>
        {m.isSuccess && <span>✓</span>}
      </div>
    </div>
  );
}

function Detailed({ card }: { card: any }) {
  const { t } = useT();
  const nav = useNavigate();
  const { setBatch } = useSelection();
  const { data } = useQuery({ queryKey: ["twin", card.id, "panel"], queryFn: () => api(`/batches/${card.id}/twin?horizon_days=14`) });
  const pts = (data?.trajectory || []).map((p: any) => ({ day: p.day, q: p.quality, band: [p.quality_p10, p.quality_p90], v: p.value }));
  return (
    <div className="space-y-4 rounded-2xl border border-cream-200 bg-white p-3">
      <div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">{t("qualityCurve")}</div>
      <div className="h-32">
        <ResponsiveContainer>
          <ComposedChart data={pts} margin={{ top: 4, right: 4, left: -26, bottom: 0 }}>
            <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(d) => `${Math.round(d)}`} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v: any) => (Array.isArray(v) ? `${v[0].toFixed(0)}–${v[1].toFixed(0)}%` : `${Number(v).toFixed(1)}%`)} />
            <Area dataKey="band" fill="#1F4D3A" fillOpacity={0.15} stroke="none" isAnimationActive={false} />
            <Line dataKey="q" stroke="#1F4D3A" strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">{t("valueCurve")}</div>
      <div className="h-24">
        <ResponsiveContainer>
          <ComposedChart data={pts} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
            <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(d) => `${Math.round(d)}`} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => inr(v, { compact: true })} />
            <Tooltip formatter={(v: any) => inr(v)} />
            <Line dataKey="v" stroke="#D99A2B" strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="text-xs">
        <div className="font-bold uppercase tracking-wide text-charcoal-400">{t("whyConfidence")}</div>
        <div className="mt-1 text-charcoal-500">{t(card.confidence.category)} ({Math.round(card.confidence.score)}): {card.confidence.reasons.join("; ")}</div>
        <div className="mt-0.5 text-[10px] text-charcoal-300">{card.confidence.label}</div>
        {data && <div className="mt-1 text-[10px] text-charcoal-300">Model {data.model_version} · registry v{data.parameter_version} · {data.price?.label}</div>}
      </div>
      <button className="flex items-center gap-1 text-sm font-bold text-leaf-600 hover:underline" onClick={() => { setBatch(card.id); nav("/ops/twin"); }}>
        <BarChart3 className="h-4 w-4" />{t("fullAnalysis")}<ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function BatchPanel({ card, onChoices, children }: { card: any; onChoices: () => void; children?: React.ReactNode }) {
  const { t, market, produce } = useT();
  const detailed = useUI((s) => s.detailed);
  const futureIdx = useUI((s) => s.futureIdx);
  const setFuture = useUI((s) => s.setFuture);
  const f = card.future[Math.min(futureIdx, card.future.length - 1)];
  const inFuture = futureIdx > 0;
  const a = card.action;
  const reason = a.kind === "SELL" ? t("reason_SELL", { q: Math.round(a.quality_at_sale ?? card.quality) })
    : a.kind === "SHIP" ? t("reason_SHIP", { p: a.gain_pct ?? "", l: market(a.local_market_id, a.local_market_name), q: Math.round(a.quality_at_sale ?? 0) })
    : a.kind === "STORE" ? t("reason_STORE", { p: a.gain_pct ?? "" }) : a.explanation;
  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-3xl">
        <img src={`/produce/${card.produce}_${f.photo_stage}.jpg`} alt={produce(card.produce)} className="h-44 w-full object-cover transition-all duration-500"
          style={{ filter: `brightness(${0.75 + 0.25 * (f.quality / 100)}) saturate(${0.6 + 0.4 * (f.quality / 100)})` }} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
        <div className="absolute bottom-3 left-4 right-4 text-white">
          <div className="text-2xl font-extrabold drop-shadow">{produce(card.produce)} · {card.quantity_kg >= 1000 ? `${(card.quantity_kg / 1000).toFixed(1)} t` : `${card.quantity_kg} ${t("kg")}`}</div>
          <div className="text-xs opacity-80">{card.id} · {card.variety || ""} {inFuture && `· ${t("dayN", { n: Math.round(f.day) })}`}</div>
        </div>
        <div className="absolute right-3 top-3 rounded-full bg-black/40 px-2 py-0.5 text-[10px] text-white">{t("photoNote")}</div>
      </div>

      <ThreeAnswers quality={f.quality} category={card.future[0] && !inFuture ? card.category : f.quality >= 85 ? "Excellent" : f.quality >= 70 ? "Good" : f.quality >= 55 ? "Fair" : f.quality >= 40 ? "Poor" : "Unsellable"}
        days={inFuture ? f.days_left : card.days_left} p10={inFuture ? undefined : card.days_p10} p90={inFuture ? undefined : card.days_p90}
        beyond={card.beyond_horizon} value={inFuture ? f.value : card.value_now} valueLabel={inFuture ? t("worthAt") : t("worth")} />

      <div className="rounded-2xl bg-cream-100 p-3">
        <div className="flex items-center justify-between text-sm font-bold text-forest">
          <span>{t("future")}</span><span className="num" style={{ color: qualityColor(f.quality) }}>{inFuture ? t("dayN", { n: Math.round(f.day) }) : t("today")}</span>
        </div>
        <input type="range" min={0} max={card.future.length - 1} value={futureIdx} onChange={(e) => setFuture(Number(e.target.value))} className="mt-2 w-full" />
        <div className="flex justify-between text-[10px] text-charcoal-400"><span>{t("today")}</span><span>{t("dayN", { n: 7 })}</span><span>{t("dayN", { n: 14 })}</span></div>
        <div className="mt-1 text-[11px] text-charcoal-400">{t("futureHint")}</div>
      </div>

      {card.weather_based && card.place === "shed" && <ShedReading card={card} />}
      {card.place === "cold" && <div className="flex items-center gap-2 rounded-2xl bg-sky-50 px-3 py-2 text-sm text-sky-700"><Snowflake className="h-4 w-4" />{t("cold_hint")}</div>}

      {children}

      {card.place !== "truck" && (
        <div className="rounded-3xl border-2 border-forest/15 bg-white p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">{t("whatToDo")}</div>
          <div className="mt-1 text-xl font-extrabold leading-snug text-forest">{actionTitle(a, t, market)}</div>
          <div className="mt-1 text-sm text-charcoal-500">{reason}</div>
          {a.net !== null && a.net !== undefined && <div className="num mt-2 text-lg font-bold text-leaf-600">{t("youGet", { v: inr(a.net) })}</div>}
          {a.urgent && <div className="mt-2 inline-block rounded-full bg-rot px-2.5 py-0.5 text-xs font-bold text-white">{t("urgent")}</div>}
          <div className="mt-3"><BigButton onClick={onChoices} icon={<ArrowRight className="h-5 w-5" />}>{t("seeChoices")}</BigButton></div>
        </div>
      )}

      <WhatIfButtons card={card} />
      {detailed && <Detailed card={card} />}
    </div>
  );
}
