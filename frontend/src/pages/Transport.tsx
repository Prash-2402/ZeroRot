import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Flame, Snowflake, Truck, Users } from "lucide-react";
import { api, post } from "../lib/api";
import { inr, num, PRODUCE_EMOJI, when } from "../lib/format";
import { useLive, useSelection } from "../stores/live";
import { LiveMap } from "../components/LiveMap";
import { Badge, Card, cn, ErrorBox, Loading, Note, OriginTag, PageHeader, Spinner } from "../components/ui";
import { RescuePanel } from "../features/RescuePanel";

function WhatsAppPreview({ tripId }: { tripId: string }) {
  const { data } = useQuery({ queryKey: ["notifications", "wa"], queryFn: () => api("/notifications?channel=whatsapp_preview&limit=30"), refetchInterval: 6000 });
  const msgs = (data?.notifications || []).filter((n: any) => n.trip_id === tripId).slice(0, 4).reverse();
  if (!msgs.length) return null;
  return (
    <Card title="Farmer alert preview" subtitle="Kannada message with English translation. Preview only — WhatsApp Cloud API pending. Telegram sends real messages when configured.">
      <div className="mx-auto w-full max-w-[320px] rounded-[2rem] border-[6px] border-charcoal bg-[#ECE5DD] p-3 shadow-xl">
        <div className="-mx-3 -mt-3 mb-3 rounded-t-[1.5rem] bg-[#075E54] px-4 py-2 text-sm font-semibold text-white">ZERO ROT alerts</div>
        <div className="space-y-2">
          {msgs.map((m: any) => (
            <div key={m.id} className="ml-auto max-w-[92%] rounded-lg rounded-tr-none bg-[#DCF8C6] p-2 text-[13px] shadow-sm">
              {m.body_kn && <div className="kn leading-relaxed">{m.body_kn}</div>}
              <div className="mt-1 border-t border-black/10 pt-1 text-[11px] text-charcoal-500">{m.body}</div>
              {m.actions?.length > 0 && <div className="mt-1.5 grid grid-cols-3 gap-1">{m.actions.map((a: any) => <span key={a.action} className="rounded bg-white/70 py-1 text-center text-[10px] font-semibold text-[#075E54]">{a.label}</span>)}</div>}
              <div className="mt-1 text-right text-[10px] text-charcoal-400">{when(m.ts)} · preview, not sent</div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function CargoChart({ batchId, setpoint }: { batchId: string; setpoint?: number }) {
  const simNow = useLive((s) => s.simNow);
  const { data } = useQuery({ queryKey: ["history", batchId, simNow?.slice(0, 15)], queryFn: () => api(`/batches/${batchId}/history`) });
  const pts = (data?.readings || []).slice(-80).map((r: any) => ({ t: r.ts.slice(11), temp: r.temp_c, rh: r.rh }));
  if (!pts.length) return <div className="text-xs text-charcoal-400">No feed readings for this load (open trucks use regional weather estimates).</div>;
  return (
    <div className="h-36">
      <ResponsiveContainer>
        <LineChart data={pts} margin={{ top: 4, right: 6, left: -20, bottom: 0 }}>
          <XAxis dataKey="t" tick={{ fontSize: 9 }} interval={15} />
          <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
          <Tooltip />
          {setpoint && <ReferenceLine y={setpoint} stroke="#3E8E5A" strokeDasharray="3 3" />}
          <Line dataKey="temp" name="Cargo °C (SIMULATED feed)" stroke="#C2463B" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function NewTrip() {
  const qc = useQueryClient();
  const { data: b } = useQuery({ queryKey: ["batches"], queryFn: () => api("/batches") });
  const { data: pts } = useQuery({ queryKey: ["points"], queryFn: () => api("/geo/points"), staleTime: Infinity });
  const { batchId } = useSelection();
  const stored = (b?.batches || []).filter((x: any) => x.status === "stored");
  const [bid, setBid] = useState("");
  const [dest, setDest] = useState("m_bengaluru");
  const [reefer, setReefer] = useState(true);
  useEffect(() => { if (!bid && stored.length) setBid(stored.find((x: any) => x.id === batchId)?.id || stored[0].id); }, [stored, bid, batchId]);
  const m = useMutation({ mutationFn: () => post("/trips", { batch_id: bid, dest_id: dest, reefer }), onSuccess: () => qc.invalidateQueries() });
  const dests = (pts?.points || []).filter((p: any) => p.kind !== "district");
  return (
    <Card title="Start a trip" subtitle="Moves a stored batch along a road route. The decay engine then follows the cargo's conditions every tick.">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
        <select className="input" value={bid} onChange={(e) => setBid(e.target.value)}>{stored.map((x: any) => <option key={x.id} value={x.id}>{PRODUCE_EMOJI[x.produce]} {x.id} · {x.district_name}</option>)}</select>
        <select className="input" value={dest} onChange={(e) => setDest(e.target.value)}>{dests.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={reefer} onChange={(e) => setReefer(e.target.checked)} /> Reefer</label>
        <button className="btn-primary" disabled={!bid || m.isPending} onClick={() => m.mutate()}>{m.isPending ? <Spinner /> : <Truck className="h-4 w-4" />} Dispatch</button>
      </div>
      <div className="mt-2"><ErrorBox error={m.error} /></div>
    </Card>
  );
}

function GroupShipping() {
  const { batchId } = useSelection();
  const [dest, setDest] = useState("m_bengaluru");
  const { data, error } = useQuery({ queryKey: ["group", batchId, dest], queryFn: () => api(`/group-shipping?batch_id=${batchId}&dest_id=${dest}`), enabled: !!batchId });
  const [created, setCreated] = useState<any>(null);
  const m = useMutation({ mutationFn: () => post("/group-shipping", { batch_id: batchId, dest_id: dest }), onSuccess: setCreated });
  return (
    <Card title={<span className="flex items-center gap-2"><Users className="h-4 w-4" /> Group shipping</span>} subtitle="Share one truck with nearby compatible batches (within 80 km). Incompatible handling is flagged."
      action={<select className="input w-44 py-1 text-xs" value={dest} onChange={(e) => setDest(e.target.value)}>{["m_bengaluru", "m_mysuru", "m_hubballi", "m_tumakuru", "m_davanagere"].map((d) => <option key={d} value={d}>{d.replace("m_", "").replace(/^./, (c) => c.toUpperCase())} APMC</option>)}</select>}>
      {error && <ErrorBox error={error} />}
      {data && (
        <>
          <table className="w-full text-sm">
            <thead><tr className="[&>th]:label [&>th]:py-1.5 [&>th]:text-left"><th>Batch</th><th>Qty</th><th>Solo</th><th>Shared</th><th>Saves</th></tr></thead>
            <tbody>{data.members.map((m: any) => (
              <tr key={m.batch_id} className="border-t border-cream-100 [&>td]:py-1.5"><td className="font-mono text-xs">{PRODUCE_EMOJI[m.produce]} {m.batch_id}</td><td className="num">{num(m.quantity_kg, 0)} kg</td><td className="num">{inr(m.solo_cost)}</td><td className="num">{inr(m.shared_cost)}</td><td className="num font-semibold text-leaf-600">{inr(m.savings)}</td></tr>
            ))}</tbody>
          </table>
          {data.warnings.map((w: any) => <div key={w.batch_id} className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-600">{w.batch_id}: {w.message}</div>)}
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-charcoal-400">{data.label}</span>
            <button className="btn-secondary text-xs" disabled={data.members.length < 2 || m.isPending} onClick={() => m.mutate()}>{data.members.length < 2 ? "No partners nearby" : "Create group shipment"}</button>
          </div>
          {created && <div className="mt-2 text-xs text-leaf-600">Group shipment #{created.id} recorded ({created.members.length} batches, truck {inr(created.shared_truck_cost)}).</div>}
        </>
      )}
    </Card>
  );
}

export default function Transport() {
  const [sp] = useSearchParams();
  const qc = useQueryClient();
  const version = useLive((s) => s.version);
  const trucks = useLive((s) => s.trucks);
  const toast = useLive((s) => s.toast);
  const { data, isLoading } = useQuery({ queryKey: ["trips", version], queryFn: () => api("/trips"), refetchInterval: 8000 });
  const [sel, setSel] = useState<string | null>(sp.get("trip") || "TRIP-S2");
  const trips = data?.trips || [];
  const active = trips.filter((t: any) => t.status === "in_transit");
  const trip = trips.find((t: any) => t.id === sel) || active[0];
  const live = trip ? trucks[trip.id] : null;
  const inject = useMutation({ mutationFn: (id: string) => post(`/trips/${id}/inject-failure`), onSuccess: () => qc.invalidateQueries(), onError: (e: any) => toast({ title: "Cannot inject", body: e.message, severity: "warning" }) });
  const sorted = useMemo(() => [...trips].sort((a: any, b: any) => Number(b.is_scenario) - Number(a.is_scenario) || (a.status === "in_transit" ? -1 : 1)), [trips]);
  return (
    <div className="space-y-6">
      <PageHeader kicker="Protect" title="Transport" subtitle="Live trips on real OSRM road geometry with a SIMULATED cold-chain feed. Rerouting is always a recommendation that needs human approval." />
      {isLoading ? <Loading /> : (
        <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
          <Card title="Trips" className="max-h-[78vh] overflow-auto p-3">
            <div className="space-y-1.5">
              {sorted.map((t: any) => {
                const tr = trucks[t.id];
                return (
                  <button key={t.id} onClick={() => setSel(t.id)} className={cn("w-full rounded-lg border px-3 py-2 text-left", trip?.id === t.id ? "border-forest bg-forest-50" : "border-cream-200 hover:bg-cream-100")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-forest">{t.id}</span>
                      <span className="flex gap-1">
                        {t.is_scenario && <Badge tone="amber">Scenario 2</Badge>}
                        {t.reefer && <Badge tone={t.reefer_status === "failed" ? "red" : "blue"}>{t.reefer_status === "failed" ? "REEFER FAILED" : "reefer"}</Badge>}
                        {t.status !== "in_transit" && <Badge>{t.status}</Badge>}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-charcoal-500">{t.origin_name} → {t.dest_name}{t.rerouted && " (rerouted)"}</div>
                    {tr && <div className="mt-1 h-1 overflow-hidden rounded-full bg-cream-200"><div className="h-full bg-forest" style={{ width: `${tr.frac * 100}%` }} /></div>}
                  </button>
                );
              })}
            </div>
          </Card>
          {trip && (
            <div className="min-w-0 space-y-6">
              <div className="card overflow-hidden"><LiveMap trips={trips} focusTrip={trip.id} height={340} /></div>
              <div className="grid gap-6 lg:grid-cols-2">
                <Card title={`${trip.id} · ${trip.origin_name} → ${trip.dest_name}`} subtitle={`${num(trip.distance_km, 0)} km · ${num(trip.duration_h, 1)} h · batch ${trip.batch_id}`}
                  action={<OriginTag origin={trip.route_source} />}>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div><div className="label">Progress</div><div className="num font-semibold">{live ? `${Math.round(live.frac * 100)}%` : trip.status}</div></div>
                    <div><div className="label">Cargo</div><div className={cn("num font-semibold", live?.reefer_status === "failed" && "text-rot")}>{live?.cargo_temp ?? num(trip.cargo_temp, 1)} °C</div></div>
                    <div><div className="label">Quality</div><div className="num font-semibold">{live ? `${live.quality}%` : "—"}</div></div>
                  </div>
                  <div className="mt-4"><CargoChart batchId={trip.batch_id} setpoint={trip.reefer ? (trip.truck?.produce === "banana" ? 14 : trip.truck?.produce === "mango" ? 13 : 12.5) : undefined} /></div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {trip.reefer && trip.reefer_status === "ok" && trip.status === "in_transit" && (
                      <button className="btn-danger" onClick={() => inject.mutate(trip.id)} disabled={inject.isPending}>{inject.isPending ? <Spinner /> : <Flame className="h-4 w-4" />} Inject reefer failure</button>
                    )}
                    {trip.reefer_status === "failed" && <Badge tone="red"><Snowflake className="h-3 w-3" /> failed {when(trip.failed_at)}</Badge>}
                    <span className="text-xs text-charcoal-400">Simulated fault. Temperature then relaxes toward ambient (+2 °C) with a 1.5 h time constant (engineering assumption).</span>
                  </div>
                </Card>
                <div className="space-y-6">
                  <RescuePanel tripId={trip.id} />
                  {!trip.pending_reroute && trip.reefer_status !== "failed" && <Note>Inject a reefer failure to run the rescue workflow: detect, assess, plan, check capacity and notify.</Note>}
                </div>
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <WhatsAppPreview tripId={trip.id} />
                <div className="space-y-6"><NewTrip /><GroupShipping /></div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
