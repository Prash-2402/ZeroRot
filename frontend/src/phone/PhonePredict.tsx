import { ChoiceBar } from "./PhoneExtras";
import { SellPlanner, SpoilageSlider } from "./PhoneSliders";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, post } from "../lib/api";
import { days, inr, kg, num } from "../lib/format";
import { ErrorBox, Spinner, cn } from "../components/ui";
import { useT } from "./i18n";

function Seg({ value, onChange, items }: { value: string; onChange: (v: string) => void; items: [string, string][] }) {
  return (
    <div className="grid border border-paper-300" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
      {items.map(([v, l]) => <button key={v} onClick={() => onChange(v)} className={cn("py-2.5 text-xs font-bold", value === v ? "bg-teal text-white" : "text-ink-400")}>{l}</button>)}
    </div>
  );
}

function Rates({ lot }: { lot: any }) {
  const rates = useQuery({ queryKey: ["ph-rates", lot.id], queryFn: () => api(`/flow/lots/${lot.id}/rates`, { mobile: true }) });
  const towns = useQuery({ queryKey: ["ph-towns", lot.location.lat, lot.location.lng], queryFn: () => api(`/flow/market-towns?lat=${lot.location.lat}&lng=${lot.location.lng}`, { mobile: true }), staleTime: 3600000 });
  if (rates.isLoading) return <Spinner />;
  if (rates.error) return <ErrorBox error={rates.error} />;
  const d = rates.data;
  return (
    <div className="space-y-3">
      {d.status !== "ok" ? (
        <div className="border border-critical/60 bg-critical/10 p-3 text-sm">
          <div className="font-bold text-critical">DATA UNAVAILABLE</div>
          <div className="mt-1 text-xs text-ink-400">{d.message}</div>
        </div>
      ) : (
        <div className="divide-y divide-paper-300 border border-paper-300">
          {d.markets.map((m: any) => (
            <div key={m.market} className="flex items-center justify-between p-3">
              <div><div className="font-bold">{m.market}</div><div className="text-[11px] text-ink-400">{m.distance_km != null ? (m.distance_basis === "district" ? `~${m.distance_km} km (district)` : `${m.distance_km} km`) : "distance unknown"} · {m.date}{m.age_days > 3 ? ` (${m.age_days} d old)` : ""}</div></div>
              <div className="text-right"><div className="font-mono text-xl font-bold text-gold">{inr(m.modal_per_kg)}<span className="text-xs text-ink-400">/kg</span></div><div className="text-[10px] text-ink-400">{m.min_per_kg}–{m.max_per_kg}</div></div>
            </div>
          ))}
        </div>
      )}
      <div>
        <div className="ph-label">Nearest APMC market towns</div>
        {towns.isLoading ? <Spinner /> : (
          <div className="grid grid-cols-2 gap-2">
            {(towns.data?.towns || []).slice(0, 6).map((t: any) => <div key={t.name} className="border border-paper-300 p-2 text-xs"><b>{t.town}</b><div className="text-ink-400">{t.distance_km} km away</div></div>)}
          </div>
        )}
      </div>
    </div>
  );
}

