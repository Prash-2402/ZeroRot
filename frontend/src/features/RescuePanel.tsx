import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AlertTriangle, Bot, CheckCircle2, Cog, Route, ShieldCheck } from "lucide-react";
import { api, post } from "../lib/api";
import { inr, num } from "../lib/format";
import { useLive } from "../stores/live";
import { Badge, cn, Spinner } from "../components/ui";

const STAGES = ["Detect", "Assess", "Plan", "Check capacity", "Notify"];

/** Live workflow timeline + human-approval card + ghost comparison for one trip. */
export function RescuePanel({ tripId, dark }: { tripId: string; dark?: boolean }) {
  const qc = useQueryClient();
  const live = useLive((s) => s.workflow[tripId]);
  const toast = useLive((s) => s.toast);
  const { data: wf } = useQuery({ queryKey: ["workflow", tripId, live?.done], queryFn: () => api(`/workflows/${tripId}`) });
  const { data: ghost } = useQuery({ queryKey: ["ghost", tripId], queryFn: () => api(`/ghost/${tripId}`), refetchInterval: 5000 });
  const approve = useMutation({
    mutationFn: (key?: string) => post(`/trips/${tripId}/approve-reroute`, { option_key: key, via: "app" }),
    onSuccess: () => { qc.invalidateQueries(); },
    onError: (e: any) => toast({ title: "Could not approve", body: e.message, severity: "critical" }),
  });
  const steps = live?.steps?.length ? live.steps : (wf?.steps || []);
  const kind = live?.kind || wf?.run?.kind;
  const proposal = ghost?.trip?.pending_reroute || live?.proposal || wf?.run?.result;
  const cmp = ghost?.comparison;
  const running = (live && !live.done) || wf?.run?.status === "running";
  if (!steps.length && !proposal && !running) return null;
  const box = dark ? "card-dark" : "card";
  const muted = dark ? "text-sage-500" : "text-charcoal-400";
  const strong = dark ? "text-cream-50" : "text-forest";
  return (
    <div className={cn(box, "p-4")}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className={cn("flex items-center gap-2 font-semibold", strong)}>
          {kind === "agentic" ? <Bot className="h-4 w-4" /> : <Cog className="h-4 w-4" />}
          {kind === "agentic" ? "Agentic Rescue Workflow" : "Rule-Based Workflow"}
          {running && <Spinner className="h-3.5 w-3.5" />}
        </div>
        <Badge tone={kind === "agentic" ? "green" : "grey"}>{kind === "agentic" ? "Groq tool calling" : "deterministic"}</Badge>
      </div>
      {(live?.note || wf?.run?.note) && <div className={cn("mb-2 text-[11px]", muted)}>{live?.note || wf?.run?.note}</div>}
      <div className="mb-3 flex gap-1">
        {STAGES.map((s) => {
          const done = steps.some((x: any) => x.stage === s);
          return <div key={s} className={cn("h-1.5 flex-1 rounded-full transition-colors", done ? "bg-leaf" : dark ? "bg-night-600" : "bg-cream-200")} title={s} />;
        })}
      </div>
      <ol className="space-y-2">
        {steps.map((s: any) => (
          <motion.li key={s.idx} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex gap-2 text-xs">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-leaf" />
            <div><span className={cn("font-semibold", strong)}>{s.stage}</span> <span className={muted}>· {s.tool}</span><div className={dark ? "text-cream-200" : "text-charcoal-500"}>{s.summary}</div></div>
          </motion.li>
        ))}
      </ol>
      {proposal && proposal.recommend === "reroute" && !proposal.approved && (
        <div className={cn("mt-4 rounded-lg border p-3", dark ? "border-amber/40 bg-amber/10" : "border-amber/40 bg-amber-50")}>
          <div className={cn("flex items-center gap-2 text-sm font-semibold", dark ? "text-amber" : "text-amber-600")}><Route className="h-4 w-4" /> Reroute recommended · needs your approval</div>
          <div className={cn("mt-1 text-sm", strong)}>{proposal.label}</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <div><div className={muted}>If it continues</div><div className={cn("num font-semibold", strong)}>{inr(proposal.continue_net)} · {num(proposal.continue_quality, 0)}%</div></div>
            <div><div className={muted}>With reroute</div><div className="num font-semibold text-leaf">{inr(proposal.expected_net)} · {num(proposal.expected_quality, 0)}%</div></div>
          </div>
          <div className={cn("mt-1 text-[11px]", muted)}>Leg {proposal.leg_km} km · {proposal.route_source === "osrm_cached" ? "road route (OSRM, cached)" : proposal.route_source === "osrm_live" ? "road route (OSRM live)" : "approximate path"}</div>
          <button className="btn-primary mt-3 w-full" onClick={() => approve.mutate(undefined)} disabled={approve.isPending}>
            {approve.isPending ? <Spinner /> : <ShieldCheck className="h-4 w-4" />} Approve reroute
          </button>
        </div>
      )}
      {proposal && proposal.recommend === "continue" && (
        <div className={cn("mt-4 rounded-lg border p-3 text-sm", dark ? "border-night-500" : "border-cream-200")}>
          <AlertTriangle className="mr-1 inline h-4 w-4 text-amber" /> {proposal.message}
        </div>
      )}
      {cmp && (
        <div className={cn("mt-4 rounded-lg border p-3", dark ? "border-leaf/40 bg-leaf/10" : "border-leaf/40 bg-leaf/5")}>
          <div className={cn("label", dark && "text-sage-500")}>Ghost comparison · same start state</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
            {[["Ghost: original plan", cmp.ghost], ["Approved reroute", cmp.reroute]].map(([l, r]: any) => (
              <div key={l} className={cn("rounded-md p-2", dark ? "bg-night-700" : "bg-white")}>
                <div className={cn("font-semibold", strong)}>{l}</div>
                <div className={muted}>Quality at sale <b className={strong}>{num(r.quality_at_sale, 0)}%</b></div>
                <div className={muted}>Saleable <b className={strong}>{num(r.saleable_kg, 0)} kg</b></div>
                <div className={muted}>Revenue <b className={strong}>{inr(r.base?.gross)}</b></div>
                <div className={muted}>Costs <b className={strong}>{inr((r.transport_cost || 0) + (r.rent || 0) + (r.handling || 0) + (r.base?.commission || 0))}</b></div>
                <div className={muted}>Net <b className={strong}>{inr(r.net)}</b></div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-2">
            <span className={cn("text-sm", strong)}>Value protected</span>
            <span className={cn("num whitespace-nowrap text-xl font-semibold", cmp.value_protected > 0 ? "text-leaf" : "text-rot")}>{cmp.value_protected > 0 ? inr(cmp.value_protected) : "₹0"}</span>
          </div>
          {!cmp.reroute_better && <div className="text-xs text-rot">The reroute is not better than continuing; no value protected.</div>}
          <div className={cn("mt-1 text-[11px]", muted)}>{cmp.label}</div>
        </div>
      )}
    </div>
  );
}
