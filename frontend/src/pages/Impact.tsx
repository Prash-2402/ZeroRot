import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { animate } from "framer-motion";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../lib/api";
import { inr, num, PRODUCE_EMOJI, when } from "../lib/format";
import { useLive } from "../stores/live";
import { LiveMap } from "../components/LiveMap";
import { Badge, Card, Loading, Note, PageHeader, Segmented } from "../components/ui";

function Counter({ value, fmt }: { value: number; fmt: (n: number) => string }) {
  const [v, setV] = useState(0);
  useEffect(() => { const c = animate(0, value, { duration: 1.2, onUpdate: setV }); return () => c.stop(); }, [value]);
  return <>{fmt(v)}</>;
}

export default function Impact() {
  const version = useLive((s) => s.version);
  const [produce, setProduce] = useState("");
  const { data } = useQuery({ queryKey: ["impact", version], queryFn: () => api("/impact"), refetchInterval: 10000 });
  const { data: d } = useQuery({ queryKey: ["districts", produce, version], queryFn: () => api(`/impact/districts${produce ? `?produce=${produce}` : ""}`), refetchInterval: 15000 });
  if (!data) return <Loading />;
  const tiles = [
    ["Value protected", data.value_protected, (n: number) => inr(n)],
    ["Food protected", data.food_protected_kg, (n: number) => `${num(n, 0)} kg`],
    ["CO₂e avoided (est.)", data.co2_avoided_kg, (n: number) => `${num(n, 0)} kg`],
    ["Batches monitored", data.batches_monitored, (n: number) => num(n, 0)],
    ["Alerts raised", data.alerts_raised, (n: number) => num(n, 0)],
    ["Alerts handled", data.alerts_handled, (n: number) => num(n, 0)],
  ] as const;
  return (
    <div className="space-y-6">
      <PageHeader kicker="Prove" title="Impact" subtitle="Every number is computed from backend records: ghost comparisons, decisions and batch states. Nothing is typed in by hand."
        actions={data.simulated && <Badge tone="amber">SIMULATED records</Badge>} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map(([l, v, f]) => (
          <div key={l} className="card p-4"><div className="label">{l}</div><div className="num mt-1 text-2xl font-semibold text-forest"><Counter value={v} fmt={f} /></div></div>
        ))}
      </div>
      <Note>{data.co2_method} Value protected = net(approved reroute) − net(ghost: original plan) from the identical failure state; estimated counterfactual, not measured savings.</Note>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Loss exposure by produce" subtitle="Current value of batches in warning or critical state vs total value monitored">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={data.loss_exposure.map((x: any) => ({ ...x, name: `${PRODUCE_EMOJI[x.produce]} ${x.produce}` }))} margin={{ top: 5, right: 5, left: 10, bottom: 0 }}>
                <CartesianGrid stroke="#EEE7D4" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => inr(v, { compact: true })} />
                <Tooltip formatter={(v: any) => inr(v)} /><Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="value" name="Value monitored" fill="#A9BFA8" radius={[4, 4, 0, 0]} />
                <Bar dataKey="value_at_risk" name="Value at risk" fill="#D99A2B" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="District loss exposure" subtitle={d?.label} action={<Segmented value={produce} onChange={setProduce} options={[{ value: "", label: "All" }, ...["tomato", "mango", "banana"].map((p) => ({ value: p, label: PRODUCE_EMOJI[p] }))]} />}>
          <div className="overflow-hidden rounded-lg"><LiveMap trips={[]} districts={d?.districts || []} height={300} /></div>
          <div className="mt-2 flex gap-3 text-[11px] text-charcoal-400"><span>Circle size: value at risk</span><span className="text-leaf-600">● &lt;30% exposed</span><span className="text-amber-600">● 30–60%</span><span className="text-rot">● &gt;60%</span></div>
        </Card>
      </div>
      <Card title="Value protected events">
        {data.ghost_comparisons.length === 0 ? <div className="text-sm text-charcoal-400">No reroutes approved yet. Run Scenario 2 from the Control Room.</div> : (
          <table className="w-full text-sm"><thead><tr className="[&>th]:label [&>th]:py-1.5 [&>th]:text-left"><th>Trip</th><th>Batch</th><th>Ghost net</th><th>Reroute net</th><th>Value protected</th></tr></thead>
            <tbody>{data.ghost_comparisons.map((g: any, i: number) => (
              <tr key={i} className="border-t border-cream-100 [&>td]:py-1.5"><td className="font-mono text-xs">{g.trip_id}</td><td className="font-mono text-xs">{g.batch_id}</td><td className="num">{inr(g.ghost_net)}</td><td className="num">{inr(g.reroute_net)}</td><td className="num font-semibold text-leaf-600">{inr(g.value_protected)}</td></tr>
            ))}</tbody></table>
        )}
        {data.events.length > 0 && <div className="mt-2 text-xs text-charcoal-400">Last event {when(data.events[data.events.length - 1].ts)}</div>}
      </Card>
    </div>
  );
}
