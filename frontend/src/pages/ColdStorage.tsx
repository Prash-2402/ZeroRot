import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { ApiError, api, post } from "../lib/api";
import { inr, kg } from "../lib/format";
import { Empty, ErrorBox, Field, Modal, Note, PageHead, Panel, Spinner } from "../components/ui";
import { LocationPicker, QRShare, useBatches, type Loc } from "../components/shared";
import { SimulationView } from "../components/SimulationView";
import { SimList, useSelectedSim } from "./simlist";
import { ManualAmbientFields } from "./Traditional";

function FacilityForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [loc, setLoc] = useState<Loc | null>(null);
  const m = useMutation({ mutationFn: () => post("/storage/facilities", { name, kind: "cold", location_name: loc?.name, lat: loc?.lat, lng: loc?.lng }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["facilities"] }); onDone(); } });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <Field label="Facility name"><input className="input" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <LocationPicker value={loc} onChange={setLoc} label="Facility location (needed for live weather)" />
      <ErrorBox error={m.error} />
      <button className="btn-gold w-full" disabled={!loc || m.isPending}>{m.isPending ? <Spinner /> : "Create facility"}</button>
    </form>
  );
}

function ZoneForm({ facilityId, onDone }: { facilityId: number; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "Chamber A", temp_min: 8, temp_max: 15, setpoint: 12, rh_setpoint: 90, capacity_kg: 10000, cooling_capacity_kw: 12, ua_w_per_k: 120, volume_m3: 200, air_changes_per_hour: 0.2, cost_per_kg_day: 0.5 });
  const m = useMutation({ mutationFn: () => post(`/storage/facilities/${facilityId}/zones`, Object.fromEntries(Object.entries(f).map(([k, v]) => [k, k === "name" ? v : Number(v)]))), onSuccess: () => { qc.invalidateQueries({ queryKey: ["facilities"] }); onDone(); } });
  const num = (k: keyof typeof f, label: string, hint?: string, step = "0.1") => (
    <Field label={label} hint={hint}><input className="input" type="number" step={step} required value={f[k] as any} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
  );
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <Field label="Zone name"><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <div className="grid grid-cols-3 gap-3">
        {num("temp_min", "Min °C")}{num("temp_max", "Max °C")}{num("setpoint", "Setpoint °C")}
        {num("rh_setpoint", "RH setpoint %")}{num("capacity_kg", "Capacity kg", undefined, "1")}{num("volume_m3", "Volume m³", undefined, "1")}
        {num("cooling_capacity_kw", "Cooling kW", "Rated refrigeration")}{num("ua_w_per_k", "UA W/K", "Envelope heat-loss coefficient")}{num("air_changes_per_hour", "Infiltration ACH")}
        {num("cost_per_kg_day", "Cost ₹/kg/day")}
      </div>
      <Note>These are the physical properties of your chamber; the simulation uses them directly.</Note>
      <ErrorBox error={m.error} />
      <button className="btn-gold w-full" disabled={m.isPending}>{m.isPending ? <Spinner /> : "Add zone"}</button>
    </form>
  );
}

