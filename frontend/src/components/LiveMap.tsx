import { useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { GeoJsonLayer, PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { TripsLayer } from "@deck.gl/geo-layers";
import { PathStyleExtension } from "@deck.gl/extensions";
import { Map as MapGL } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { qualityRGB } from "../lib/format";
import { useLive } from "../stores/live";

const STYLES = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
};
const TRAIL_S = 2400;

type Trip = { id: string; batch_id: string; route: [number, number][]; duration_s: number; ghost_route?: [number, number][] | null; rerouted?: boolean; is_scenario?: boolean; status: string };

function cumulative(route: [number, number][]) {
  const out = [0];
  for (let i = 1; i < route.length; i++) {
    const [a, b] = [route[i - 1], route[i]];
    const dx = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
    const dy = b[1] - a[1];
    out.push(out[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  return out;
}

function pointAlong(route: [number, number][], cum: number[], frac: number): [number, number] {
  const total = cum[cum.length - 1];
  if (!total || route.length < 2) return route[0];
  const t = Math.max(0, Math.min(1, frac)) * total;
  let lo = 0, hi = cum.length - 1;
  while (lo < hi - 1) { const m = (lo + hi) >> 1; if (cum[m] <= t) lo = m; else hi = m; }
  const seg = cum[hi] - cum[lo] || 1;
  const f = (t - cum[lo]) / seg;
  return [route[lo][0] + (route[hi][0] - route[lo][0]) * f, route[lo][1] + (route[hi][1] - route[lo][1]) * f];
}

/** Checks once whether the Carto basemap is reachable; otherwise the map runs on the bundled offline outline. */
function useTilesOnline() {
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3500);
    fetch(STYLES.light, { signal: ctrl.signal }).then((r) => setOnline(r.ok)).catch(() => setOnline(false)).finally(() => clearTimeout(t));
    return () => ctrl.abort();
  }, []);
  return [online, setOnline] as const;
}

export function LiveMap({ trips, facilities = [], stored = [], dark = false, onPick, focusTrip, height = "100%", districts }: {
  trips: Trip[]; facilities?: any[]; stored?: any[]; dark?: boolean; onPick?: (batchId: string, kind: string) => void; focusTrip?: string | null;
  height?: number | string; districts?: any[];
}) {
  const [online, setOnline] = useTilesOnline();
  const { data: outline } = useQuery({ queryKey: ["outline"], queryFn: () => api("/geo/outline"), staleTime: Infinity });
  const trucks = useLive((s) => s.trucks);
  const simNow = useLive((s) => s.simNow);
  const tickAt = useLive((s) => s.tickAt);
  const mpt = useLive((s) => s.minutesPerTick);
  const [, setFrame] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    let last = 0;
    const loop = (t: number) => { if (t - last > 33) { last = t; setFrame((f) => (f + 1) % 1e6); } raf.current = requestAnimationFrame(loop); };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  const geom = useMemo(() => {
    const m = new Map<string, { cum: number[]; ghostCum?: number[] }>();
    for (const t of trips) m.set(t.id, { cum: cumulative(t.route), ghostCum: t.ghost_route ? cumulative(t.ghost_route) : undefined });
    return m;
  }, [trips]);

  const simSecAtTick = simNow ? Date.parse(simNow) / 1000 : 0;
  const elapsed = Math.min(1.4, (performance.now() - tickAt) / 1000);
  const curSim = simSecAtTick + elapsed * mpt * 60;

  const live = trips.filter((t) => t.status === "in_transit" && trucks[t.id]).map((t) => {
    const tr = trucks[t.id];
    const g = geom.get(t.id)!;
    const offset = Math.round((simSecAtTick - tr.progress_s) / 30) * 30;
    const frac = Math.min(1, (curSim - (simSecAtTick - tr.progress_s)) / (t.duration_s || 1));
    const pos = pointAlong(t.route, g.cum, frac);
    const total = g.cum[g.cum.length - 1] || 1;
    let ghost: [number, number] | null = null;
    if (tr.ghost && t.ghost_route && g.ghostCum) ghost = pointAlong(t.ghost_route, g.ghostCum, tr.ghost.frac);
    return { trip: t, truck: tr, pos, ghost, offset, timestamps: g.cum.map((c) => (c / total) * t.duration_s + offset) };
  });

  const bg = dark ? [15, 26, 23] : [247, 243, 232];
  const layers: any[] = [];
  if (!online && outline) {
    layers.push(new GeoJsonLayer({ id: "outline", data: outline, stroked: true, filled: true, getFillColor: dark ? [26, 45, 39, 255] : [238, 231, 212, 255],
      getLineColor: dark ? [111, 138, 110, 200] : [111, 138, 110, 255], lineWidthMinPixels: 1.5 }));
  }
  if (districts?.length) {
    const maxV = Math.max(1, ...districts.map((d: any) => d.value_at_risk));
    layers.push(new ScatterplotLayer({ id: "districts", data: districts, getPosition: (d: any) => [d.lng, d.lat], radiusUnits: "meters",
      getRadius: (d: any) => 9000 + 26000 * Math.sqrt(d.value_at_risk / maxV), stroked: true, lineWidthMinPixels: 1,
      getFillColor: (d: any) => (d.exposure_pct > 60 ? [194, 70, 59, 150] : d.exposure_pct > 30 ? [217, 154, 43, 150] : [62, 142, 90, 140]),
      getLineColor: [255, 255, 255, 200], pickable: true }));
    layers.push(new TextLayer({ id: "district-labels", data: districts, getPosition: (d: any) => [d.lng, d.lat], getText: (d: any) => d.name, getSize: 11,
      getColor: [43, 43, 43, 230], getPixelOffset: [0, -16], fontFamily: "Inter, sans-serif", fontWeight: 600 }));
  }
  layers.push(new PathLayer({ id: "routes", data: trips.filter((t) => t.status === "in_transit"), getPath: (d: Trip) => d.route, widthMinPixels: 1.5,
    getColor: (d: Trip) => (d.id === focusTrip ? (dark ? [217, 154, 43, 200] : [31, 77, 58, 200]) : dark ? [80, 110, 100, 110] : [111, 138, 110, 120]) }));
  layers.push(new PathLayer({ id: "ghost-routes", data: trips.filter((t) => t.ghost_route), getPath: (d: Trip) => d.ghost_route!, widthMinPixels: 2,
    getColor: [200, 200, 200, 150], getDashArray: [4, 4], dashJustified: true, extensions: [new PathStyleExtension({ dash: true })] }));
  layers.push(new TripsLayer({ id: "trails", data: live, getPath: (d: any) => d.trip.route, getTimestamps: (d: any) => d.timestamps,
    getColor: (d: any) => qualityRGB(d.truck.quality), widthMinPixels: 4, capRounded: true, jointRounded: true, trailLength: TRAIL_S, currentTime: curSim,
    fadeTrail: true, updateTriggers: { getTimestamps: live.map((l) => l.offset).join(","), getColor: live.map((l) => Math.round(l.truck.quality)).join(",") } }));
  layers.push(new ScatterplotLayer({ id: "facilities", data: facilities, getPosition: (d: any) => [d.lng, d.lat], radiusUnits: "pixels",
    getRadius: (d: any) => (d.type === "mandi" ? 6 : 5), stroked: true, lineWidthMinPixels: 2, pickable: true,
    getFillColor: (d: any) => (d.type === "mandi" ? (dark ? [247, 243, 232, 255] : [255, 255, 255, 255]) : [56, 152, 214, 255]),
    getLineColor: (d: any) => (d.type === "mandi" ? [31, 77, 58, 255] : [255, 255, 255, 255]) }));
  layers.push(new TextLayer({ id: "facility-labels", data: online ? [] : facilities.filter((f: any) => f.type === "mandi"), getPosition: (d: any) => [d.lng, d.lat],
    getText: (d: any) => d.name.replace(" APMC", ""), getSize: 11, getColor: dark ? [197, 212, 196, 220] : [31, 77, 58, 220], getPixelOffset: [0, 14],
    fontFamily: "Inter, sans-serif", fontWeight: 600 }));
  layers.push(new ScatterplotLayer({ id: "stored", data: stored, pickable: true, radiusUnits: "pixels", getRadius: (d: any) => (d.is_judge ? 9 : 6),
    getPosition: (d: any) => [d.lng + ((d.id.charCodeAt(d.id.length - 1) % 7) - 3) * 0.03, d.lat + ((d.id.charCodeAt(d.id.length - 2) % 5) - 2) * 0.03],
    getFillColor: (d: any) => [...qualityRGB(d.quality), 230], stroked: true, getLineColor: (d: any) => (d.is_judge ? [217, 154, 43, 255] : [255, 255, 255, 220]),
    lineWidthMinPixels: 2, updateTriggers: { getFillColor: stored.map((s: any) => Math.round(s.quality)).join(",") } }));
  layers.push(new ScatterplotLayer({ id: "ghosts", data: live.filter((l) => l.ghost), getPosition: (d: any) => d.ghost, radiusUnits: "pixels", getRadius: 8,
    getFillColor: [210, 210, 210, 110], stroked: true, getLineColor: [255, 255, 255, 160], lineWidthMinPixels: 1.5 }));
  layers.push(new ScatterplotLayer({ id: "halo", data: live.filter((l) => l.truck.reefer_status === "failed" || l.trip.id === focusTrip || l.truck.is_judge),
    getPosition: (d: any) => d.pos, radiusUnits: "pixels", getRadius: 13 + (Math.sin(performance.now() / 250) + 1) * 3, filled: false, stroked: true,
    getLineColor: (d: any) => (d.truck.reefer_status === "failed" ? [194, 70, 59, 230] : [217, 154, 43, 230]), lineWidthMinPixels: 2 }));
  layers.push(new ScatterplotLayer({ id: "trucks", data: live, getPosition: (d: any) => d.pos, radiusUnits: "pixels", getRadius: (d: any) => (d.trip.is_scenario ? 8 : 6.5),
    getFillColor: (d: any) => qualityRGB(d.truck.quality), stroked: true, getLineColor: dark ? [15, 26, 23, 255] : [255, 255, 255, 255], lineWidthMinPixels: 2, pickable: true,
    updateTriggers: { getFillColor: live.map((l) => Math.round(l.truck.quality)).join(",") } }));

  const tooltip = ({ object, layer }: any) => {
    if (!object) return null;
    const style = { backgroundColor: dark ? "#14231F" : "#fff", color: dark ? "#F7F3E8" : "#2B2B2B", fontSize: "12px", borderRadius: "8px", padding: "8px 10px", boxShadow: "0 4px 16px rgba(0,0,0,0.2)" };
    if (layer.id === "trucks") {
      const t = object.truck;
      return { html: `<b>${t.id}</b> · ${t.produce}<br/>Quality ${t.quality}% · to ${t.dest_name}<br/>${t.reefer ? `Reefer ${t.reefer_status.toUpperCase()} · ${t.cargo_temp ?? "-"} °C` : `Open truck · ${t.cargo_temp ?? "-"} °C`}<br/><span style="opacity:.6">SIMULATED feed · click for twin</span>`, style };
    }
    if (layer.id === "facilities") return { html: `<b>${object.name}</b><br/>${object.type === "mandi" ? "Mandi" : `Cold storage · ${Math.round(object.capacity_t - object.used_t)} t free`}`, style };
    if (layer.id === "stored") return { html: `<b>${object.id}</b> · ${object.produce}<br/>Quality ${object.quality}% · ${object.status}<br/><span style="opacity:.6">click for twin</span>`, style };
    if (layer.id === "districts") return { html: `<b>${object.name}</b><br/>${object.batches} batches · exposure ${object.exposure_pct}%`, style };
    return null;
  };

  return (
    <div style={{ height, position: "relative", background: `rgb(${bg.join(",")})` }} className="overflow-hidden">
      <DeckGL initialViewState={{ longitude: 76.3, latitude: 14.4, zoom: 6.1, pitch: 0 }} controller layers={layers} getTooltip={tooltip}
        onClick={(info: any) => {
          if (!info.object || !onPick) return;
          if (info.layer?.id === "trucks") onPick(info.object.truck.batch_id, "truck");
          if (info.layer?.id === "stored") onPick(info.object.id, "batch");
        }}>
        {online && <MapGL mapStyle={dark ? STYLES.dark : STYLES.light} onError={() => setOnline(false)} attributionControl={true} />}
      </DeckGL>
      {online === false && (
        <div className={`absolute bottom-2 left-2 rounded-md px-2 py-1 text-[10px] ${dark ? "bg-night-700 text-sage-500" : "bg-white/80 text-charcoal-500"}`}>
          Offline map: basemap tiles unavailable · Karnataka outline © OpenStreetMap
        </div>
      )}
    </div>
  );
}
