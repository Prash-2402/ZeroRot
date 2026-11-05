import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api, post } from "../lib/api";
import { COMMODITY_EMOJI, kg, when } from "../lib/format";
import { Empty, ErrorBox, Field, Modal, Note, PageHead, Panel, Spinner } from "../components/ui";
import { LocationPicker, QRShare, useBatches, useCommodities, type Loc } from "../components/shared";

function nowLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function FarmerForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", phone: "", village: "", language: "kn" });
  const [loc, setLoc] = useState<Loc | null>(null);
  const m = useMutation({
    mutationFn: () => post("/farmers", { ...f, phone: f.phone || null, village: f.village || null, location_name: loc?.name, lat: loc?.lat, lng: loc?.lng }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["farmers"] }); onDone(); },
  });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <Field label="Farmer name"><input className="input" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Language"><select className="input" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}><option value="kn">ಕನ್ನಡ</option><option value="en">English</option></select></Field>
      </div>
      <Field label="Village"><input className="input" value={f.village} onChange={(e) => setF({ ...f, village: e.target.value })} /></Field>
      <LocationPicker value={loc} onChange={setLoc} />
      <ErrorBox error={m.error} />
      <button className="btn-gold w-full" disabled={m.isPending}>{m.isPending ? <Spinner /> : "Save farmer"}</button>
    </form>
  );
}

function BatchForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const comms = useCommodities();
  const farmers = useQuery({ queryKey: ["farmers"], queryFn: () => api("/farmers") });
  const [f, setF] = useState({ farmer_id: "", commodity_id: "tomato", variety: "", quantity_kg: 500, harvest_time: nowLocal(), initial_quality: 95, maturity: "turning", storage_path: "traditional" });
  const [loc, setLoc] = useState<Loc | null>(null);
  const c = (comms.data?.commodities || []).find((x: any) => x.id === f.commodity_id);
  const m = useMutation({
    mutationFn: () => post("/batches", {
      ...f, farmer_id: f.farmer_id ? Number(f.farmer_id) : null, variety: f.variety || null, quantity_kg: Number(f.quantity_kg), initial_quality: Number(f.initial_quality),
      harvest_time: new Date(f.harvest_time).toISOString(), maturity: ["tomato", "mango", "banana"].includes(f.commodity_id) ? f.maturity : null,
      location_name: loc?.name, lat: loc?.lat, lng: loc?.lng,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["batches"] }); qc.invalidateQueries({ queryKey: ["summary"] }); onDone(); },
  });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Farmer">
          <select className="input" value={f.farmer_id} onChange={(e) => setF({ ...f, farmer_id: e.target.value })}>
            <option value="">— none —</option>
            {(farmers.data?.farmers || []).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field label="Commodity">
          <select className="input" value={f.commodity_id} onChange={(e) => setF({ ...f, commodity_id: e.target.value })}>
            {(comms.data?.commodities || []).map((x: any) => <option key={x.id} value={x.id}>{COMMODITY_EMOJI[x.id]} {x.name}</option>)}
          </select>
        </Field>
      </div>
      {c && !c.prediction_supported && <Note tone="warn">{c.prediction_note}</Note>}
      {c && c.prediction_supported && <Note>Recommended storage: {c.storage.temperature_c} °C, {c.storage.rh_low}–{c.storage.rh_high}% RH. Chilling injury below {c.storage.chilling_threshold_c} °C.</Note>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantity (kg)"><input className="input" type="number" min={1} max={100000} required value={f.quantity_kg} onChange={(e) => setF({ ...f, quantity_kg: e.target.value as any })} /></Field>
        <Field label="Variety"><input className="input" value={f.variety} onChange={(e) => setF({ ...f, variety: e.target.value })} /></Field>
        <Field label="Harvested at"><input className="input" type="datetime-local" required value={f.harvest_time} onChange={(e) => setF({ ...f, harvest_time: e.target.value })} /></Field>
        <Field label="Initial quality (0–100)" hint="Your visual grading at harvest"><input className="input" type="number" min={0} max={100} required value={f.initial_quality} onChange={(e) => setF({ ...f, initial_quality: e.target.value as any })} /></Field>
        {["tomato", "mango", "banana"].includes(f.commodity_id) && (
          <Field label="Maturity"><select className="input" value={f.maturity} onChange={(e) => setF({ ...f, maturity: e.target.value })}><option value="mature_green">Mature green</option><option value="turning">Turning</option><option value="ripe">Ripe</option></select></Field>
        )}
        <Field label="Storage path"><select className="input" value={f.storage_path} onChange={(e) => setF({ ...f, storage_path: e.target.value })}><option value="traditional">Traditional storage</option><option value="advanced">Advanced (inspection + cold)</option></select></Field>
      </div>
      <LocationPicker value={loc} onChange={setLoc} label="Harvest location" />
      <ErrorBox error={m.error} />
      <button className="btn-gold w-full" disabled={m.isPending}>{m.isPending ? <Spinner /> : "Register batch"}</button>
    </form>
  );
}

