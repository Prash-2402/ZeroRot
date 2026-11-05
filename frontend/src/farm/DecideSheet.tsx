import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { CheckCircle2, Snowflake, Store, Truck, X, XCircle } from "lucide-react";
import { api, post } from "../lib/api";
import { inr } from "../lib/format";
import { useT } from "../lib/i18n";
import { useUI } from "../stores/ui";
import { cn, Spinner } from "../components/ui";

const ICON: Record<string, any> = { SELL: Store, STORE: Snowflake, SHIP: Truck };
const CONDS = ["normal", "price_crash", "festival", "heavy_rain"];

export function DecideSheet({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const { t, market } = useT();
  const detailed = useUI((s) => s.detailed);
  const { data, isLoading } = useQuery({ queryKey: ["decide", batchId, "sheet"], queryFn: () => api(`/decide/${batchId}`) });
  const { data: farm } = useQuery({ queryKey: ["farm"], queryFn: () => api("/farm") });
  const [cond, setCond] = useState<string | null>(null);
  useEffect(() => { if (cond === null && farm) setCond(farm.market_condition?.condition || "normal"); }, [farm, cond]);
  const { data: shift } = useQuery({ queryKey: ["shift", batchId, cond], queryFn: () => api(`/decide/${batchId}/market-shift?condition=${cond}`), enabled: !!cond });
  const [msg, setMsg] = useState<string | null>(null);
  const choose = useMutation({
    mutationFn: (b: any) => post(`/decide/${batchId}/choice`, b),
    onSuccess: (r: any) => setMsg(r.difference < 0 ? t("lessThan", { v: inr(Math.abs(r.difference)) }) : t("chosenRec")),
  });
  useEffect(() => setMsg(null), [cond]);
  const alts = data?.alternatives || [];
  const best = (kind: string) => alts.filter((a: any) => a.kind === kind).sort((a: any, b: any) => b.net - a.net)[0];
  const rejectedFor = (kind: string) => (data?.rejected || []).find((r: any) => r.key.startsWith(kind === "SELL" ? "SELL" : kind));
  const recKey = data?.recommended?.key;
  return (
    <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div initial={{ y: 40 }} animate={{ y: 0 }} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-cream-50 p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-2xl font-semibold text-forest">{t("choices")}</h2>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-cream-200" aria-label={t("close")}><X className="h-5 w-5" /></button>
        </div>
        {isLoading || !data ? <div className="flex items-center gap-2 p-6 text-charcoal-400"><Spinner /> {t("loading")}</div> : (
          <div className="grid gap-3 sm:grid-cols-3">
            {["SELL", "STORE", "SHIP"].map((kind) => {
              const a = best(kind);
              const I = ICON[kind];
              const isRec = a && a.key === recKey;
              const rej = !a && rejectedFor(kind);
              return (
                <button key={kind} disabled={!a} onClick={() => a && choose.mutate({ kind: "decision", decision_id: data.decision_id, chosen_key: a.key })}
                  className={cn("relative rounded-3xl border-2 p-4 text-left transition-transform", a ? "hover:-translate-y-0.5" : "opacity-60",
                    isRec ? "border-forest bg-forest text-cream-50 shadow-[0_6px_0_#112B21]" : "border-forest/15 bg-white shadow-[0_4px_0_#D7E6DC]")}>
                  {isRec && <span className="absolute -top-3 left-4 rounded-full bg-amber px-2.5 py-0.5 text-[11px] font-extrabold uppercase text-white">{t("recommended")}</span>}
                  <I className="h-7 w-7" />
                  <div className="mt-2 text-lg font-extrabold">{t(kind)}</div>
                  {a ? (
                    <>
                      <div className={cn("text-sm", isRec ? "text-cream-100" : "text-charcoal-500")}>
                        {kind === "STORE" ? `${a.meta?.days} ${t("days")} · ${market(a.meta?.storage_id, a.meta?.storage_name)}` : market(a.market_id, a.market_name)}
                      </div>
                      <div className="num mt-3 text-2xl font-extrabold">{inr(a.net)}</div>
                      <div className={cn("text-xs", isRec ? "text-cream-100" : "text-charcoal-400")}>{t("qualityAt")} {Math.round(a.quality_at_sale)}%</div>
                    </>
                  ) : <div className="mt-2 text-xs">{rej ? rej.reason : "—"}</div>}
                </button>
              );
            })}
          </div>
        )}
        {msg && <div className="mt-3 flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-sm font-semibold text-forest"><CheckCircle2 className="h-4 w-4 text-leaf" />{msg}</div>}
        {detailed && data?.rejected?.length > 0 && (
          <div className="mt-3 space-y-1 rounded-2xl bg-white p-3 text-xs">
            {data.rejected.map((r: any) => <div key={r.key} className="flex gap-2 text-charcoal-500"><XCircle className="h-3.5 w-3.5 shrink-0 text-rot" />{r.label}: {r.reason}</div>)}
            <div className="pt-1 text-charcoal-300">{data.labels?.engine} · {data.labels?.thresholds}</div>
          </div>
        )}

        <div className="mt-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-extrabold text-forest">{t("whenSell")}</h3>
            <div className="flex flex-wrap gap-1.5">
              {CONDS.map((c) => (
                <button key={c} onClick={() => setCond(c)} className={cn("rounded-full px-3 py-1.5 text-xs font-bold", cond === c ? "bg-forest text-cream-50" : "bg-white text-forest ring-1 ring-forest/15")}>{t(c)}</button>
              ))}
            </div>
          </div>
          {shift && (
            <>
              {shift.shift_detected && <div className="mb-3 rounded-2xl bg-amber-50 px-3 py-2 text-sm text-amber-600">{t(shift.condition)} · {market(shift.market.id, shift.market.name)}{detailed ? `: ${shift.banner}` : ""}</div>}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {shift.periods.map((p: any) => (
                  <button key={p.key} onClick={() => choose.mutate({ kind: "market_shift", plan_id: shift.plan_id, chosen_key: p.key })}
                    className={cn("relative rounded-2xl border-2 p-3 text-left", p.recommended ? "border-forest bg-forest-50" : "border-forest/10 bg-white")}>
                    {p.recommended && <span className="absolute -top-2.5 left-3 rounded-full bg-forest px-2 py-0.5 text-[10px] font-bold uppercase text-cream-50">{t("recommended")}</span>}
                    <div className="font-extrabold text-forest">{p.day === 0 ? t("today") : t("dayN", { n: p.day })}</div>
                    <div className="mt-1 text-xs text-charcoal-500">{t("price")} {inr(p.price_per_kg)}/kg · {t("qualityAt")} {Math.round(p.quality)}%</div>
                    <div className="num mt-1 text-lg font-extrabold text-forest">{inr(p.net)}</div>
                    {!p.recommended && <div className="text-[10px] text-charcoal-400">{inr(p.diff_vs_recommended)}</div>}
                  </button>
                ))}
              </div>
              <div className="mt-2 text-[11px] text-charcoal-400">{t("simulated")}{detailed ? ` ${shift.price_method}` : ""}</div>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
