import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ShieldCheck, Truck } from "lucide-react";
import { api, post } from "../lib/api";
import { days, inr, num } from "../lib/format";
import { useLive } from "../stores/live";
import { ProduceVisual } from "../components/ProduceVisual";
import { Logo } from "../components/Layout";
import { Badge, cn, ConfidenceBadge, Loading, Spinner } from "../components/ui";

const KEY = "zr-judge-batch";

/** Mobile farmer view opened from the Control Room QR code. */
export default function Judge() {
  const qc = useQueryClient();
  const version = useLive((s) => s.version);
  const alerts = useLive((s) => s.alerts);
  const [bid, setBid] = useState<string | null>(() => { try { return localStorage.getItem(KEY); } catch { return null; } });
  const create = useMutation({ mutationFn: () => post("/judge/session"), onSuccess: (b: any) => { try { localStorage.setItem(KEY, b.id); } catch { /* ignore */ } setBid(b.id); } });
  const { data: batch, error } = useQuery({ queryKey: ["batch", bid, version], queryFn: () => api(`/batches/${bid}`), enabled: !!bid, retry: false, refetchInterval: 8000 });
  useEffect(() => { if (!bid && !create.isPending && !create.isSuccess) create.mutate(); }, [bid]); // eslint-disable-line
  useEffect(() => { if (error && (error as any).status === 404) { try { localStorage.removeItem(KEY); } catch { /* ignore */ } setBid(null); } }, [error]);
  const { data: twin } = useQuery({ queryKey: ["twin", bid, version], queryFn: () => api(`/batches/${bid}/twin?horizon_days=7`), enabled: !!batch, refetchInterval: 15000 });
  const { data: dec } = useQuery({ queryKey: ["decide", bid, version], queryFn: () => api(`/decide/${bid}`), enabled: !!batch });
  const { data: trip } = useQuery({ queryKey: ["ghost", batch?.trip_id, version], queryFn: () => api(`/ghost/${batch.trip_id}`), enabled: !!batch?.trip_id, refetchInterval: 4000 });
  const ship = useMutation({ mutationFn: (dest: string) => post("/trips", { batch_id: bid, dest_id: dest, reefer: false }), onSuccess: () => qc.invalidateQueries() });
  const approve = useMutation({ mutationFn: () => post(`/trips/${batch.trip_id}/approve-reroute`, { via: "judge" }), onSuccess: () => qc.invalidateQueries() });
  if (!batch || !twin) return <div className="min-h-screen bg-cream-50 p-4"><Logo /><Loading label="Creating your demo batch" /></div>;
  const rec = dec?.recommended;
  const myAlerts = alerts.filter((a) => a.batch_id === bid).slice(0, 4);
  const pending = trip?.trip?.pending_reroute;
  return (
    <div className="min-h-screen bg-cream-50 pb-10">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-cream-200 bg-cream-50/95 px-4 py-3 backdrop-blur"><Logo /><Badge tone="amber">Judge farmer · DEMO</Badge></header>
      <main className="mx-auto max-w-md space-y-4 px-4 pt-4">
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <ProduceVisual produce="tomato" quality={twin.current.quality} size={92} />
            <div>
              <div className="font-mono text-xs text-charcoal-400">{batch.id}</div>
              <div className="font-display text-2xl text-forest">500 kg tomatoes</div>
              <div className="text-xs text-charcoal-500">Kolar · {batch.status === "in_transit" ? "on the road" : "open shed"} · <span className="kn">ಟೊಮೇಟೊ</span></div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-cream-100 p-2"><div className="label">Quality</div><div className="num text-lg font-semibold text-forest">{num(twin.current.quality, 0)}%</div></div>
            <div className="rounded-lg bg-cream-100 p-2"><div className="label">Shelf life</div><div className="num text-lg font-semibold text-forest">{days(twin.shelf_life.days, twin.shelf_life.beyond_horizon)}</div></div>
            <div className="rounded-lg bg-cream-100 p-2"><div className="label">Value</div><div className="num text-lg font-semibold text-forest">{inr(twin.current.value, { compact: true })}</div></div>
          </div>
          <div className="mt-3"><ConfidenceBadge c={twin.confidence} full /></div>
          {twin.conditions.weather_based && <div className="mt-2 text-[11px] text-amber-600">Shed conditions estimated from regional weather.</div>}
        </div>
        {dec && rec && (
          <div className="card overflow-hidden">
            <div className="bg-forest p-4 text-cream-50">
              <div className="label text-sage-300">Recommendation</div>
              <div className="font-display text-3xl">{dec.action}</div>
              <div className="mt-1 text-sm">{dec.explanation}</div>
            </div>
            <div className="space-y-2 p-4">
              {batch.status === "stored" && dec.alternatives.filter((a: any) => a.kind === "SHIP").slice(0, 2).map((a: any) => (
                <button key={a.key} className={cn(a.key === rec.key ? "btn-primary" : "btn-secondary", "w-full justify-between")} onClick={() => ship.mutate(a.market_id)} disabled={ship.isPending}>
                  <span className="flex items-center gap-2"><Truck className="h-4 w-4" /> Ship to {a.market_name}</span><span className="num">{inr(a.net)}</span>
                </button>
              ))}
              {batch.status === "in_transit" && <div className="flex items-center gap-2 text-sm text-leaf-600"><CheckCircle2 className="h-4 w-4" /> Your truck is on the Control Room map.</div>}
            </div>
          </div>
        )}
        {pending?.recommend === "reroute" && !pending.approved && (
          <div className="card border-amber/50 p-4">
            <div className="font-semibold text-amber-600">Reroute recommended</div>
            <div className="mt-1 text-sm">{pending.label}</div>
            <button className="btn-primary mt-3 w-full" onClick={() => approve.mutate()} disabled={approve.isPending}>{approve.isPending ? <Spinner /> : <ShieldCheck className="h-4 w-4" />} Approve reroute</button>
          </div>
        )}
        <div className="card p-4">
          <div className="label mb-2">Alerts</div>
          {myAlerts.length === 0 ? <div className="text-sm text-charcoal-400">No alerts for your batch yet.</div> : myAlerts.map((a) => (
            <div key={a.id} className="mb-2 rounded-lg bg-cream-100 p-2 text-sm"><div className="font-medium text-forest">{a.title}</div>{a.body_kn && <div className="kn text-xs">{a.body_kn}</div>}<div className="text-xs text-charcoal-500">{a.body}</div></div>
          ))}
        </div>
        <button className="btn-ghost w-full text-xs" onClick={() => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } setBid(null); create.reset(); create.mutate(); }}>Start a new judge batch</button>
      </main>
    </div>
  );
}
