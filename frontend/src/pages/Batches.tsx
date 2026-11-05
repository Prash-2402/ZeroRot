import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Plus, Sprout } from "lucide-react";
import { api, post } from "../lib/api";
import { days, inr, kg, MATURITY, PRODUCE_EMOJI, RISK_STYLE, STORAGE } from "../lib/format";
import { useSelection } from "../stores/live";
import { Badge, Card, cn, ErrorBox, Loading, Note, OriginTag, PageHeader, Spinner } from "../components/ui";

const EMPTY = { produce: "tomato", variety: "", quantity_kg: 500, maturity: "mature_green", initial_quality: 95 as number | "", district: "kolar",
  storage_type: "open_shed", facility_id: "", farmer_name: "", harvest_hours_ago: 6, maturity_known: true, quality_known: true };

function RegisterForm({ onDone, prefill }: { onDone: (id: string) => void; prefill?: any }) {
  const [f, setF] = useState<any>({ ...EMPTY, ...(prefill || {}) });
  const { data: pts } = useQuery({ queryKey: ["points"], queryFn: () => api("/geo/points"), staleTime: Infinity });
  const qc = useQueryClient();
  const [img, setImg] = useState<any>(null);
  const [imgBusy, setImgBusy] = useState(false);
  const districts = (pts?.points || []).filter((p: any) => p.kind === "district");
  const storages = (pts?.points || []).filter((p: any) => p.kind === "cold_storage");
  const create = useMutation({
    mutationFn: () => {
      return post("/batches", {
        produce: f.produce, variety: f.variety || null, quantity_kg: Number(f.quantity_kg), harvest_hours_ago: Number(f.harvest_hours_ago),
        maturity: f.maturity_known ? f.maturity : null, initial_quality: f.quality_known && f.initial_quality !== "" ? Number(f.initial_quality) : null,
        district: f.district, storage_type: f.storage_type, facility_id: f.storage_type === "cold_storage" ? f.facility_id || null : null,
        farmer_name: f.farmer_name || null,
      });
    },
    onSuccess: (b: any) => { qc.invalidateQueries(); onDone(b.id); },
  });
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const upload = async (file: File) => {
    setImgBusy(true);
    setImg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/v1/image/ripeness?produce=${f.produce}`, { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.detail?.message || "Could not analyse image");
      setImg(d);
      setF((x: any) => ({ ...x, maturity: d.maturity_estimate, initial_quality: d.starting_quality_estimate, maturity_known: true, quality_known: true }));
    } catch (e: any) {
      setImg({ error: e.message });
    } finally {
      setImgBusy(false);
    }
  };
  const VAR: Record<string, string[]> = { tomato: ["Local hybrid", "Arka Rakshak", "Roma"], mango: ["Alphonso (Badami)", "Totapuri", "Mallika"], banana: ["Robusta (Cavendish)", "Yelakki", "Nendran"] };
  return (
    <Card title="Register a batch" subtitle="Every field feeds the decay engine. Unknown fields lower confidence; they are never invented.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="space-y-1"><span className="label">Produce</span>
          <div className="flex gap-1.5">
            {["tomato", "mango", "banana"].map((p) => (
              <button key={p} onClick={() => set("produce", p)} className={cn("flex-1 rounded-lg border px-2 py-2 text-sm capitalize", f.produce === p ? "border-forest bg-forest-50 font-semibold text-forest" : "border-cream-200 bg-white")}>
                {PRODUCE_EMOJI[p]} {p}
              </button>
            ))}
          </div>
        </label>
        <label className="space-y-1"><span className="label">Variety</span>
          <select className="input" value={f.variety} onChange={(e) => set("variety", e.target.value)}>
            <option value="">Unknown</option>{VAR[f.produce].map((v) => <option key={v}>{v}</option>)}
          </select>
        </label>
        <label className="space-y-1"><span className="label">Quantity (kg)</span>
          <input className="input" type="number" min={1} value={f.quantity_kg} onChange={(e) => set("quantity_kg", e.target.value)} />
        </label>
        <label className="space-y-1"><span className="label">Harvested (hours ago)</span>
          <input className="input" type="number" min={0} max={240} value={f.harvest_hours_ago} onChange={(e) => set("harvest_hours_ago", Number(e.target.value))} />
        </label>
        <label className="space-y-1"><span className="label flex items-center justify-between">Maturity <span className="normal-case tracking-normal"><input type="checkbox" checked={!f.maturity_known} onChange={(e) => set("maturity_known", !e.target.checked)} /> unknown</span></span>
          <select className="input" disabled={!f.maturity_known} value={f.maturity} onChange={(e) => set("maturity", e.target.value)}>
            {Object.entries(MATURITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="space-y-1"><span className="label flex items-center justify-between">Initial quality (0–100) <span className="normal-case tracking-normal"><input type="checkbox" checked={!f.quality_known} onChange={(e) => set("quality_known", !e.target.checked)} /> unknown</span></span>
          <input className="input" type="number" min={0} max={100} disabled={!f.quality_known} value={f.initial_quality} onChange={(e) => set("initial_quality", e.target.value === "" ? "" : Number(e.target.value))} />
        </label>
        <label className="space-y-1"><span className="label">District</span>
          <select className="input" value={f.district} onChange={(e) => set("district", e.target.value)}>
            {districts.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className="space-y-1"><span className="label">Storage</span>
          <select className="input" value={f.storage_type} onChange={(e) => set("storage_type", e.target.value)}>
            <option value="open_shed">Open shed (regional weather estimate)</option><option value="cold_storage">Cold storage</option>
          </select>
        </label>
        {f.storage_type === "cold_storage" ? (
          <label className="space-y-1"><span className="label">Cold storage</span>
            <select className="input" value={f.facility_id} onChange={(e) => set("facility_id", e.target.value)}>
              <option value="">Nearest accepting {f.produce}</option>{storages.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        ) : (
          <label className="space-y-1"><span className="label">Farmer name (optional)</span>
            <input className="input" value={f.farmer_name} onChange={(e) => set("farmer_name", e.target.value)} placeholder="e.g. Ramesh" />
          </label>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-cream-200 p-3">
        <Camera className="h-4 w-4 text-forest" />
        <span className="text-sm text-charcoal-500">Optional: estimate maturity and starting quality from a photo</span>
        <label className="btn-secondary cursor-pointer px-3 py-1.5 text-xs">
          {imgBusy ? <Spinner className="h-3 w-3" /> : "Upload photo"}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
        {img && !img.error && <span className="text-xs text-charcoal-500"><OriginTag origin="image_derived" /> {MATURITY[img.maturity_estimate]}, quality ≈ {img.starting_quality_estimate}. {img.label}</span>}
        {img?.error && <span className="text-xs text-rot">{img.error}</span>}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Note>{f.storage_type === "open_shed" ? "Open-shed conditions are estimated from Open-Meteo regional weather (cached). Add a measured reading on the twin to improve the prediction." : "Cold storage runs at the produce's recommended temperature; readings come from the SIMULATED feed."}</Note>
        <button className="btn-primary" onClick={() => create.mutate()} disabled={create.isPending}>{create.isPending ? <Spinner /> : <Plus className="h-4 w-4" />} Register & open twin</button>
      </div>
      <div className="mt-3"><ErrorBox error={create.error} /></div>
    </Card>
  );
}

export default function Batches() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const { setBatch } = useSelection();
  const [showForm, setShowForm] = useState(sp.get("new") === "1");
  const [prefill, setPrefill] = useState<any>(null);
  const { data, isLoading } = useQuery({ queryKey: ["batches"], queryFn: () => api("/batches"), refetchInterval: 10000 });
  useEffect(() => {
    if (sp.get("new") === "1") {
      setShowForm(true);
      setPrefill({ produce: "tomato", quantity_kg: 500, district: "kolar", storage_type: "open_shed", maturity: "mature_green", initial_quality: 95, variety: "Local hybrid", farmer_name: "Demo farmer" });
    }
  }, [sp]);
  const open = (id: string) => { setBatch(id); nav("/twin"); };
  return (
    <div>
      <PageHeader kicker="Predict" title="Batches" subtitle="One batch, one digital twin. Every batch carries its origin: SIMULATED demo batches or ones you registered."
        actions={<button className="btn-primary" onClick={() => { setShowForm(!showForm); setSp({}); }}><Sprout className="h-4 w-4" /> {showForm ? "Close form" : "Register batch"}</button>} />
      {showForm && <div className="mb-6"><RegisterForm key={JSON.stringify(prefill)} prefill={prefill} onDone={open} /></div>}
      {isLoading ? <Loading /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b border-cream-200 text-left">
              <tr className="[&>th]:label [&>th]:px-4 [&>th]:py-3">
                <th>Batch</th><th>Produce</th><th>Qty</th><th>Location</th><th>Storage</th><th>Quality</th><th>Shelf life</th><th>Value</th><th>Status</th><th>Origin</th>
              </tr>
            </thead>
            <tbody>
              {(data?.batches || []).map((b: any) => (
                <tr key={b.id} onClick={() => open(b.id)} className="cursor-pointer border-b border-cream-100 hover:bg-cream-100/60 [&>td]:px-4 [&>td]:py-2.5">
                  <td className="font-mono text-xs font-semibold text-forest">{b.id}{b.is_judge && <Badge tone="amber" className="ml-1">judge</Badge>}</td>
                  <td>{PRODUCE_EMOJI[b.produce]} {b.produce_name}<div className="text-xs text-charcoal-400">{b.maturity ? MATURITY[b.maturity] : "maturity unknown"}</div></td>
                  <td className="num">{kg(b.quantity_kg)}</td>
                  <td>{b.district_name}{b.trip_id && <div className="text-xs text-charcoal-400">in transit</div>}</td>
                  <td>{STORAGE[b.storage_type] || b.storage_type}<div className="text-xs text-charcoal-400">{b.facility_name}</div></td>
                  <td className="num font-semibold">{b.quality}%</td>
                  <td className="num">{days(b.shelf_life_days)}</td>
                  <td className="num">{inr(b.value_inr)}</td>
                  <td><span className={cn("chip", RISK_STYLE[b.risk])}>{b.risk}</span></td>
                  <td><OriginTag origin={b.origin} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
