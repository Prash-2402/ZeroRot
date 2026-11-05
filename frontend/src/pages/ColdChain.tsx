import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { ApiError, api, post } from "../lib/api";
import { kg, num, when } from "../lib/format";
import { Empty, ErrorBox, Field, Modal, Note, PageHead, Panel, Spinner } from "../components/ui";
import { BatchSelect, LocationPicker, QRShare, useBatches, useCommodities, type Loc } from "../components/shared";
import { SimulationView } from "../components/SimulationView";
import { SimList, useSelectedSim } from "./simlist";
import { ManualAmbientFields } from "./Traditional";

function TruckForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: "", name: "", cooling_capacity_kw: 6, ua_w_per_k: 45, cargo_volume_m3: 30, capacity_kg: 6000 });
  const m = useMutation({ mutationFn: () => post("/trucks", { ...f, cooling_capacity_kw: Number(f.cooling_capacity_kw), ua_w_per_k: Number(f.ua_w_per_k), cargo_volume_m3: Number(f.cargo_volume_m3), capacity_kg: Number(f.capacity_kg) }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["trucks"] }); onDone(); } });
  const n = (k: keyof typeof f, l: string, h?: string) => <Field label={l} hint={h}><input className="input" type="number" step="0.1" required value={f[k] as any} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>;
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Registration / code"><input className="input" required minLength={2} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="KA-01-AB-1234" /></Field>
        <Field label="Name"><input className="input" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        {n("cooling_capacity_kw", "Refrigeration kW", "Rated unit capacity")}{n("ua_w_per_k", "Body UA W/K", "Insulation heat-loss coefficient")}
        {n("cargo_volume_m3", "Cargo volume m³")}{n("capacity_kg", "Payload kg")}
      </div>
      <ErrorBox error={m.error} />
      <button className="btn-gold w-full" disabled={m.isPending}>{m.isPending ? <Spinner /> : "Save truck"}</button>
    </form>
  );
}

function RouteForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [o, setO] = useState<Loc | null>(null);
  const [d, setD] = useState<Loc | null>(null);
  const m = useMutation({ mutationFn: () => post("/routes", { origin_name: o!.name, origin_lat: o!.lat, origin_lng: o!.lng, dest_name: d!.name, dest_lat: d!.lat, dest_lng: d!.lng }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["routes"] }); onDone(); } });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <LocationPicker value={o} onChange={setO} label="Origin (farm / pack-house)" />
      <LocationPicker value={d} onChange={setD} label="Destination (mandi / market)" />
      <Note>The road distance, duration and geometry come from OSRM. If OSRM is unreachable the route is not created.</Note>
      <ErrorBox error={m.error} />
      <button className="btn-gold w-full" disabled={!o || !d || m.isPending}>{m.isPending ? <Spinner /> : "Get road route"}</button>
    </form>
  );
}

function CreateTrip({ onCreated }: { onCreated: (id: number) => void }) {
  const qc = useQueryClient();
  const trucks = useQuery({ queryKey: ["trucks"], queryFn: () => api("/trucks") });
  const routes = useQuery({ queryKey: ["routes"], queryFn: () => api("/routes") });
  const batches = useBatches();
  const comms = useCommodities();
  const [f, setF] = useState({ batch: "" as number | "", truck: "", route: "", target: "", initial: "", auto: true, speed: 900 });
  const [useManual, setUseManual] = useState(false);
  const [manual, setManual] = useState({ t: "", rh: "" });
  const b = (batches.data?.batches || []).find((x: any) => x.id === f.batch);
  const rec = (comms.data?.commodities || []).find((c: any) => c.id === b?.commodity_id)?.storage;
  const m = useMutation({
    mutationFn: () => post("/simulations", {
      kind: "cold_chain", batch_id: f.batch, truck_id: Number(f.truck), route_id: Number(f.route), speed: f.speed, auto_control: f.auto,
      target_temp_c: f.target !== "" ? Number(f.target) : rec?.temperature_c, initial_internal_temp: f.initial !== "" ? Number(f.initial) : undefined,
      manual_ambient: useManual && manual.t !== "" ? { t: Number(manual.t), rh: Number(manual.rh || 60) } : undefined,
    }),
    onSuccess: async (d) => { await post(`/simulations/${d.id}/start`); qc.invalidateQueries({ queryKey: ["simulations"] }); onCreated(d.id); },
    onError: (e) => { if (e instanceof ApiError && e.status === 503) setUseManual(true); },
  });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <Field label="Batch"><BatchSelect value={f.batch} onChange={(v) => setF({ ...f, batch: v })} filter={(x) => x.commodity_id !== "onion" && !["sold", "discarded"].includes(x.status)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Truck"><select className="input" value={f.truck} onChange={(e) => setF({ ...f, truck: e.target.value })}><option value="">Choose</option>{(trucks.data?.trucks || []).map((t: any) => <option key={t.id} value={t.id}>{t.code} · {t.cooling_capacity_kw} kW · {kg(t.capacity_kg)}</option>)}</select></Field>
        <Field label="Route"><select className="input" value={f.route} onChange={(e) => setF({ ...f, route: e.target.value })}><option value="">Choose</option>{(routes.data?.routes || []).map((r: any) => <option key={r.id} value={r.id}>{r.origin_name} → {r.dest_name} · {r.distance_km} km</option>)}</select></Field>
        <Field label="Target temperature °C" hint={rec ? `Recommended ${rec.temperature_c} °C; chilling below ${rec.chilling_threshold_c} °C` : undefined}><input className="input" type="number" step="0.5" value={f.target} placeholder={rec ? String(rec.temperature_c) : ""} onChange={(e) => setF({ ...f, target: e.target.value })} /></Field>
        <Field label="Cargo temp at loading °C" hint="Blank = outside temperature (no pre-cooling)"><input className="input" type="number" step="0.5" value={f.initial} onChange={(e) => setF({ ...f, initial: e.target.value })} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.auto} onChange={(e) => setF({ ...f, auto: e.target.checked })} /> Automatic corrective control (backup cooling, setpoint, ventilation)</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={useManual} onChange={(e) => setUseManual(e.target.checked)} /> Manual outside conditions</label>
      {useManual && <ManualAmbientFields value={manual} onChange={setManual} />}
      <ErrorBox error={m.error} />
      <button className="btn-gold w-full" disabled={!f.batch || !f.truck || !f.route || m.isPending}>{m.isPending ? <Spinner /> : "Create & start trip"}</button>
    </form>
  );
}

