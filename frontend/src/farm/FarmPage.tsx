import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { BarChart3, Home, RotateCcw, Snowflake, Truck, Warehouse, X } from "lucide-react";
import { api, post } from "../lib/api";
import { clock } from "../lib/format";
import { useLang, useT } from "../lib/i18n";
import { useLive } from "../stores/live";
import { useUI, type Place } from "../stores/ui";
import { cn, Spinner } from "../components/ui";
import { FarmScene } from "./FarmScene";
import { BatchPanel } from "./BatchPanel";
import { TruckPanel } from "./TruckPanel";
import { DecideSheet } from "./DecideSheet";
import { MitraPanel } from "../mitra/MitraPanel";

function Toggle({ on, onChange, label }: { on: boolean; onChange: (b: boolean) => void; label: string }) {
  return (
    <button onClick={() => onChange(!on)} className="flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-xs font-bold text-forest shadow">
      <span className={cn("relative h-5 w-9 rounded-full transition-colors", on ? "bg-forest" : "bg-cream-200")}>
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
      </span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function TopBar({ data }: { data: any }) {
  const { t } = useT();
  const { lang, setLang } = useLang();
  const detailed = useUI((s) => s.detailed);
  const setDetailed = useUI((s) => s.setDetailed);
  const simNow = useLive((s) => s.simNow);
  const qc = useQueryClient();
  const reset = useMutation({ mutationFn: () => post("/demo/reset"), onSuccess: () => { useUI.getState().setFocus("yard"); qc.invalidateQueries(); } });
  const scenario = useMutation({ mutationFn: (n: number) => post(`/demo/scenario/${n}`), onSuccess: (d: any) => {
    qc.invalidateQueries();
    const focus = d.scenario === 1 ? "shed" : d.scenario === 2 ? "truck" : "cold";
    const id = d.batch_id;
    setTimeout(() => useUI.getState().setFocus(focus as Place, id), 400);
  } });
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-start justify-between gap-2 p-3">
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-white/90 px-3 py-2 shadow backdrop-blur">
        <svg viewBox="0 0 64 64" className="h-9 w-9"><rect width="64" height="64" rx="14" fill="#1F4D3A" /><circle cx="32" cy="35" r="16" fill="#F7F3E8" /><path d="M32 19c2-6 8-8 12-7-1 5-5 9-12 7z" fill="#3E8E5A" /><circle cx="32" cy="35" r="6" fill="#1F4D3A" /></svg>
        <div className="leading-tight">
          <div className="font-display text-lg font-semibold text-forest">ZERO ROT</div>
          <div className="text-[11px] text-charcoal-500">{data?.farmer?.name} · {lang === "kn" ? data?.farmer?.district_kn : data?.farmer?.district}</div>
        </div>
        <div className="hidden border-l border-cream-200 pl-3 text-[11px] text-charcoal-400 md:block">{clock(simNow || data?.sim_now)}</div>
      </div>
      <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-2">
        <div className="flex rounded-full bg-white/90 p-1 shadow">
          {(["en", "kn"] as const).map((l) => (
            <button key={l} onClick={() => setLang(l)} className={cn("rounded-full px-3 py-1 text-sm font-bold", lang === l ? "bg-forest text-cream-50" : "text-forest")}>{l === "en" ? "English" : "ಕನ್ನಡ"}</button>
          ))}
        </div>
        <Toggle on={detailed} onChange={setDetailed} label={t("detailed")} />
        {detailed && (
          <>
            <select onChange={(e) => { if (e.target.value) scenario.mutate(Number(e.target.value)); e.target.value = ""; }} defaultValue=""
              className="rounded-full bg-white/90 px-3 py-1.5 text-xs font-bold text-forest shadow">
              <option value="">{t("scenario")}…</option><option value="1">1 · {t("shed")}</option><option value="2">2 · {t("truck")}</option><option value="3">3 · {t("cold")}</option>
            </select>
            <Link to="/ops" className="flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs font-bold text-forest shadow"><BarChart3 className="h-4 w-4" />{t("analytics")}</Link>
          </>
        )}
        <button onClick={() => reset.mutate()} className="flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs font-bold text-forest shadow">
          {reset.isPending ? <Spinner className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}<span className="hidden sm:inline">{t("reset")}</span>
        </button>
      </div>
    </div>
  );
}

function PlaceBar({ focus, onPick, data, compact }: { focus: Place; onPick: (p: Place) => void; data: any; compact?: boolean }) {
  const { t } = useT();
  const items: [Place, string, any][] = [["yard", t("myFarm"), Home], ["shed", t("shed"), Warehouse], ["cold", t("cold"), Snowflake], ["truck", t("truck"), Truck]];
  const failed = data?.truck?.reefer_status === "failed";
  return (
    <div className="pointer-events-auto flex gap-1.5 rounded-full bg-white/95 p-1.5 shadow-lg">
      {items.map(([p, label, I]) => (
        <button key={p} onClick={() => onPick(p)}
          className={cn("relative flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-bold transition-colors sm:px-4", focus === p ? "bg-forest text-cream-50" : "text-forest hover:bg-forest-50")}>
          <I className="h-4 w-4" /><span className={compact ? "hidden xl:inline" : "hidden sm:inline"}>{label}</span>
          {p === "truck" && failed && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 animate-ping rounded-full bg-rot" />}
        </button>
      ))}
    </div>
  );
}

export default function FarmPage() {
  const { t, produce } = useT();
  const [sp] = useSearchParams();
  const qc = useQueryClient();
  const { focus, batchId, setFocus } = useUI();
  const futureIdx = useUI((s) => s.futureIdx);
  const version = useLive((s) => s.version);
  const { data } = useQuery({ queryKey: ["farm", version], queryFn: () => api("/farm"), refetchInterval: 6000, placeholderData: (p) => p });
  const deciding = useUI((s) => s.decideId);
  const setDeciding = useUI((s) => s.openDecide);
  useEffect(() => { const f = sp.get("focus") as Place | null; if (f) setFocus(f); }, [sp, setFocus]);
  const cards = useMemo(() => [...(data?.places?.shed || []), ...(data?.places?.cold || []), ...(data?.places?.truck || [])], [data]);
  const byPlace = (p: Place) => (p === "yard" ? null : (data?.places?.[p] || [])[0]);
  const pick = (p: Place, id?: string | null) => setFocus(p, id ?? byPlace(p)?.id ?? null);
  const card = cards.find((c: any) => c.id === batchId) || (focus !== "yard" ? byPlace(focus) : null);
  const futureQ: Record<string, number> = {};
  if (card && futureIdx > 0) futureQ[card.id] = card.future[Math.min(futureIdx, card.future.length - 1)].quality;
  // keyboard F: simulate a breakdown on the mandi truck (demo)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.key === "f" || e.key === "F") && !(e.target as HTMLElement)?.closest("input,textarea,select") && data?.truck?.state === "on_road" && data.truck.reefer_status === "ok") {
        post("/trips/TRIP-S2/inject-failure").then(() => qc.invalidateQueries({ queryKey: ["farm"] }));
        setFocus("truck", data.places.truck[0]?.id);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [data, qc, setFocus]);

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-[#DDEBD6]">
      {data ? <FarmScene data={data} onPick={pick} selectedFuture={futureQ} /> : <div className="grid h-full place-items-center text-forest"><Spinner className="h-8 w-8" /></div>}
      <TopBar data={data} />
      <div className={cn("pointer-events-none absolute inset-x-0 bottom-4 z-20 flex flex-col items-center gap-2 px-3 transition-[padding]", card && focus !== "yard" && "sm:pr-[440px]")}>
        {focus === "yard" && <div className="rounded-full bg-black/45 px-4 py-1.5 text-center text-sm font-semibold text-white">{t("tapPlace")}</div>}
        <PlaceBar focus={focus} onPick={(p) => pick(p)} data={data} compact={!!card && focus !== "yard"} />
        <div className="text-[10px] text-forest/70">{t("simulated")}</div>
      </div>
      <AnimatePresence>
        {card && focus !== "yard" && (
          <motion.aside key={card.id} initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
            className="absolute bottom-24 left-3 right-3 top-auto z-30 max-h-[62vh] overflow-y-auto rounded-3xl bg-cream-50/95 p-4 shadow-2xl backdrop-blur sm:bottom-auto sm:left-auto sm:right-3 sm:top-20 sm:max-h-[calc(100dvh-7rem)] sm:w-[420px]">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wide text-charcoal-400">{t("inside")} · {t(focus === "truck" ? "truck" : focus)}</div>
              <button onClick={() => setFocus("yard")} className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-forest shadow-sm" aria-label={t("backToFarm")}>
                <X className="h-3.5 w-3.5" />{t("backToFarm")}
              </button>
            </div>
            <BatchPanel card={card} onChoices={() => setDeciding(card.id)}>
              {card.place === "truck" && data?.truck && <TruckPanel truck={data.truck} card={card} />}
            </BatchPanel>
            <div className="mt-3 text-center text-[10px] text-charcoal-300">{produce(card.produce)} · {card.id} · SIMULATED</div>
          </motion.aside>
        )}
      </AnimatePresence>
      <AnimatePresence>{deciding && <DecideSheet batchId={deciding} onClose={() => setDeciding(null)} />}</AnimatePresence>
      <MitraPanel />
    </div>
  );
}
