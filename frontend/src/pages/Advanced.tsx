import { lazy, Suspense, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { api, ApiError, post, API } from "../lib/api";
import { useAuth } from "../stores/auth";
import { days, inr, kg, num } from "../lib/format";
import { Empty, ErrorBox, Field, Metric, Note, PageHead, Panel, Spinner, cn } from "../components/ui";
import { BatchSelect, useBatches, useCommodities } from "../components/shared";

const ConveyorLine = lazy(() => import("../three/Conveyor").then((m) => ({ default: m.ConveyorLine })));
const CAT: Record<string, [string, string]> = { good: ["Good", "#5FB37C"], damaged: ["Moderately damaged", "#F2994A"], rejected: ["Spoiled / rejected", "#EB4D3D"], uncertain: ["Uncertain — manual check", "#8A9099"] };

async function upload(form: FormData) {
  const res = await fetch(`${API}/inspections`, { method: "POST", body: form, headers: { Authorization: `Bearer ${useAuth.getState().token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.detail?.message || data?.detail || "Inspection failed", data?.detail);
  return data;
}

function ImageResult({ file, img }: { file?: File; img: any }) {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  if (!url) return null;
  return (
    <div className="border border-paper-300 bg-white">
      <div className="relative">
        <img src={url} alt={img.image_name} className="block w-full" />
        <svg viewBox={`0 0 ${img.width} ${img.height}`} className="absolute inset-0 h-full w-full">
          {img.objects.map((o: any, i: number) => (
            <g key={i}>
              <rect x={o.bbox[0]} y={o.bbox[1]} width={o.bbox[2]} height={o.bbox[3]} fill="none" stroke={CAT[o.category][1]} strokeWidth={Math.max(2, img.width / 200)} />
              <text x={o.bbox[0] + 4} y={o.bbox[1] + Math.max(14, img.width / 40)} fill={CAT[o.category][1]} fontSize={Math.max(12, img.width / 40)} fontWeight="bold" stroke="#08090B" strokeWidth={0.6}>{o.category} {Math.round(o.confidence * 100)}%</text>
            </g>
          ))}
        </svg>
      </div>
      <div className="p-2 text-[11px]"><b>{img.image_name}</b> · {img.objects.length} objects{img.note && <div className="text-abnormal">{img.note}</div>}</div>
    </div>
  );
}

function Allocation({ batchId }: { batchId: number }) {
  const qc = useQueryClient();
  const [daysPlanned, setDays] = useState(7);
  const rec = useMutation({ mutationFn: () => post("/storage/allocations/recommend", { batch_id: batchId, planned_days: daysPlanned }) });
  const alloc = useMutation({ mutationFn: (zone_id: number) => post("/storage/allocations", { batch_id: batchId, planned_days: daysPlanned, zone_id }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["batches"] }); qc.invalidateQueries({ queryKey: ["facilities"] }); qc.invalidateQueries({ queryKey: ["allocations"] }); } });
  return (
    <Panel title="Intelligent cold-storage allocation" sub="Zones are checked for free capacity, temperature range and compatibility with what is already stored (setpoint and ethylene).">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Planned storage (days)"><input className="input w-32" type="number" min={1} max={60} value={daysPlanned} onChange={(e) => setDays(Number(e.target.value))} /></Field>
        <button className="btn-ink" onClick={() => rec.mutate()} disabled={rec.isPending}>{rec.isPending ? <Spinner /> : "Recommend zone"}</button>
      </div>
      <ErrorBox error={rec.error} />
      {rec.data && (
        <div className="mt-3 space-y-2">
          {rec.data.message && <Note tone="warn">{rec.data.message} <Link className="underline" to="/app/cold-storage">Add a facility or zone</Link></Note>}
          {rec.data.options.map((o: any, i: number) => (
            <div key={o.zone_id} className={cn("border p-3 text-sm", i === 0 ? "border-gold bg-gold-50" : "border-paper-300 bg-white")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold">{i === 0 && <span className="chip mr-2 bg-gold text-ink">RECOMMENDED</span>}{o.zone}</div>
                <button className="btn-gold py-1 text-xs" onClick={() => alloc.mutate(o.zone_id)} disabled={alloc.isPending}>Allocate {kg(o.allocation_kg)}</button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
                <div><span className="label">Setpoint </span>{o.setpoint_c} °C / {num(o.rh_setpoint_pct, 0)}%</div>
                <div><span className="label">Shelf life </span>{days(o.expected_shelf_life_days)} ({days(o.shelf_life_p10)}–{days(o.shelf_life_p90)})</div>
                <div><span className="label">Spoilage risk </span>{num(o.spoilage_probability * 100, 0)}%</div>
                <div><span className="label">Cost </span>{inr(o.estimated_cost)}</div>
                <div><span className="label">Fill after </span>{o.fill_after_pct}%</div>
              </div>
              <div className="mt-1 text-[11px] text-ink-400">{o.reason}</div>
            </div>
          ))}
          {rec.data.rejected.length > 0 && (
            <div className="text-xs"><div className="label mb-1">Not suitable</div>{rec.data.rejected.map((r: any) => <div key={r.zone_id} className="text-ink-400">✕ {r.zone}: {r.reason}</div>)}</div>
          )}
        </div>
      )}
      <ErrorBox error={alloc.error} />
      {alloc.data && <Note>Allocated to {alloc.data.allocation.zone} at {alloc.data.allocation.setpoint_c} °C. <Link className="font-semibold underline" to="/app/cold-storage">Open cold-storage twin →</Link></Note>}
    </Panel>
  );
}

export default function Advanced() {
  const qc = useQueryClient();
  const comms = useCommodities();
  const batches = useBatches();
  const model = useQuery({ queryKey: ["cv-model"], queryFn: () => api("/inspections/model") });
  const [batch, setBatch] = useState<number | "">("");
  const [commodity, setCommodity] = useState("tomato");
  const [sample, setSample] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const b = (batches.data?.batches || []).find((x: any) => x.id === batch);
  const m = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("commodity_id", b?.commodity_id || commodity);
      if (batch) fd.append("batch_id", String(batch));
      if (sample) fd.append("sample_kg", sample);
      files.forEach((f) => fd.append("files", f));
      return upload(fd);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["batches"] }),
  });
  const s = m.data?.summary;
  const objects = (m.data?.images || []).flatMap((i: any) => i.objects);
  return (
    <div className="space-y-4">
      <PageHead kicker="Module 3" title="Advanced Storage · Inspection & Sorting" sub="Upload photos of the produce. Each visible item is segmented and classified; the sorting line below replays exactly those results." />
      <Note tone="warn">Method: {model.data?.method === "onnx_model" ? "trained ONNX model" : "classical OpenCV colour/texture analysis"}. {model.data?.message || ""} Results describe only the photographed items; batch figures are extrapolated estimates.</Note>
      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <Panel title="Inspect a sample">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
            <Field label="Batch (optional)"><BatchSelect value={batch} onChange={setBatch} /></Field>
            {!b && <Field label="Commodity"><select className="input" value={commodity} onChange={(e) => setCommodity(e.target.value)}>{(comms.data?.commodities || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
            <Field label="Sample weight (kg)" hint="Weight of the photographed items, for the batch estimate"><input className="input" type="number" step="0.1" min={0} value={sample} onChange={(e) => setSample(e.target.value)} /></Field>
            <label className="flex cursor-pointer flex-col items-center gap-2 border-2 border-dashed border-paper-400 bg-paper-50 p-6 text-center text-sm hover:border-gold">
              <Upload className="h-6 w-6" />{files.length ? `${files.length} image(s) selected` : "Choose up to 20 JPG/PNG photos"}
              <span className="text-[11px] text-ink-400">Plain, contrasting background; items not touching works best.</span>
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, 20))} />
            </label>
            <ErrorBox error={m.error} />
            <button className="btn-gold w-full" disabled={!files.length || m.isPending}>{m.isPending ? <Spinner /> : "Run inspection"}</button>
          </form>
        </Panel>
        <div className="space-y-4">
          <div className="overflow-hidden border border-ink-600">
            <Suspense fallback={<div className="h-[460px] bg-ink" />}>
              <ConveyorLine objects={objects} commodity={b?.commodity_id || commodity} running={objects.length > 0} />
            </Suspense>
          </div>
          {!s && <Empty title="No inspection yet">Results, bounding boxes and the sorting animation appear after the backend analyses your photos.</Empty>}
          {s && (
            <Panel title="Inspection report" sub={m.data.label}>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                <Metric label="Objects detected" value={s.objects_detected} sub={`${s.classified_objects} classified`} />
                {(["good", "damaged", "rejected", "uncertain"] as const).map((k) => <Metric key={k} label={CAT[k][0]} value={s.counts[k]} tone={CAT[k][1]} sub={k !== "uncertain" && s.shares_of_classified[k] != null ? `${num(s.shares_of_classified[k] * 100, 0)}% of classified` : undefined} />)}
              </div>
              <div className="mt-2 text-xs text-ink-400">{s.scope} Mean confidence {s.mean_confidence != null ? num(s.mean_confidence * 100, 0) + "%" : "—"} · mean lesion share {num((s.defects.mean_lesion_share || 0) * 100, 1)}% · mould {num((s.defects.mean_mould_share || 0) * 100, 1)}%</div>
              {s.batch_estimate && (
                <div className="mt-3 border-l-4 border-gold bg-gold-50 p-3 text-sm">
                  <span className="chip bg-paper-300 text-ink">ESTIMATE</span> For the whole batch of {kg(s.batch_estimate.batch_quantity_kg)}: good ≈ {kg(s.batch_estimate.estimated_kg.good)}, damaged ≈ {kg(s.batch_estimate.estimated_kg.damaged)}, rejected ≈ {kg(s.batch_estimate.estimated_kg.rejected)}.
                  <div className="mt-1 text-[11px] text-ink-400">{s.batch_estimate.label}</div>
                </div>
              )}
              {s.failed_images?.length > 0 && <ErrorBox error={{ message: "Not inspected: " + s.failed_images.map((f: any) => `${f.image} (${f.error})`).join(", ") }} />}
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{m.data.images.map((img: any, i: number) => <ImageResult key={i} img={img} file={files.find((f) => f.name === img.image_name)} />)}</div>
            </Panel>
          )}
          {batch ? <Allocation batchId={batch as number} /> : <Note>Select a batch to get a cold-storage zone recommendation.</Note>}
        </div>
      </div>
    </div>
  );
}