export default function ColdChain() {
  const [sel, setSel] = useSelectedSim();
  const [modal, setModal] = useState<null | "truck" | "route" | "trip">(null);
  const trucks = useQuery({ queryKey: ["trucks"], queryFn: () => api("/trucks") });
  const routes = useQuery({ queryKey: ["routes"], queryFn: () => api("/routes") });
  const ready = (trucks.data?.trucks || []).length > 0 && (routes.data?.routes || []).length > 0;
  return (
    <div className="space-y-4">
      <PageHead kicker="Module 6" title="Cold Chain Digital Twin" sub="Refrigerated truck on a real road route. Weather is sampled along the route; the cargo is modelled as six thermal zones from the cooling unit to the rear door."
        actions={<><button className="btn-line" onClick={() => setModal("truck")}><Plus className="h-4 w-4" /> Truck</button><button className="btn-line" onClick={() => setModal("route")}><Plus className="h-4 w-4" /> Route</button><button className="btn-gold" disabled={!ready} onClick={() => setModal("trip")}><Plus className="h-4 w-4" /> Trip simulation</button></>} />
      <div className="grid gap-3 md:grid-cols-2">
        <Panel title={`Trucks (${(trucks.data?.trucks || []).length})`}>
          {(trucks.data?.trucks || []).length === 0 ? <div className="text-sm text-ink-400">No trucks registered.</div> : (
            <div className="space-y-1">{trucks.data.trucks.map((t: any) => <div key={t.id} className="flex items-center justify-between border border-paper-300 bg-white px-2 py-1.5 text-xs"><span><b>{t.code}</b> {t.name} · {t.cooling_capacity_kw} kW · UA {t.ua_w_per_k} W/K · {kg(t.capacity_kg)}</span><QRShare resourceType="truck" resourceId={t.id} label="QR" /></div>)}</div>
          )}
        </Panel>
        <Panel title={`Routes (${(routes.data?.routes || []).length})`}>
          {(routes.data?.routes || []).length === 0 ? <div className="text-sm text-ink-400">No routes yet.</div> : (
            <div className="space-y-1">{routes.data.routes.map((r: any) => <div key={r.id} className="border border-paper-300 bg-white px-2 py-1.5 text-xs"><b>{r.origin_name} → {r.dest_name}</b> · {r.distance_km} km · {num(r.duration_h)} h <span className="text-ink-400">· {r.source} {when(r.retrieved_at)}</span></div>)}</div>
          )}
        </Panel>
      </div>
      <SimList kind="cold_chain" selected={sel} onSelect={setSel} />
      {sel ? <SimulationView id={sel} /> : <Empty title={ready ? "Start a trip simulation" : "Add a truck and a route first"} action={ready ? <button className="btn-gold" onClick={() => setModal("trip")}>New trip</button> : undefined}>The twin shows the exterior or a cutaway heatmap of the cargo, virtual sensors, the route progress and seven fault scenarios.</Empty>}
      <Modal open={modal === "truck"} onClose={() => setModal(null)} title="New refrigerated truck"><TruckForm onDone={() => setModal(null)} /></Modal>
      <Modal open={modal === "route"} onClose={() => setModal(null)} title="New route"><RouteForm onDone={() => setModal(null)} /></Modal>
      <Modal open={modal === "trip"} onClose={() => setModal(null)} title="New cold-chain trip" wide><CreateTrip onCreated={(id) => { setModal(null); setSel(id); }} /></Modal>
    </div>
  );
}
