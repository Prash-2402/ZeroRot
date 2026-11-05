import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Flame, PackageCheck, Route, ShieldCheck } from "lucide-react";
import { post } from "../lib/api";
import { inr } from "../lib/format";
import { useT } from "../lib/i18n";
import { useLive } from "../stores/live";
import { useUI } from "../stores/ui";
import { cn, Spinner } from "../components/ui";
import { BigButton } from "./common";

const STAGES = ["Detect", "Assess", "Plan", "Check capacity", "Notify"];

export function TruckPanel({ truck, card }: { truck: any; card: any }) {
  const { t, market } = useT();
  const qc = useQueryClient();
  const detailed = useUI((s) => s.detailed);
  const loadingAt = useUI((s) => s.loadingAt);
  const startLoading = useUI((s) => s.startLoading);
  const toast = useLive((s) => s.toast);
  const live = useLive((s) => s.trucks["TRIP-S2"]);
  const wf = useLive((s) => s.workflow["TRIP-S2"]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["farm"] });
  const hand = useMutation({ mutationFn: () => post(`/farm/handover/${card.id}`), onSuccess: refresh, onError: (e: any) => toast({ title: e.message, severity: "warning" }) });
  const fail = useMutation({ mutationFn: () => post(`/trips/TRIP-S2/inject-failure`), onSuccess: refresh, onError: (e: any) => toast({ title: e.message, severity: "warning" }) });
  const approve = useMutation({ mutationFn: () => post(`/trips/TRIP-S2/approve-reroute`, { via: "farmer app" }), onSuccess: refresh, onError: (e: any) => toast({ title: e.message, severity: "warning" }) });

  if (truck.state === "parked" || loadingAt) {
    return (
      <div className="rounded-3xl border-2 border-forest/15 bg-white p-4">
        <div className="text-lg font-extrabold text-forest">{t("truckWaiting")}</div>
        <div className="mt-1 text-sm text-charcoal-500">{t("truckGoesTo", { m: market("m_hubballi", truck.dest_name) })}</div>
        <div className="mt-3">
          {loadingAt ? <div className="flex items-center gap-2 rounded-2xl bg-cream-100 px-4 py-4 font-bold text-forest"><Spinner /> {t("loadingNow")}</div>
            : <BigButton onClick={() => { startLoading(); hand.mutate(); }} disabled={hand.isPending} icon={<PackageCheck className="h-5 w-5" />}>{t("handover")}</BigButton>}
        </div>
      </div>
    );
  }
  const failed = truck.reefer_status === "failed" || live?.reefer_status === "failed";
  const progress = live?.frac ?? truck.progress ?? 0;
  const temp = live?.cargo_temp ?? truck.cargo_temp;
  const proposal = truck.pending_reroute || wf?.proposal;
  const steps = wf?.steps || [];
  const ghost = truck.ghost;
  const dest = market(truck.trip?.dest_id || (truck.rerouted ? undefined : "m_hubballi"), truck.dest_name);
  return (
    <div className="space-y-3">
      <div className={cn("rounded-3xl border-2 p-4", failed ? "border-rot/40 bg-rot-50" : "border-forest/15 bg-white")}>
        <div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">{t("trip")} · {truck.operator}</div>
        <div className="mt-1 text-lg font-extrabold text-forest">{truck.state === "arrived" ? t("arrived", { m: dest }) : t("onRoad", { m: dest })}</div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-cream-200"><div className={cn("h-full rounded-full transition-all", failed ? "bg-rot" : "bg-forest")} style={{ width: `${Math.round(progress * 100)}%` }} /></div>
        <div className="mt-1 flex justify-between text-[11px] text-charcoal-400"><span>{t("myFarm")}</span><span>{Math.round(progress * 100)}%</span><span>{dest}</span></div>
        <div className="mt-3 flex items-end justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase text-charcoal-400">{t("cargoTemp")}</div>
            <div className={cn("num text-3xl font-extrabold", failed ? "text-rot" : "text-forest")}>{temp !== null && temp !== undefined ? Number(temp).toFixed(1) : "—"} °C</div>
          </div>
          {failed && <div className="flex items-center gap-1 text-sm font-bold text-rot"><AlertTriangle className="h-4 w-4" />{t("coolingFailed")}</div>}
        </div>
        {!failed && truck.state === "on_road" && (
          <div className="mt-3">
            <BigButton tone="soft" onClick={() => fail.mutate()} disabled={fail.isPending} icon={<Flame className="h-5 w-5 text-rot" />}>{t("simulateBreak")}</BigButton>
            <div className="mt-1 text-center text-[11px] text-charcoal-400">{t("demoOnly")} · F</div>
          </div>
        )}
      </div>

      {failed && !ghost && (
        <div className="rounded-3xl bg-white p-4">
          <div className="text-sm font-bold text-forest">{t("checking")}</div>
          <div className="mt-3 flex gap-1.5">
            {STAGES.map((s) => {
              const done = steps.some((x: any) => x.stage === s) || !!proposal;
              return (
                <div key={s} className="flex-1 text-center">
                  <div className={cn("mx-auto grid h-8 w-8 place-items-center rounded-full text-xs font-bold", done ? "bg-leaf text-white" : "bg-cream-200 text-charcoal-400")}>{done ? <CheckCircle2 className="h-4 w-4" /> : "…"}</div>
                  <div className="mt-1 text-[10px] font-semibold text-charcoal-500">{t(s)}</div>
                </div>
              );
            })}
          </div>
          {detailed && steps.length > 0 && <ol className="mt-3 space-y-1 text-[11px] text-charcoal-500">{steps.map((s: any) => <li key={s.idx}>• {s.summary}</li>)}</ol>}
          {detailed && wf?.kind && <div className="mt-1 text-[10px] text-charcoal-300">{wf.kind === "agentic" ? "Agentic Rescue Workflow (Groq)" : "Rule-Based Workflow"}</div>}
        </div>
      )}

      {proposal && proposal.recommend === "reroute" && !proposal.approved && !ghost && (
        <motion.div initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="rounded-3xl border-2 border-amber bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-sm font-extrabold uppercase text-amber-600"><Route className="h-4 w-4" />{t("recommendChange")}</div>
          <div className="mt-1 text-xl font-extrabold text-forest">{t("divertTo", { m: market(proposal.target_id, proposal.target_name) })}</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-white p-3"><div className="text-[11px] font-bold uppercase text-charcoal-400">{t("ifContinues")}</div><div className="num text-lg font-extrabold text-rot">{inr(proposal.continue_net)}</div><div className="text-xs text-charcoal-500">{t("qualityAt")} {Math.round(proposal.continue_quality)}%</div></div>
            <div className="rounded-2xl bg-white p-3"><div className="text-[11px] font-bold uppercase text-charcoal-400">{t("withChange")}</div><div className="num text-lg font-extrabold text-leaf-600">{inr(proposal.expected_net)}</div><div className="text-xs text-charcoal-500">{t("qualityAt")} {Math.round(proposal.expected_quality)}%</div></div>
          </div>
          {detailed && <div className="mt-2 text-[11px] text-charcoal-500">{proposal.label}</div>}
          <div className="mt-3"><BigButton onClick={() => approve.mutate()} disabled={approve.isPending} icon={approve.isPending ? <Spinner /> : <ShieldCheck className="h-5 w-5" />}>{t("approve")}</BigButton></div>
          <div className="mt-1 text-center text-[11px] text-charcoal-500">{t("needsYou")}</div>
        </motion.div>
      )}
      {proposal && proposal.recommend === "continue" && <div className="rounded-3xl bg-white p-4 text-sm font-semibold text-forest">{t("noBetter")}</div>}

      {ghost && (
        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={cn("rounded-3xl p-5 text-center", ghost.value_protected > 0 ? "bg-leaf text-white" : "bg-white text-forest")}>
          <div className="text-3xl font-extrabold">{ghost.value_protected > 0 ? t("youSaved", { v: inr(ghost.value_protected) }) : t("noBetter")}</div>
          <div className="mt-1 text-xs opacity-90">{t("estimate")}</div>
          <div className="mt-1 text-xs opacity-90">{t("ghostTruck")}</div>
          {detailed && (
            <div className="mt-3 grid grid-cols-2 gap-2 text-left text-xs text-charcoal">
              {[["Ghost", ghost.ghost], ["Reroute", ghost.reroute]].map(([l, r]: any) => (
                <div key={l} className="rounded-xl bg-white p-2"><b>{l}</b><div>{t("qualityAt")} {Math.round(r.quality_at_sale)}% · {Math.round(r.saleable_kg)} kg</div><div>{t("youGetShort")} {inr(r.net)}</div></div>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