function Spoilage({ lot }: { lot: any }) {
  const t = useT();
  const q = useQuery({ queryKey: ["ph-spoil", lot.id, Math.floor((lot.storage?.t_seconds || 0) / 3600)], queryFn: () => api(`/flow/lots/${lot.id}/spoilage`, { mobile: true }) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  const bar = (v: number | null, max: number, color: string) => <div className="h-3 bg-paper-200"><div className="h-3" style={{ width: `${Math.min(100, ((v ?? max) / max) * 100)}%`, background: color }} /></div>;
  const max = Math.max(d.current.shelf_life_p90 || 1, d.at_recommended.shelf_life_p90 || 1, 1);
  return (
    <div className="space-y-4">
      <div className="border border-paper-300 p-4 text-center">
        <div className="text-xs uppercase tracking-wider text-ink-400">At current conditions ({num(d.conditions.temperature_c)} °C, {num(d.conditions.rh_pct, 0)}%)</div>
        <div className="mt-1 font-mono text-5xl font-bold text-gold">{days(d.current.shelf_life_days)}</div>
        <div className="text-xs text-ink-400">{t("days left")} · likely range {days(d.current.shelf_life_p10)} – {days(d.current.shelf_life_p90)}</div>
        <div className="mt-3">{bar(d.current.shelf_life_days, max, "#FF684A")}</div>
      </div>
      <div className="border border-paper-300 p-4">
        <div className="text-xs uppercase tracking-wider text-ink-400">If kept at the recommended {num(d.at_recommended.temperature_c)} °C / {num(d.at_recommended.rh_pct, 0)}%</div>
        <div className="mt-1 font-mono text-3xl font-bold text-coldlight">{days(d.at_recommended.shelf_life_days)}</div>
        <div className="mt-2">{bar(d.at_recommended.shelf_life_days, max, "#7FC4FF")}</div>
      </div>
      <SpoilageSlider curves={d.curves} horizon={d.horizon_days} qMin={d.q_min} />
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="border border-paper-300 p-2"><div className="font-mono text-xl font-bold">{num(d.quality, 0)}</div>quality now</div>
        <div className="border border-paper-300 p-2"><div className="font-mono text-xl font-bold">{kg(d.saleable_kg)}</div>saleable</div>
        <div className="border border-paper-300 p-2"><div className="font-mono text-xl font-bold">{num(d.current.spoilage_probability * 100, 0)}%</div>spoilage risk</div>
      </div>
      <div className="text-[10px] text-ink-400">{d.label}</div>
    </div>
  );
}

function Decide({ lot, onDispatched }: { lot: any; onDispatched: () => void }) {
  const t = useT();
  const [price, setPrice] = useState("");
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<any>(null);
  const [explain, setExplain] = useState<any>(null);
  const [dest, setDest] = useState<any>(null);
  const [grade, setGrade] = useState<string>("A1");
  const towns = useQuery({ queryKey: ["ph-towns", lot.location.lat, lot.location.lng], queryFn: () => api(`/flow/market-towns?lat=${lot.location.lat}&lng=${lot.location.lng}`, { mobile: true }), staleTime: 3600000 });
  const run = async (p?: string) => {
    setBusy("decide"); setError(null); setExplain(null);
    try { setD(await api(`/flow/lots/${lot.id}/decision${p ? `?price_per_kg=${p}` : ""}`, { mobile: true })); } catch (e) { setError(e); } finally { setBusy(null); }
  };
  useEffect(() => { run(); }, [lot.id]);   // try with verified prices first
  const ask = async () => {
    setBusy("explain");
    try { setExplain(await post("/flow/chat", { lot_id: lot.id, message: "Explain the selling decision and when and where I should sell, using the decision numbers.", language: localStorage.getItem("zr-lang") || "en" }, true)); }
    catch (e) { setExplain({ error: e }); } finally { setBusy(null); }
  };
  const dispatch = async () => {
    setBusy("dispatch"); setError(null);
    try {
      await post(`/flow/lots/${lot.id}/dispatch`, { grade: lot.stage === "graded" ? grade : "ALL", destination_name: dest.name, lat: dest.lat, lng: dest.lng,
        plan: sortFirst ? plan : undefined }, true);
      onDispatched();
    } catch (e) { setError(e); } finally { setBusy(null); }
  };
  const graded = lot.stage === "graded";
  const shipped = new Set((lot.shipments || []).map((s: any) => s.grade));
  const canSell = ["storage", "graded"].includes(lot.stage);
  const destinations = d?.market?.lat ? [{ name: d.market.market, lat: d.market.lat, lng: d.market.lng, distance_km: d.market.distance_km }] : [];
  const sortFirst = lot.mode === "advanced" && lot.stage === "storage";
  const local = (towns.data?.towns || []).find((x: any) => x.name !== dest?.name);
  const plan = dest ? { A1: dest, A2: dest, A3: local ? { name: local.name, lat: local.lat, lng: local.lng } : dest } : null;
  const allDest = [...destinations, ...(towns.data?.towns || []).map((x: any) => ({ name: x.name, lat: x.lat, lng: x.lng, distance_km: x.distance_km }))].slice(0, 8);
  return (
    <div className="space-y-4">
      {error?.status === 409 || (!d && !busy) ? (
        <div className="space-y-2">
          {error?.status === 409 && <div className="text-xs text-ink-400">{error.message}</div>}
          <div className="flex gap-2">
            <input className="ph-input flex-1" inputMode="decimal" placeholder={t("Price you were quoted (₹/kg)")} value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} />
            <button className="bg-gold px-4 font-bold text-ink disabled:opacity-40" disabled={!price || busy === "decide"} onClick={() => run(price)}>{busy === "decide" ? <Spinner /> : t("Get decision")}</button>
          </div>
        </div>
      ) : error ? <ErrorBox error={error} /> : null}
      {busy === "decide" && !d && <Spinner />}
      {d && (
        <>
          <div className={cn("p-4", d.recommendation === "sell_now" ? "bg-gold text-ink" : d.recommendation === "discard" ? "bg-ink text-white" : "bg-coldlight text-ink")}>
            <div className="text-[11px] font-bold uppercase tracking-wider opacity-70">Advice · you decide below</div>
            <div className="font-display text-3xl font-black">{d.recommendation === "sell_now" ? t("Sell now") : d.recommendation === "discard" ? "Discard or process" : `${t("Store and sell later")} · day ${d.best_day}`}</div>
            {d.why && <div className="mt-1 text-sm font-semibold">{d.why}</div>}
            {d.salvage && <ul className="mt-1 list-disc pl-4 text-xs opacity-90">{d.salvage.map((x: string) => <li key={x}>{x}</li>)}</ul>}
            <div className="mt-1 text-sm">Net today {inr(d.sell_now.net_profit)}{d.recommendation === "store_and_sell_later" ? ` · on day ${d.best_day} ${inr(d.best.net_profit)} (+${inr(d.gain_vs_now)})` : ""}</div>
            <div className="mt-1 text-[11px] opacity-70">Price {inr(d.price_per_kg)}/kg · {d.price_origin}</div>
          </div>
          <SellPlanner d={d} />
          {d.per_grade && (
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              {Object.entries(d.per_grade).map(([g, v]: any) => <div key={g} className="border border-paper-300 p-2"><div className="font-bold text-gold">{g}</div>{kg(v.kg)}<div>{inr(v.price_per_kg)}/kg</div></div>)}
            </div>
          )}
          <details className="text-xs text-ink-400"><summary className="cursor-pointer font-bold text-ink">Assumptions</summary><ul className="mt-1 list-disc pl-4">{d.assumptions.map((a: string, i: number) => <li key={i}>{a}</li>)}</ul></details>
          <button className="ph-btn-line w-full" onClick={ask} disabled={busy === "explain"}>{busy === "explain" ? <Spinner /> : "Explain this (AI)"}</button>
          {explain?.answer && <div className="whitespace-pre-line border-l-4 border-gold bg-white p-3 text-sm">{explain.answer}{!explain.verified && <div className="mt-1 text-[11px] text-gold">Check the numbers above; the explanation mentioned some not in the model output.</div>}</div>}
          {explain?.error && <ErrorBox error={explain.error} />}
        </>
      )}
      <ChoiceBar lot={lot} recommendation={d?.recommendation} onSell={() => document.getElementById("ph-sell")?.scrollIntoView({ behavior: "smooth" })} />
      <div id="ph-sell" className="border-t border-paper-300 pt-4">
        <div className="ph-label">{t("Sell")} → {t("Destination")}</div>
        {!canSell ? <div className="text-sm text-ink-400">{lot.stage === "grading" ? "Sorting in progress; trucks leave when it finishes." : lot.stage === "intake" ? "Wait until loading finishes." : "Already dispatched."}</div> : (
          <div className="space-y-2">
            {graded && (
              <div className="grid grid-cols-3 gap-2">
                {["A1", "A2", "A3"].map((g) => {
                  const kgv = lot.grading.kg[g];
                  return <button key={g} disabled={shipped.has(g) || kgv <= 0} onClick={() => setGrade(g)} className={cn("border-2 p-2 text-xs disabled:opacity-30", grade === g ? "border-teal bg-teal/10" : "border-paper-300")}>
                    <div className="font-bold">{g}</div>{lot.grading.bags[g]} boxes<div className="text-ink-400">{shipped.has(g) ? "sent" : kg(kgv)}</div></button>;
                })}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {allDest.map((x: any) => <button key={x.name} onClick={() => setDest(x)} className={cn("border-2 p-2 text-left text-xs", dest?.name === x.name ? "border-teal bg-teal/10" : "border-paper-300")}><b>{x.name}</b><div className="text-ink-400">{x.distance_km} km</div></button>)}
            </div>
            {graded && <div className="text-[11px] text-ink-400">Tip: A1 to the highest-price mandi, A2 to a standard market, A3 to local low-budget outlets.</div>}
            {sortFirst && plan && (
              <div className="rounded-2xl border border-teal/30 bg-teal/5 p-3 text-xs">
                <div className="mb-1 font-bold text-teal">Scanned and sorted first, then each grade ships:</div>
                {(["A1", "A2", "A3"] as const).map((g) => <div key={g}><b>{g}</b> → {(plan as any)[g].name}</div>)}
              </div>
            )}
            <button className="w-full bg-gold py-4 text-lg font-bold text-ink disabled:opacity-40" disabled={!dest || busy === "dispatch" || (graded && shipped.has(grade))} onClick={dispatch}>
              {busy === "dispatch" ? <Spinner /> : sortFirst ? "Scan, sort & dispatch" : `${t("Dispatch")} ${graded ? grade : ""} → ${dest?.name || "…"}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function PredictTab({ lot, onDispatched }: { lot: any; onDispatched: () => void }) {
  const t = useT();
  const [sec, setSec] = useState("decision");
  return (
    <div className="space-y-4 p-4 pb-28">
      <Seg value={sec} onChange={setSec} items={[["rates", t("Mandi rates")], ["spoilage", t("Spoilage")], ["decision", t("Decision")]]} />
      {sec === "rates" ? <Rates lot={lot} /> : sec === "spoilage" ? (lot.storage ? <Spoilage lot={lot} /> : null) : <Decide lot={lot} onDispatched={onDispatched} />}
    </div>
  );
}
