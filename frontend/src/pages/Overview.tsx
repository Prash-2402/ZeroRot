import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { api } from "../lib/api";
import { days, kg, num, when } from "../lib/format";
import { Empty, ErrorBox, Loading, Metric, PageHead, Panel, cn } from "../components/ui";
import { useSims } from "../components/shared";
import { AlertRow } from "../components/SimulationView";

const KIND_PATH: Record<string, string> = { traditional_storage: "/app/traditional", cold_storage: "/app/cold-storage", cold_chain: "/app/cold-chain" };
export const KIND_LABEL: Record<string, string> = { traditional_storage: "Traditional storage", cold_storage: "Cold storage", cold_chain: "Cold chain" };

export default function Overview() {
  const s = useQuery({ queryKey: ["summary"], queryFn: () => api("/analytics/summary"), refetchInterval: 15000 });
  const sims = useSims();
  const alerts = useQuery({ queryKey: ["alerts", "recent"], queryFn: () => api("/alerts?status=open&limit=5"), refetchInterval: 20000 });
  if (s.isLoading) return <Loading />;
  if (s.error) return <ErrorBox error={s.error} />;
  const d = s.data;
  const empty = d.active_batches === 0 && (sims.data?.simulations || []).length === 0;
  return (
    <div className="space-y-5">
      <PageHead kicker="Command centre" title="Overview" sub="Figures below are computed from your own batches and running simulations. Nothing is pre-filled." />
      {empty ? (
        <Empty title="Nothing monitored yet" action={<Link to="/app/post-harvest" className="btn-gold">Register first batch <ArrowRight className="h-4 w-4" /></Link>}>
          Start by registering a farmer and a produce batch. Then simulate traditional storage, inspect and allocate it to cold storage, or plan a refrigerated trip.
        </Empty>
      ) : (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          <Metric label="Active batches" value={d.active_batches} />
          <Metric label="Produce monitored" value={kg(d.monitored_kg)} />
          <Metric label="Mean quality" value={d.mean_quality != null ? num(d.mean_quality) : "—"} sub={d.mean_quality == null ? "no running simulation" : "SIMULATED"} />
          <Metric label="Mean shelf life" value={d.mean_shelf_life_days != null ? days(d.mean_shelf_life_days) : "—"} sub="from predictions" />
          <Metric label="Running sims" value={d.running_simulations} />
          <Metric label="Vehicles en route" value={d.active_vehicles} sub={`${d.trucks} trucks registered`} />
          <Metric label="Open alerts" value={d.open_alerts} tone={d.critical_alerts_open ? "#EB4D3D" : undefined} sub={`${d.critical_alerts_open} critical`} />
          <Metric label="Loss (completed)" value={d.completed_loss_pct != null ? `${num(d.completed_loss_pct)}%` : "—"} sub={`${d.completed_simulations} completed sims`} />
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Simulations" action={<Link to="/app/lab" className="text-xs font-semibold underline">Open lab</Link>}>
          {(sims.data?.simulations || []).length === 0 ? <div className="p-3 text-sm text-ink-400">No simulations yet.</div> : (
            <table className="w-full text-sm">
              <thead><tr className="table-head"><th className="py-1 text-left">Name</th><th className="text-left">Type</th><th className="text-left">Status</th><th className="text-left">Created</th></tr></thead>
              <tbody className="table-body">
                {sims.data.simulations.slice(0, 8).map((x: any) => (
                  <tr key={x.id}>
                    <td className="py-1.5"><Link className="font-medium hover:text-gold-700" to={`${KIND_PATH[x.kind]}?sim=${x.id}`}>{x.name}</Link></td>
                    <td className="text-xs">{KIND_LABEL[x.kind]}</td>
                    <td><span className={cn("chip", x.status === "running" ? "bg-ok text-white" : "bg-paper-300")}>{x.status}</span></td>
                    <td className="text-xs text-ink-400">{when(x.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Open alerts" action={<Link to="/app/alerts" className="text-xs font-semibold underline">All alerts</Link>}>
          <div className="space-y-2">
            {(alerts.data?.alerts || []).length === 0 && <div className="p-3 text-sm text-ink-400">No open alerts.</div>}
            {(alerts.data?.alerts || []).map((a: any) => <AlertRow key={a.id} a={a} />)}
          </div>
        </Panel>
      </div>
      <div className="grid gap-px bg-paper-300 md:grid-cols-3">
        {[["/app/traditional", "Traditional storage", "Simulate a farm storage room with live weather."], ["/app/advanced", "Inspect & allocate", "Run CV inspection and pick a cold-storage zone."],
          ["/app/cold-chain", "Plan a reefer trip", "Route a refrigerated truck and watch the cargo heatmap."]].map(([to, t, b]) => (
          <Link key={to} to={to} className="group bg-white p-5 hover:bg-ink hover:text-paper">
            <div className="flex items-center justify-between font-display text-lg font-semibold">{t}<ArrowRight className="h-4 w-4 text-gold-700 group-hover:text-gold" /></div>
            <p className="mt-1 text-sm text-ink-400 group-hover:text-ink-300">{b}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
