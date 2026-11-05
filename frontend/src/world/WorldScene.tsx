import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { CameraControls, PerformanceMonitor } from "@react-three/drei";
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import { Atmosphere, Terrain, envFrom } from "./Environment";
import { Hub, SITES } from "./Hub";
import { Journey, mandiSpots, roadsFor, truckPoses } from "./Journey";
import { makeProjection, sunPosition } from "./geo";
import { api } from "../lib/api";

export type CamView = "auto" | "overview" | "farm" | "trad" | "trad-in" | "adv" | "adv-in" | "grading" | "yard" | "truck" | "mandi";
export type Quality = "high" | "medium" | "low";

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const FIXED: Record<string, [THREE.Vector3, THREE.Vector3]> = {
  overview: [V(95, 85, 125), V(0, 0, -6)],
  farm: [V(-36, 30, 52), V(-66, 0, 0)],
  trad: [V(-24, 16, 18), V(-30, 2.5, -20)],
  "trad-in": [V(-30, 27, 2), V(-30, 0.5, -21)],
  adv: [V(10, 18, 22), V(2, 3, -24)],
  "adv-in": [V(2, 24, -4), V(2, 0.5, -24.5)],
  grading: [V(54, 7.5, 3), V(36, 1.5, -20)],
  yard: [V(28, 22, 52), V(0, 0, 28)],
};

/** Which camera view the current lot stage calls for. */
export function autoView(lot: any): { view: Exclude<CamView, "auto">; ship?: number } {
  if (!lot) return { view: "overview" };
  const moving = (lot.shipments || []).find((s: any) => s.status === "in_transit");
  if (moving) return { view: "truck", ship: moving.id };
  const last = (lot.shipments || []).slice(-1)[0];
  if (last && ["arrived", "delivered"].includes(last.status) && !["grading"].includes(lot.stage)) return { view: "mandi", ship: last.id };
  if (lot.stage === "intake") return { view: lot.mode === "traditional" ? "trad" : "adv" };
  if (lot.stage === "storage") return { view: lot.mode === "traditional" ? "trad-in" : "adv-in" };
  if (lot.stage === "grading" || lot.stage === "graded") return { view: "grading" };
  return { view: "overview" };
}

function Rig({ view, ship, focus }: { view: Exclude<CamView, "auto">; ship?: number; focus: THREE.Vector3 }) {
  const ref = useRef<CameraControls>(null);
  const prev = useRef("");
  const tmpP = useMemo(() => new THREE.Vector3(), []), tmpT = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => { if (ref.current) { ref.current.smoothTime = 0.9; ref.current.maxPolarAngle = Math.PI * 0.47; ref.current.minDistance = 4; ref.current.maxDistance = 900; } }, []);
  useFrame(() => {
    const c = ref.current;
    if (!c) return;
    const key = `${view}:${ship ?? ""}`;
    if (view === "truck" && ship != null) {
      const t = truckPoses.get(ship);
      if (t) {
        const dir = V(Math.sin(t.heading), 0, Math.cos(t.heading));
        tmpP.copy(t.pos).addScaledVector(dir, -26).add(V(0, 13, 0)).add(V(dir.z, 0, -dir.x).multiplyScalar(8));
        tmpT.copy(t.pos).addScaledVector(dir, 10);
        c.setLookAt(tmpP.x, tmpP.y, tmpP.z, tmpT.x, tmpT.y, tmpT.z, true);
      }
    } else if (view === "mandi" && ship != null) {
      const m = mandiSpots.get(ship);
      if (m && prev.current !== key) c.setLookAt(m.x + 34, 28, m.z + 44, m.x, 0, m.z, true);
    } else if (FIXED[view] && prev.current !== key) {
      const [p, t] = FIXED[view];
      c.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, true);
    }
    prev.current = key;
    c.getTarget(focus);
  });
  return <CameraControls ref={ref} makeDefault />;
}

function FirstFrame({ onReady }: { onReady: () => void }) {
  const done = useRef(false);
  useFrame(() => { if (!done.current) { done.current = true; onReady(); } });
  return null;
}

