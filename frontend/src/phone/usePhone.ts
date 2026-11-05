import { useEffect, useRef, useState } from "react";
import { API, ApiError, api, wsUrl } from "../lib/api";
import { useAuth } from "../stores/auth";

/** Live station state over WebSocket (authoritative backend payload), with REST fallback. */
export function useStationLive(stationId: number | null, mobile: boolean) {
  const [state, setState] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [connected, setConnected] = useState(false);
  const tries = useRef(0);
  useEffect(() => {
    if (!stationId) return;
    let ws: WebSocket | null = null;
    let stop = false;
    let timer: number | undefined;
    api(`/flow/stations/${stationId}/state`, { mobile }).then(setState).catch(() => undefined);
    const connect = () => {
      ws = new WebSocket(wsUrl(`/ws/station/${stationId}`, mobile));
      ws.onopen = () => { tries.current = 0; setConnected(true); };
      ws.onclose = () => { setConnected(false); if (!stop) timer = window.setTimeout(connect, Math.min(6000, 500 * 2 ** tries.current++)); };
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.type === "station") setState(m);
        if (m.type === "event") setEvents((e) => [...e.slice(-20), { ...m.event, lot_id: m.lot_id, key: Math.random() }]);
      };
    };
    connect();
    return () => { stop = true; clearTimeout(timer); ws?.close(); };
  }, [stationId, mobile]);
  return { state, setState, events, connected };
}

export async function uploadPhotos(path: string, files: File[], mobile: boolean) {
  const fd = new FormData();
  files.forEach((f) => fd.append("files", f));
  const st = useAuth.getState();
  const res = await fetch(API + path, { method: "POST", body: fd, headers: { Authorization: `Bearer ${mobile ? st.mobileToken : st.token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.detail?.message || "Upload failed", data?.detail);
  return data;
}