const NEXT: Record<string, [string, string]> = { traditional: ["/app/traditional", "Simulate storage"], advanced: ["/app/advanced", "Inspect & allocate"] };

export default function PostHarvest() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<"farmer" | "batch" | null>(null);
  const batches = useBatches();
  const farmers = useQuery({ queryKey: ["farmers"], queryFn: () => api("/farmers") });
  const status = useMutation({ mutationFn: ({ id, s }: { id: number; s: string }) => api(`/batches/${id}`, { method: "PATCH", json: { status: s } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["batches"] }) });
  const fname = (id: number) => (farmers.data?.farmers || []).find((x: any) => x.id === id)?.name;
  const list = batches.data?.batches || [];
  return (
    <div className="space-y-5">
      <PageHead kicker="Module 1" title="Post-Harvest Loss Prevention" sub="Register farmers and harvested batches. Every simulation, inspection and price decision is tied to a batch."
        actions={<><button className="btn-line" onClick={() => setModal("farmer")}><Plus className="h-4 w-4" /> Farmer</button><button className="btn-gold" onClick={() => setModal("batch")}><Plus className="h-4 w-4" /> Batch</button></>} />
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Panel title={`Batches (${list.length})`}>
          <ErrorBox error={status.error} />
          {list.length === 0 ? <Empty title="No batches registered" action={<button className="btn-gold" onClick={() => setModal("batch")}>Register batch</button>}>A batch is one lot of harvested produce with its quantity, quality and harvest time.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="table-head"><th className="py-1 text-left">Batch</th><th className="text-left">Farmer</th><th className="text-right">Qty</th><th className="text-right">Quality</th><th className="text-left">Harvested</th><th className="text-left">Status</th><th /></tr></thead>
                <tbody className="table-body">
                  {list.map((b: any) => (
                    <tr key={b.id}>
                      <td className="py-2"><div className="font-semibold">{COMMODITY_EMOJI[b.commodity_id]} {b.code}</div><div className="text-xs text-ink-400">{b.commodity_id}{b.variety ? ` · ${b.variety}` : ""}{b.maturity ? ` · ${b.maturity.replace("_", " ")}` : ""}</div></td>
                      <td className="text-xs">{fname(b.farmer_id) || "—"}<div className="text-ink-400">{b.location_name}</div></td>
                      <td className="text-right font-mono">{kg(b.quantity_kg)}</td>
                      <td className="text-right font-mono">{b.initial_quality}</td>
                      <td className="text-xs">{when(b.harvest_time)}</td>
                      <td>
                        <select className="input w-auto py-1 text-xs" value={b.status} onChange={(e) => status.mutate({ id: b.id, s: e.target.value })} aria-label="Batch status">
                          {["registered", "inspected", "in_storage", "in_transit", "sold", "discarded"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                        </select>
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <div className="flex justify-end gap-1">
                          {b.storage_path && NEXT[b.storage_path] && <Link to={NEXT[b.storage_path][0]} className="btn-line py-1 text-xs">{NEXT[b.storage_path][1]}</Link>}
                          <QRShare resourceType="batch" resourceId={b.id} label="QR" />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title={`Farmers (${(farmers.data?.farmers || []).length})`}>
          {(farmers.data?.farmers || []).length === 0 ? <div className="text-sm text-ink-400">No farmers yet.</div> : (
            <div className="space-y-2">{farmers.data.farmers.map((x: any) => (
              <div key={x.id} className="border border-paper-300 bg-white p-2 text-sm"><div className="font-semibold">{x.name}</div><div className="text-xs text-ink-400">{[x.village, x.location_name, x.phone].filter(Boolean).join(" · ") || "—"}</div></div>
            ))}</div>
          )}
        </Panel>
      </div>
      <Modal open={modal === "farmer"} onClose={() => setModal(null)} title="New farmer"><FarmerForm onDone={() => setModal(null)} /></Modal>
      <Modal open={modal === "batch"} onClose={() => setModal(null)} title="Register batch" wide><BatchForm onDone={() => setModal(null)} /></Modal>
    </div>
  );
}
