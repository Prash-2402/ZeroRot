import { create } from "zustand";

export type Truck = {
  id: string; batch_id: string; produce: string; lat: number; lng: number; frac: number; progress_s: number; duration_s: number;
  quality: number; risk: string; reefer: boolean; reefer_status: string; cargo_temp: number | null; dest_name: string;
  rerouted: boolean; is_scenario: boolean; is_judge: boolean; pending_reroute: boolean; ghost: { lat: number; lng: number; frac: number } | null;
};
export type Stats = {
  active_batches: number; tonnes_monitored: number; value_monitored: number; value_at_risk: number; value_protected_today: number;
  healthy: number; warning: number; critical: number; sim_now: string;
};
export type Alert = {
  id: number; ts: string; batch_id: string | null; trip_id: string | null; kind: string; severity: string; title: string; body: string;
  body_kn: string | null; channel: string; delivered: boolean; actions: { label: string; action: string }[]; origin: string;
};
export type WorkflowStep = { run_id: number; trip_id: string; idx: number; stage: string; tool: string; summary: string; kind: string };
export type Toast = { id: number; title: string; body?: string; severity: string };

type LiveState = {
  connected: boolean;
  simNow: string | null;
  tickAt: number;
  minutesPerTick: number;
  trucks: Record<string, Truck>;
  stats: Stats | null;
  alerts: Alert[];
  toasts: Toast[];
  workflow: Record<string, { kind: string; note?: string; steps: WorkflowStep[]; done: boolean; proposal?: any }>;
  version: number; // bumps on reset / trip changes so pages refetch
  mode: string;
  set: (p: Partial<LiveState>) => void;
  toast: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
};

let tid = 1;
export const useLive = create<LiveState>((set, get) => ({
  connected: false, simNow: null, tickAt: 0, minutesPerTick: 2, trucks: {}, stats: null, alerts: [], toasts: [], workflow: {},
  version: 0, mode: "demo",
  set: (p) => set(p),
  toast: (t) => {
    const id = tid++;
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
    setTimeout(() => get().dismiss(id), t.severity === "critical" ? 9000 : 5500);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
}));

export const useSelection = create<{ batchId: string | null; setBatch: (id: string | null) => void }>((set) => ({
  batchId: (() => { try { return localStorage.getItem("zr-batch"); } catch { return null; } })(),
  setBatch: (id) => { try { id ? localStorage.setItem("zr-batch", id) : localStorage.removeItem("zr-batch"); } catch { /* ignore */ } set({ batchId: id }); },
}));
