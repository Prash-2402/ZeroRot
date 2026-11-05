import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { wsUrl } from "./api";
import { useLive, type Truck } from "../stores/live";

/** One WebSocket for the whole app. Reconnects with backoff; every message updates the live store. */
export function useLiveSocket() {
  const qc = useQueryClient();
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry = 0;
    let stop = false;
    let timer: number | undefined;
    const S = useLive.getState;

    const connect = () => {
      ws = new WebSocket(wsUrl());
      ws.onopen = () => { retry = 0; S().set({ connected: true }); };
      ws.onclose = () => {
        S().set({ connected: false });
        if (!stop) timer = window.setTimeout(connect, Math.min(8000, 500 * 2 ** retry++));
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        const d = msg.data;
        switch (msg.type) {
          case "tick": {
            const trucks: Record<string, Truck> = {};
            for (const t of d.trucks) trucks[t.id] = t;
            S().set({ trucks, stats: d.stats, simNow: d.sim_now, tickAt: performance.now(), minutesPerTick: d.minutes_per_tick });
            break;
          }
          case "batch.update":
            qc.invalidateQueries({ queryKey: ["batches"] });
            break;
          case "alert.new":
            S().set({ alerts: [d, ...S().alerts].slice(0, 60) });
            if (d.severity === "critical" || d.severity === "warning" || d.severity === "success")
              S().toast({ title: d.title, body: d.body, kn: d.body_kn, severity: d.severity });
            qc.invalidateQueries({ queryKey: ["notifications"] });
            break;
          case "workflow.start":
            S().set({ workflow: { ...S().workflow, [d.trip_id]: { kind: d.kind, note: d.note, steps: [], done: false } } });
            break;
          case "workflow.step": {
            const cur = S().workflow[d.trip_id] || { kind: d.kind, steps: [], done: false };
            S().set({ workflow: { ...S().workflow, [d.trip_id]: { ...cur, kind: d.kind, steps: [...cur.steps.filter((s) => s.idx !== d.idx), d] } } });
            break;
          }
          case "workflow.done": {
            const cur = S().workflow[d.trip_id] || { kind: d.kind, steps: [], done: false };
            S().set({ workflow: { ...S().workflow, [d.trip_id]: { ...cur, kind: d.kind, note: d.note, done: true, proposal: d.proposal } } });
            qc.invalidateQueries({ queryKey: ["trips"] });
            qc.invalidateQueries({ queryKey: ["dashboard"] });
            break;
          }
          case "trip.update":
          case "batch.new":
            S().set({ version: S().version + 1 });
            qc.invalidateQueries();
            break;
          case "reset":
            S().set({ version: S().version + 1, workflow: {}, alerts: [], trucks: {} });
            qc.invalidateQueries();
            break;
          case "mode":
            S().set({ mode: d.mode });
            qc.invalidateQueries({ queryKey: ["integrations"] });
            break;
        }
      };
    };
    connect();
    return () => { stop = true; clearTimeout(timer); ws?.close(); };
  }, [qc]);
}