function CreateColdSim({ onCreated }: { onCreated: (id: number) => void }) {
  const qc = useQueryClient();
  const allocs = useQuery({ queryKey: ["allocations"], queryFn: () => api("/storage/allocations") });
  const batches = useBatches();
  const [aid, setAid] = useState<number | "">("");
  const [dur, setDur] = useState(7);
  const [auto, setAuto] = useState(true);
  const [useManual, setUseManual] = useState(false);
  const [manual, setManual] = useState({ t: "", rh: "" });
  const a = (allocs.data?.allocations || []).find((x: any) => x.id === aid);
  const m = useMutation({
    mutationFn: () => post("/simulations", { kind: "cold_storage", batch_id: a.batch_id, zone_id: a.zone_id, duration_days: dur, auto_control: auto, speed: 1800,
      manual_ambient: useManual && manual.t !== "" ? { t: Number(manual.t), rh: Number(manual.rh || 70) } : undefined }),
    onSuccess: async (d) => { await post(`/simulations/${d.id}/start`); qc.invalidateQueries({ queryKey: ["simulations"] }); onCreated(d.id); },
    onError: (e) => { if (e instanceof ApiError && e.status === 503) setUseManual(true); },
  });
  const code = (id: number) => (batches.data?.batches || []).find((b: any) => b.id === id)?.code || `#${id}`;
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <Field label="Allocation">
        <select className="input" value={aid} onChange={(e) => setAid(e.target.value ? Number(e.target.value) : "")}>
          <option value="">{(allocs.data?.allocations || []).length ? "Choose an allocated batch" : "No allocations — allocate a batch in Advanced Storage"}</option>
          {(allocs.data?.allocations || []).filter((x: any) => x.status === "active").map((x: any) => <option key={x.id} value={x.id}>{code(x.batch_id)} → zone #{x.zone_id} · {kg(x.quantity_kg)} @ {x.setpoint} °C</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Duration (days)"><input className="input" type="number" min={0.5} max={14} step="0.5" value={dur} onChange={(e) => setDur(Number(e.target.value))} /></Field>
        <label className="mt-6 flex items-center gap-2 text-sm"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Automatic corrective control</label>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={useManual} onChange={(e) => setUseManual(e.target.checked)} /> Manual outside conditions</label>
      {useManual && <ManualAmbientFields value={manual} onChange={setManual} />}
      <ErrorBox error={m.error} />
      <button className="btn-gold w-full" disabled={!a || m.isPending}>{m.isPending ? <Spinner /> : "Create & start cold-room twin"}</button>
    </form>
  );
}

export default function ColdStorage() {
  const [sel, setSel] = useSelectedSim();
  const [modal, setModal] = useState<null | "facility" | "sim" | { zone: number }>(null);
  const fac = useQuery({ queryKey: ["facilities"], queryFn: () => api("/storage/facilities") });
  const cold = (fac.data?.facilities || []).filter((f: any) => f.kind === "cold");
  return (
    <div className="space-y-4">
      <PageHead kicker="Module 4" title="Intelligent Cold Storage" sub="Your facilities and chambers, their real capacity and load, and a thermal digital twin of each allocated batch."
        actions={<><button className="btn-line" onClick={() => setModal("facility")}><Plus className="h-4 w-4" /> Facility</button><button className="btn-gold" onClick={() => setModal("sim")}><Plus className="h-4 w-4" /> Cold-room simulation</button></>} />
      <ErrorBox error={fac.error} />
      {cold.length === 0 ? <Empty title="No cold-storage facility" action={<button className="btn-gold" onClick={() => setModal("facility")}>Add facility</button>}>Add a facility and its zones (chambers) with their temperature range, capacity and refrigeration rating.</Empty> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {cold.map((f: any) => (
            <Panel key={f.id} title={f.name} sub={f.location_name} action={<button className="btn-line py-1 text-xs" onClick={() => setModal({ zone: f.id })}><Plus className="h-3.5 w-3.5" /> Zone</button>}>
              {f.zones.length === 0 ? <div className="text-sm text-ink-400">No zones yet.</div> : (
                <div className="space-y-2">
                  {f.zones.map((z: any) => {
                    const pct = Math.min(100, (z.used_kg / z.capacity_kg) * 100);
                    return (
                      <div key={z.id} className="border border-paper-300 bg-white p-2 text-xs">
                        <div className="flex items-center justify-between"><b className="text-sm">{z.name}</b><div className="flex items-center gap-2"><span>{z.temp_min}–{z.temp_max} °C · set {z.setpoint} °C · {z.cooling_capacity_kw} kW</span><QRShare resourceType="zone" resourceId={z.id} label="QR" /></div></div>
                        <div className="mt-1.5 h-2 bg-paper-300"><div className="h-2" style={{ width: `${pct}%`, background: pct > 90 ? "#EB4D3D" : "#FFC900" }} /></div>
                        <div className="mt-1 text-ink-400">{kg(z.used_kg)} used of {kg(z.capacity_kg)} · {kg(z.free_kg)} free · {inr(z.cost_per_kg_day * 100)}/100 kg/day</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          ))}
        </div>
      )}
      <SimList kind="cold_storage" selected={sel} onSelect={setSel} />
      {sel ? <SimulationView id={sel} /> : cold.length > 0 && <Note>Allocate a batch in Advanced Storage, then create a cold-room simulation to watch temperature, humidity, gases and quality inside the chamber.</Note>}
      <Modal open={modal === "facility"} onClose={() => setModal(null)} title="New cold-storage facility"><FacilityForm onDone={() => setModal(null)} /></Modal>
      <Modal open={typeof modal === "object" && modal !== null} onClose={() => setModal(null)} title="New zone" wide>{typeof modal === "object" && modal && <ZoneForm facilityId={modal.zone} onDone={() => setModal(null)} />}</Modal>
      <Modal open={modal === "sim"} onClose={() => setModal(null)} title="New cold-room simulation"><CreateColdSim onCreated={(id) => { setModal(null); setSel(id); }} /></Modal>
    </div>
  );
}