export function WorldScene({ lots, activeLot, view, ship, quality, labels, onQuality, onReady }: {
  lots: any[]; activeLot: any; view: Exclude<CamView, "auto">; ship?: number; quality: Quality; labels: boolean; onQuality: (q: Quality) => void; onReady?: () => void;
}) {
  const focus = useMemo(() => new THREE.Vector3(), []);
  const [geos, setGeos] = useState<Record<number, any>>({});
  const proj = useJourneyData(activeLot, setGeos);
  const live = activeLot?.shipments?.find((s: any) => s.status === "in_transit")?.live;
  const st = activeLot?.storage;
  const simTime = live?.sim_time || st?.sim_time;
  const amb = live?.ambient || st?.ambient;
  const wx = live?.weather_extras || st?.weather_extras || {};
  const loc = activeLot?.location || { lat: 13.0, lng: 77.6 };
  const date = simTime ? new Date(simTime + "Z") : new Date();
  const sun = sunPosition(date, loc.lat, loc.lng);
  const env = envFrom(sun, wx.cloud_pct ?? null, wx.precip_mm ?? null, amb?.rh ?? null);
  const roads = useMemo(() => roadsFor(activeLot, geos, proj), [geos, proj, activeLot?.id]);
  const cutaway = view === "trad-in" ? "trad" : view === "adv-in" ? "adv" : null;
  return (
    <Canvas shadows={quality !== "low"} dpr={quality === "high" ? [1, 2] : [1, 1.25]} gl={{ antialias: false, powerPreference: "high-performance", stencil: false }}
      camera={{ position: [95, 85, 125], fov: 45, near: 0.5, far: 9000 }}>
      <PerformanceMonitor onDecline={() => onQuality(quality === "high" ? "medium" : "low")} flipflops={2} />
      <Suspense fallback={null}>
        <Atmosphere env={env} focus={focus} />
        <Terrain roads={roads} />
        <Hub lots={lots} activeId={activeLot?.id ?? null} cutaway={cutaway} labels={labels && view !== "truck" && view !== "mandi"} night={env.isNight} />
        <Journey lot={activeLot} geos={geos} proj={proj} night={env.isNight} labels={labels} />
      </Suspense>
      <Rig view={view} ship={ship} focus={focus} />
      {onReady && <FirstFrame onReady={onReady} />}
      {quality !== "low" && (
        <EffectComposer multisampling={0}>
          {quality === "high" ? <N8AO halfRes aoRadius={3} intensity={2.2} distanceFalloff={0.6} /> : <></>}
          <Bloom luminanceThreshold={0.85} luminanceSmoothing={0.2} intensity={env.isNight ? 1.4 : 0.5} mipmapBlur />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <Vignette offset={0.25} darkness={0.55} />
          <SMAA />
        </EffectComposer>
      )}
    </Canvas>
  );
}

/** Fetches road geometry for the lot's shipments (refetched on reroute) and builds the shared projection. */
function useJourneyData(lot: any, setGeos: (g: Record<number, any>) => void) {
  const [g, setG] = useState<Record<number, any>>({});
  const ships = lot?.shipments || [];
  const key = ships.map((s: any) => `${s.id}:${s.reroute_count}:${s.checkpoints.filter((c: any) => c.name).length}`).join("|");
  useEffect(() => {
    let live = true;
    Promise.all(ships.map((s: any) => api(`/flow/shipments/${s.id}`).then((x) => [s.id, x] as const).catch(() => null))).then((rows) => {
      if (!live) return;
      const out = Object.fromEntries(rows.filter(Boolean) as any);
      setG(out); setGeos(out);
    });
    return () => { live = false; };
  }, [key, lot?.id]);
  return useMemo(() => {
    if (!lot) return null;
    const { lat, lng } = lot.location;
    let maxM = 20000;
    for (const x of Object.values(g) as any[]) for (const [px, py] of x.original || []) maxM = Math.max(maxM, Math.hypot((px - lng) * Math.cos((lat * Math.PI) / 180) * 111320, (py - lat) * 111320));
    return makeProjection(lat, lng, Math.min(1 / 25, 1900 / maxM));
  }, [lot?.id, Object.keys(g).join(",")]);
}

export { SITES };
