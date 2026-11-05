import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { api, post } from "../lib/api";
import { PRODUCE_EMOJI, when } from "../lib/format";
import { useSelection } from "../stores/live";
import { Badge, Card, cn, ErrorBox, Loading, Note, PageHeader, Segmented, Spinner } from "../components/ui";

const CLASS_TONE: Record<string, string> = { experimental: "green", operating_range: "green", derived: "blue", calibrated: "amber", assumption: "amber", demo: "red" };
const STATUS_TONE: Record<string, string> = { ok: "green", demo: "blue", preview: "blue", unavailable: "grey" };

function Validation() {
  const qc = useQueryClient();
  const { batchId } = useSelection();
  const { data } = useQuery({ queryKey: ["validation"], queryFn: () => api("/validation") });
  const [q, setQ] = useState<number | "">("");
  const [s, setS] = useState<number | "">("");
  const m = useMutation({ mutationFn: () => post("/validation", { batch_id: batchId, observed_quality: q === "" ? null : q, observed_shelf_life: s === "" ? null : s }), onSuccess: () => qc.invalidateQueries({ queryKey: ["validation"] }) });
  return (
    <Card title="Validation records" subtitle="Enter an observed outcome for a batch later; MAE, RMSE and bias are computed only from real records.">
      {data?.message && <div className="rounded-lg bg-cream-100 px-3 py-4 text-center text-sm font-medium text-charcoal-500">{data.message}</div>}
      {data?.metrics && Object.keys(data.metrics).length > 0 && (
        <div className="mb-3 grid gap-2 sm:grid-cols-3">
          {Object.entries(data.metrics).map(([prod, mm]: any) => Object.entries(mm).map(([k, v]: any) => (
            <div key={prod + k} className="rounded-lg border border-cream-200 p-2 text-xs"><div className="font-semibold text-forest">{PRODUCE_EMOJI[prod]} {prod} · {k}</div>n={v.n} · MAE {v.mae} · RMSE {v.rmse} · bias {v.bias}</div>
          )))}
        </div>
      )}
      {data?.records?.length > 0 && (
        <table className="mb-3 w-full text-xs"><thead><tr className="[&>th]:label [&>th]:py-1 [&>th]:text-left"><th>Batch</th><th>Pred. Q</th><th>Obs. Q</th><th>Pred. SL</th><th>Obs. SL</th><th>When</th></tr></thead>
          <tbody>{data.records.map((r: any) => <tr key={r.id} className="border-t border-cream-100 [&>td]:py-1"><td className="font-mono">{r.batch_id}</td><td>{r.predicted_quality ?? "—"}</td><td>{r.observed_quality ?? "—"}</td><td>{r.predicted_shelf_life ?? "—"}</td><td>{r.observed_shelf_life ?? "—"}</td><td>{when(r.observed_at)}</td></tr>)}</tbody></table>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="text-xs text-charcoal-500">For <b className="font-mono">{batchId}</b>:</div>
        <label className="text-xs">Observed quality<input className="input mt-0.5 w-28 py-1" type="number" value={q} onChange={(e) => setQ(e.target.value === "" ? "" : Number(e.target.value))} /></label>
        <label className="text-xs">Observed shelf life (d)<input className="input mt-0.5 w-28 py-1" type="number" value={s} onChange={(e) => setS(e.target.value === "" ? "" : Number(e.target.value))} /></label>
        <button className="btn-secondary text-xs" onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending ? <Spinner className="h-3 w-3" /> : "Record outcome"}</button>
      </div>
      <div className="mt-2"><ErrorBox error={m.error} /></div>
    </Card>
  );
}

export default function Settings() {
  const qc = useQueryClient();
  const { data: integ } = useQuery({ queryKey: ["integrations"], queryFn: () => api("/integrations") });
  const { data: reg } = useQuery({ queryKey: ["parameters"], queryFn: () => api("/parameters") });
  const [prod, setProd] = useState("tomato");
  const mode = useMutation({ mutationFn: (m: string) => post("/mode", { mode: m }), onSuccess: () => qc.invalidateQueries() });
  const p = reg?.produce?.find((x: any) => x.produce === prod);
  return (
    <div className="space-y-6">
      <PageHeader kicker="Settings" title="Mode, integrations and science" subtitle="DEMO MODE works with no keys and no internet (map tiles excepted). REAL MODE activates whatever is configured and shows what is unavailable." />
      <Card title="Mode" action={<Segmented value={integ?.mode || "demo"} onChange={(v) => mode.mutate(v)} options={[{ value: "demo", label: "DEMO" }, { value: "real", label: "REAL" }]} />}>
        {mode.isPending && <div className="mb-2 flex items-center gap-2 text-xs text-charcoal-400"><Spinner className="h-3 w-3" /> checking providers…</div>}
        {!integ ? <Loading /> : (
          <div className="grid gap-2 md:grid-cols-2">
            {integ.integrations.map((i: any) => (
              <div key={i.name} className="flex items-start justify-between gap-3 rounded-lg border border-cream-200 px-3 py-2">
                <div><div className="text-sm font-semibold capitalize text-forest">{i.name.replace("_", " ")}</div><div className="text-xs text-charcoal-500">{i.provider} · {i.detail}</div></div>
                <Badge tone={STATUS_TONE[i.status]}>{i.status}</Badge>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3"><Note>Keys live only in the backend .env and are never sent to the browser. Needed for REAL MODE: DATA_GOV_API_KEY (Agmarknet), GROQ_API_KEY (agentic workflow), TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (live alerts). Open-Meteo and OSRM need no key.</Note></div>
      </Card>
      <Card title="Scientific parameter registry" subtitle={reg?.calibration_note} action={<Segmented value={prod} onChange={setProd} options={["tomato", "mango", "banana"].map((x) => ({ value: x, label: `${PRODUCE_EMOJI[x]} ${x}` }))} />}>
        {!p ? <Loading /> : (
          <>
            <div className="mb-3 text-xs text-charcoal-500">Version {p.version} · reviewed {p.last_reviewed} · mean parameter-quality score {p.parameter_quality} · full audit in <code>docs/parameter_audit.md</code></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-xs">
                <thead><tr className="[&>th]:label [&>th]:px-2 [&>th]:py-2 [&>th]:text-left"><th>Parameter</th><th>Value</th><th>Classification</th><th>Conditions</th><th>Derivation / limitations</th><th>Source</th></tr></thead>
                <tbody>
                  {p.params.map((x: any) => (
                    <tr key={x.id} className="border-t border-cream-100 align-top [&>td]:px-2 [&>td]:py-2">
                      <td className="font-medium text-forest">{x.name}<div className="font-mono text-[10px] text-charcoal-300">{x.id}</div></td>
                      <td className="num whitespace-nowrap">{x.value} {x.unit}{x.range && <div className="text-[10px] text-charcoal-400">range {x.range[0].toFixed?.(3) ?? x.range[0]}–{x.range[1].toFixed?.(3) ?? x.range[1]}</div>}</td>
                      <td><Badge tone={CLASS_TONE[x.classification]}>{x.classification_label}</Badge></td>
                      <td className="max-w-[220px] text-charcoal-500">{x.conditions}</td>
                      <td className={cn("max-w-[260px] text-charcoal-500")}>{x.derivation && <div className="font-mono text-[10px]">{x.derivation}</div>}{x.limitations}</td>
                      <td>{x.source?.url ? <a href={x.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-leaf-600 hover:underline">{x.source.publisher.split(";")[0]} ({x.source.year}) <ExternalLink className="h-3 w-3" /></a> : <span className="text-charcoal-300">none</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
      <Validation />
    </div>
  );
}
