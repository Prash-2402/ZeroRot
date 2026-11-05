import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TrendingDown } from "lucide-react";
import { api, post } from "../lib/api";
import { inr, num, PRODUCE_EMOJI } from "../lib/format";
import { Badge, Card, cn, Loading, Note, OriginTag, PageHeader, Segmented } from "../components/ui";

export default function Markets() {
  const qc = useQueryClient();
  const [commodity, setCommodity] = useState("tomato");
  const [mandi, setMandi] = useState("m_kolar");
  const { data } = useQuery({ queryKey: ["markets"], queryFn: () => api("/markets") });
  const { data: series } = useQuery({ queryKey: ["prices", commodity, mandi], queryFn: () => api(`/market-prices?commodity=${commodity}&mandi=${mandi}`) });
  const setCond = useMutation({ mutationFn: (b: any) => post("/markets/condition", b), onSuccess: () => qc.invalidateQueries() });
  const chart = useMemo(() => {
    if (!series) return [];
    const hist = series.history.map((h: any) => ({ date: h.date.slice(5), observed: h.price_per_kg }));
    const sc = series.scenarios;
    if (!sc) return hist;
    const last = series.history[series.history.length - 1];
    const base = new Date(last.date);
    const fut = sc.days.slice(1).map((d: number, i: number) => {
      const dt = new Date(base.getTime() + d * 86400e3);
      return { date: `${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`, base: sc.base[i + 1], band: [sc.low[i + 1], sc.high[i + 1]] };
    });
    return [...hist.slice(0, -1), { ...hist[hist.length - 1], base: last.price_per_kg, band: [last.price_per_kg, last.price_per_kg] }, ...fut];
  }, [series]);
  const rows = (data?.latest || []).filter((r: any) => r.commodity === commodity);
  const mc = data?.market_condition;
  return (
    <div className="space-y-6">
      <PageHeader kicker="Decide" title="Markets" subtitle="Observed mandi prices are always shown separately from future price scenarios. Future prices are scenarios, never guarantees."
        actions={<Segmented value={commodity} onChange={setCommodity} options={["tomato", "mango", "banana"].map((c) => ({ value: c, label: `${PRODUCE_EMOJI[c]} ${c}` }))} />} />
      <Note tone="amber">{data?.label}</Note>
      <div className="grid gap-6 xl:grid-cols-[1fr_1.4fr]">
        <Card title="Latest modal prices" subtitle="₹/kg, normalised from ₹/quintal">
          {!data ? <Loading /> : (
            <table className="w-full text-sm">
              <thead><tr className="[&>th]:label [&>th]:py-2 [&>th]:text-left"><th>Mandi</th><th>Price</th><th>Change</th><th>Date</th><th>Origin</th></tr></thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.mandi_id} onClick={() => setMandi(r.mandi_id)} className={cn("cursor-pointer border-t border-cream-100 hover:bg-cream-100 [&>td]:py-2", mandi === r.mandi_id && "bg-forest-50")}>
                    <td className="font-medium text-forest">{r.mandi}</td><td className="num">{inr(r.modal_per_kg)}</td>
                    <td className={cn("num", r.change_pct >= 0 ? "text-leaf-600" : "text-rot")}>{r.change_pct === null ? "—" : `${r.change_pct > 0 ? "+" : ""}${r.change_pct}%`}</td>
                    <td className="text-xs text-charcoal-400">{r.date}</td><td><OriginTag origin={r.origin} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title={`${series?.mandi_name || ""} · price history and scenarios`} subtitle={series?.scenarios?.label}>
          <div className="h-72">
            <ResponsiveContainer>
              <ComposedChart data={chart} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#EEE7D4" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={6} />
                <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} tickFormatter={(v) => `₹${v}`} />
                <Tooltip formatter={(v: any) => (Array.isArray(v) ? `₹${num(v[0], 1)} – ₹${num(v[1], 1)}` : `₹${num(v, 2)}`)} />
                <Area dataKey="band" fill="#D99A2B" fillOpacity={0.18} stroke="none" name="Low–high scenario" isAnimationActive={false} />
                <Line dataKey="observed" stroke="#1F4D3A" strokeWidth={2} dot={false} name="Observed (SIMULATED seed)" isAnimationActive={false} />
                <Line dataKey="base" stroke="#D99A2B" strokeWidth={2} strokeDasharray="5 4" dot={false} name="Base scenario" isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {series?.scenarios && <div className="mt-2 text-xs text-charcoal-400">Method: {series.scenarios.method} · {series.scenarios.n_points} comparable day-over-day changes · {series.scenarios.outliers_dropped} outliers dropped · condition: {series.scenarios.condition}</div>}
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Price-crash warnings" subtitle="Observed decline, forecast decline or potential risk. A forecast is never called a confirmed crash.">
          <div className="space-y-2">
            {(data?.warnings || []).filter((w: any) => w.commodity === commodity).map((w: any, i: number) => (
              <div key={i} className="flex items-start gap-2 rounded-lg bg-cream-100 px-3 py-2 text-sm">
                <TrendingDown className={cn("mt-0.5 h-4 w-4", w.kind === "Observed decline" ? "text-rot" : "text-amber")} />
                <div><div className="font-medium text-forest">{w.mandi} <Badge tone={w.kind === "Observed decline" ? "red" : "amber"}>{w.kind}</Badge> <OriginTag origin={w.origin} /></div><div className="text-xs text-charcoal-500">{w.detail}</div></div>
              </div>
            ))}
            {(data?.warnings || []).filter((w: any) => w.commodity === commodity).length === 0 && <div className="text-sm text-charcoal-400">No significant declines detected.</div>}
          </div>
        </Card>
        <Card title="Market condition (demo scenarios)" subtitle="Explicit, labelled shifts of the base price path at Kolar APMC. Used by the Market Shift Planner and decisions.">
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(data?.conditions || {}).map(([k, v]: any) => (
              <button key={k} onClick={() => setCond.mutate({ condition: k, mandi_id: "m_kolar" })}
                className={cn("rounded-lg border px-3 py-3 text-left text-sm", mc?.condition === k ? "border-forest bg-forest-50 font-semibold text-forest" : "border-cream-200 hover:bg-cream-100")}>{v}</button>
            ))}
          </div>
          <div className="mt-3 text-xs text-charcoal-400">Current: <b>{data?.conditions?.[mc?.condition]}</b>{mc?.mandi_id ? ` at ${mc.mandi_id.replace("m_", "")}` : ""}</div>
        </Card>
      </div>
    </div>
  );
}
