import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ShieldAlert } from "lucide-react";
import { api } from "../lib/api";
import { kg, MATURITY, num, PRODUCE_EMOJI, when } from "../lib/format";
import { useSelection } from "../stores/live";
import { Badge, Card, Empty, Loading, OriginTag, PageHeader } from "../components/ui";
import { Logo } from "../components/Layout";

export function PassportView({ token, embedded }: { token: string; embedded?: boolean }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["passport", token], queryFn: () => api(`/passport/${token}`) });
  if (isLoading) return <Loading />;
  if (error || !data) return <Empty title="Passport not found" />;
  const pts = data.readings.map((r: any) => ({ t: when(r.ts), temp: r.temp_c, rh: r.rh }));
  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="bg-forest p-5 text-cream-50">
          <div className="label text-sage-300">Harvest passport</div>
          <div className="mt-1 font-display text-3xl">{PRODUCE_EMOJI[data.produce.toLowerCase()]} {data.produce} <span className="kn text-xl opacity-80">{data.produce_kn}</span></div>
          <div className="mt-1 text-sm opacity-80">{data.batch_id} · {data.variety || "variety not recorded"} · {kg(data.quantity_kg)}</div>
        </div>
        <div className="grid grid-cols-2 gap-4 p-5 text-sm sm:grid-cols-4">
          <div><div className="label">Harvested</div><div className="font-semibold">{data.harvest_date}</div></div>
          <div><div className="label">District</div><div className="font-semibold">{data.district}</div></div>
          <div><div className="label">Maturity</div><div className="font-semibold">{data.maturity ? MATURITY[data.maturity] : "not recorded"}</div></div>
          <div><div className="label">Current quality</div><div className="num font-semibold">{data.current_quality}%</div></div>
        </div>
      </div>
      <Card title="Storage and transport history">
        <ol className="space-y-2 border-l-2 border-sage-300 pl-4">
          {data.storage_history.map((s: any, i: number) => (
            <li key={i} className="text-sm"><div className="font-medium text-forest">{s.label}</div><div className="text-xs text-charcoal-400">{when(s.start)}{s.end ? ` → ${when(s.end)}` : " → now"}</div></li>
          ))}
        </ol>
      </Card>
      {pts.length > 0 && (
        <Card title="Temperature and humidity record" action={<OriginTag origin={data.readings[0]?.origin} />}>
          <div className="h-48">
            <ResponsiveContainer>
              <LineChart data={pts} margin={{ top: 4, right: 6, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#EEE7D4" vertical={false} /><XAxis dataKey="t" tick={{ fontSize: 9 }} interval={Math.ceil(pts.length / 6)} />
                <YAxis yAxisId="t" tick={{ fontSize: 10 }} /><YAxis yAxisId="h" orientation="right" tick={{ fontSize: 10 }} domain={[0, 100]} />
                <Tooltip /><Line yAxisId="t" dataKey="temp" name="°C" stroke="#C2463B" dot={false} strokeWidth={2} /><Line yAxisId="h" dataKey="rh" name="RH %" stroke="#3898D6" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
      <Card title="Predictions on record">
        {data.predictions.length === 0 ? <div className="text-sm text-charcoal-400">No predictions stored yet.</div> : (
          <table className="w-full text-sm"><thead><tr className="[&>th]:label [&>th]:py-1 [&>th]:text-left"><th>Time</th><th>Quality</th><th>Shelf life</th><th>Confidence</th><th>Model</th></tr></thead>
            <tbody>{data.predictions.slice(-12).map((p: any, i: number) => (
              <tr key={i} className="border-t border-cream-100 [&>td]:py-1.5"><td className="text-xs">{when(p.ts)}</td><td className="num">{num(p.quality, 1)}%</td><td className="num">{p.shelf_life_days ? `${num(p.shelf_life_days, 1)} d` : "> 30 d"}</td><td><Badge>{p.confidence}</Badge></td><td className="text-xs text-charcoal-400">{p.model_version}</td></tr>
            ))}</tbody></table>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">{data.data_origins.map((o: string) => <OriginTag key={o} origin={o} />)}</div>
      </Card>
      <div className="flex items-start gap-2 rounded-lg bg-cream-100 p-3 text-xs text-charcoal-500"><ShieldAlert className="h-4 w-4 shrink-0" /> {data.disclaimer} No personal phone numbers are shown.</div>
      {!embedded && <div className="text-center text-xs text-charcoal-400">Issued by ZERO ROT</div>}
    </div>
  );
}

export function PublicPassport() {
  const { token } = useParams();
  return <div className="mx-auto max-w-3xl px-4 py-6"><div className="mb-5"><Logo /></div><PassportView token={token!} /></div>;
}

export default function Passport() {
  const { batchId } = useSelection();
  const { data: b } = useQuery({ queryKey: ["batch", batchId], queryFn: () => api(`/batches/${batchId}`), enabled: !!batchId });
  if (!b) return <Loading />;
  const url = `${location.origin}/p/${b.passport_token}`;
  return (
    <div>
      <PageHeader kicker="Prove" title="Harvest passport" subtitle="Public, read-only traceability page for each batch, opened by a secure token or QR. Not a food-safety certificate." />
      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="h-fit text-center">
          <div className="mx-auto w-fit rounded-xl bg-white p-3 shadow-soft"><QRCodeSVG value={url} size={200} fgColor="#1F4D3A" /></div>
          <div className="mt-3 font-mono text-xs font-semibold text-forest">{b.id}</div>
          <Link to={`/p/${b.passport_token}`} className="mt-2 block break-all text-xs text-leaf-600 hover:underline">{url}</Link>
        </Card>
        <PassportView token={b.passport_token} embedded />
      </div>
    </div>
  );
}
