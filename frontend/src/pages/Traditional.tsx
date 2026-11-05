import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { ApiError, post } from "../lib/api";
import { ErrorBox, Field, Modal, Note, PageHead, Spinner, Empty } from "../components/ui";
import { BatchSelect, LocationPicker, useBatches, type Loc } from "../components/shared";
import { SimulationView } from "../components/SimulationView";
import { SimList, useSelectedSim } from "./simlist";

export function ManualAmbientFields({ value, onChange }: { value: { t: string; rh: string }; onChange: (v: { t: string; rh: string }) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Manual outside temperature (°C)"><input className="input" type="number" value={value.t} onChange={(e) => onChange({ ...value, t: e.target.value })} /></Field>
      <Field label="Manual outside RH (%)"><input className="input" type="number" value={value.rh} onChange={(e) => onChange({ ...value, rh: e.target.value })} /></Field>
    </div>
  );
}

function CreateTraditional({ onCreated }: { onCreated: (id: number) => void }) {
  const qc = useQueryClient();
  const batches = useBatches();
  const [batch, setBatch] = useState<number | "">("");
  const [loc, setLoc] = useState<Loc | null>(null);
  const [f, setF] = useState({ structure: "brick", length_m: 8, width_m: 6, height_m: 3.5, ach: 2, duration_days: 7, speed: 1800 });
  const [manual, setManual] = useState({ t: "", rh: "" });
  const [useManual, setUseManual] = useState(false);
  const b = (batches.data?.batches || []).find((x: any) => x.id === batch);
  const loc2 = loc || (b?.lat ? { name: b.location_name, lat: b.lat, lng: b.lng } : null);
  const m = useMutation({
    mutationFn: () => post("/simulations", {
      kind: "traditional_storage", batch_id: batch, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, k === "structure" ? v : Number(v)])),
      lat: loc2?.lat, lng: loc2?.lng, location_name: loc2?.name,
      manual_ambient: useManual && manual.t !== "" && manual.rh !== "" ? { t: Number(manual.t), rh: Number(manual.rh) } : undefined,
    }),
    onSuccess: async (d) => { await post(`/simulations/${d.id}/start`); qc.invalidateQueries({ queryKey: ["simulations"] }); onCreated(d.id); },
    onError: (e) => { if (e instanceof ApiError && e.status === 503) setUseManual(true); },
  });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <Field label="Batch"><BatchSelect value={batch} onChange={setBatch} filter={(x) => x.commodity_id !== "onion" && !["sold", "discarded"].includes(x.status)} /></Field>
      <LocationPicker value={loc2} onChange={setLoc} label="Storage location (for live weather)" />
      <div className="grid grid-cols-3 gap-3">
        <Field label="Structure"><select className="input" value={f.structure} onChange={(e) => setF({ ...f, structure: e.target.value })}><option value="brick">Brick</option><option value="mud">Mud</option><option value="tin">Tin sheet</option></select></Field>
        <Field label="Air changes / h" hint="Natural ventilation"><input className="input" type="number" step="0.1" min={0} max={20} value={f.ach} onChange={(e) => setF({ ...f, ach: e.target.value as any })} /></Field>
        <Field label="Duration (days)"><input className="input" type="number" min={0.5} max={14} step="0.5" value={f.duration_days} onChange={(e) => setF({ ...f, duration_days: e.target.value as any })} /></Field>
        <Field label="Length (m)"><input className="input" type="number" min={1.5} max={60} step="0.5" value={f.length_m} onChange={(e) => setF({ ...f, length_m: e.target.value as any })} /></Field>
        <Field label="Width (m)"><input className="input" type="number" min={1.5} max={60} step="0.5" value={f.width_m} onChange={(e) => setF({ ...f, width_m: e.target.value as any })} /></Field>
        <Field label="Height (m)"><input className="input" type="number" min={2} max={15} step="0.5" value={f.height_m} onChange={(e) => setF({ ...f, height_m: e.target.value as any })} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={useManual} onChange={(e) => setUseManual(e.target.checked)} /> Use manual outside conditions instead of live weather</label>
      {useManual && <ManualAmbientFields value={manual} onChange={setManual} />}
      <ErrorBox error={m.error} />
      {m.error instanceof ApiError && m.error.status === 503 && <Note tone="warn">Live weather is unavailable. Enter manual outside conditions to continue — the simulation will be labelled MANUAL.</Note>}
      <button className="btn-gold w-full" disabled={!batch || (!loc2 && !useManual) || m.isPending}>{m.isPending ? <Spinner /> : "Create & start simulation"}</button>
    </form>
  );
}

export default function Traditional() {
  const [sel, setSel] = useSelectedSim();
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-4">
      <PageHead kicker="Module 2" title="Traditional Storage Simulation" sub="Farm storage room with no refrigeration. Inside conditions follow live outside weather through the walls, ventilation and the produce's own respiration heat."
        actions={<button className="btn-gold" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New simulation</button>} />
      <SimList kind="traditional_storage" selected={sel} onSelect={setSel} />
      {sel ? <SimulationView id={sel} /> : <Empty title="Choose or create a simulation" action={<button className="btn-gold" onClick={() => setOpen(true)}>New simulation</button>}>Pick a batch and location; the backend fetches the Open-Meteo forecast and runs the thermal, humidity and gas models.</Empty>}
      <Modal open={open} onClose={() => setOpen(false)} title="New traditional storage simulation" wide><CreateTraditional onCreated={(id) => { setOpen(false); setSel(id); }} /></Modal>
    </div>
  );
}
