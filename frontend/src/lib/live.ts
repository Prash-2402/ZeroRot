import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { wsUrl } from "./api";
import { useToasts } from "../stores/auth";

/** Subscribes to the authoritative simulation state over WebSocket (reconnects with backoff). */
export function useSimulationLive(simId: number | null | undefined, mobile = false) {
  const [msg, setMsg] = useState<any>(null);
  const [connected, setConnected] = useState(false);
  const qc = useQueryClient();
  const retry = useRef(0);
  useEffect(() => {
    if (!simId) return;
    let ws: WebSocket | null = null;
    let stop = false;
    let timer: number | undefined;
    const connect = () => {
      ws = new WebSocket(wsUrl(`/ws/simulations/${simId}`, mobile));
      ws.onopen = () => { retry.current = 0; setConnected(true); };
      ws.onclose = () => { setConnected(false); if (!stop) timer = window.setTimeout(connect, Math.min(8000, 600 * 2 ** retry.current++)); };
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.type === "state") setMsg(m);
        if (m.type === "alert") qc.invalidateQueries({ queryKey: ["alerts"] });
      };
    };
    connect();
    return () => { stop = true; clearTimeout(timer); ws?.close(); };
  }, [simId, mobile, qc]);
  return { msg, connected };
}

/** Global alert stream for dashboard users: toasts + cache invalidation. */
export function useAlertStream(enabled: boolean) {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let stop = false;
    let timer: number | undefined;
    let tries = 0;
    const connect = () => {
      ws = new WebSocket(wsUrl("/ws/alerts"));
      ws.onopen = () => { tries = 0; setConnected(true); };
      ws.onclose = () => { setConnected(false); if (!stop) timer = window.setTimeout(connect, Math.min(8000, 600 * 2 ** tries++)); };
      ws.onmessage = (ev) => {
        const a = JSON.parse(ev.data);
        push({ title: `${a.severity} · ${a.title}`, body: a.message, tone: a.severity === "CRITICAL" ? "critical" : a.severity === "WARNING" ? "warning" : "info" });
        qc.invalidateQueries({ queryKey: ["alerts"] });
        qc.invalidateQueries({ queryKey: ["summary"] });
      };
    };
    connect();
    return () => { stop = true; clearTimeout(timer); ws?.close(); };
  }, [enabled, qc, push]);
  return connected;
}
