import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { asphaltTex, concreteTex, crateTex, metalRoofTex, sackTex } from "./textures";
import { HUB_RADIUS, buildTruckPath, makeProjection, pointOn, polyLength, realToPath, seeded, type V2 } from "./geo";
import { Label } from "./Hub";
import { TruckModel } from "./Vehicles";

/** Live truck poses for the camera rig (shipment id -> world position + heading). */
export const truckPoses = new Map<number, { pos: THREE.Vector3; heading: number }>();
export const mandiSpots = new Map<number, THREE.Vector3>();

function ribbon(points: V2[], width: number, y = 0.06) {
  const cum = polyLength(points);
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const nx = -dz * width / 2, nz = dx * width / 2;
    pos.push(points[i][0] + nx, y, points[i][1] + nz, points[i][0] - nx, y, points[i][1] - nz);
    uv.push(0, cum[i] / (width * 3), 1, cum[i] / (width * 3));
    if (i > 0) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function Road({ points, width = 7, color, dashed = false, y = 0.06, opacity = 1 }: { points: V2[]; width?: number; color?: string; dashed?: boolean; y?: number; opacity?: number }) {
  const geo = useMemo(() => (points.length > 1 ? ribbon(points, width, y) : null), [points, width, y]);
  const tex = useMemo(() => { const t = asphaltTex().clone(); t.needsUpdate = true; return t; }, []);
  if (!geo) return null;
  return (
    <mesh geometry={geo} receiveShadow>
      {color ? <meshBasicMaterial color={color} transparent opacity={dashed ? 0.45 : opacity} depthWrite={false} side={THREE.DoubleSide} /> : <meshStandardMaterial map={tex} roughness={0.95} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-2} />}
    </mesh>
  );
}

function Gantry({ position, heading, name, passed, labels }: { position: [number, number, number]; heading: number; name: string; passed: boolean; labels: boolean }) {
  return (
    <group position={position} rotation={[0, heading, 0]}>
      {[-5, 5].map((x) => <mesh key={x} position={[x, 3, 0]} castShadow><boxGeometry args={[0.35, 6, 0.35]} /><meshStandardMaterial color="#3a3f47" /></mesh>)}
      <mesh position={[0, 6.1, 0]} castShadow><boxGeometry args={[10.6, 1.2, 0.3]} /><meshStandardMaterial color={passed ? "#2e6b45" : "#1f4a8a"} emissive={passed ? "#2e6b45" : "#1f4a8a"} emissiveIntensity={0.4} /></mesh>
      <Label position={[0, 8.2, 0]} show={labels}>{passed ? "✓ " : ""}{name}</Label>
    </group>
  );
}

function Barricade({ position, heading }: { position: [number, number, number]; heading: number }) {
  const light = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((st) => { if (light.current) light.current.emissiveIntensity = Math.sin(st.clock.elapsedTime * 8) > 0 ? 8 : 0.5; });
  return (
    <group position={position} rotation={[0, heading, 0]}>
      {[-2.4, 0, 2.4].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh position={[0, 0.7, 0]} castShadow><boxGeometry args={[2.2, 0.5, 0.25]} /><meshStandardMaterial color="#e84a2c" /></mesh>
          <mesh position={[0, 0.7, 0.13]}><boxGeometry args={[0.5, 0.5, 0.02]} /><meshStandardMaterial color="#ffffff" /></mesh>
          {[-0.9, 0.9].map((lx) => <mesh key={lx} position={[lx, 0.35, 0]}><boxGeometry args={[0.12, 0.7, 0.12]} /><meshStandardMaterial color="#ddd" /></mesh>)}
        </group>
      ))}
      <mesh position={[0, 1.3, 0]}><sphereGeometry args={[0.22]} /><meshStandardMaterial ref={light} color="#ff3b1f" emissive="#ff3b1f" emissiveIntensity={5} /></mesh>
      <mesh position={[3.5, 0.6, 2]} rotation={[0, 0.6, 0]} castShadow><boxGeometry args={[2.5, 1.2, 4.5]} /><meshStandardMaterial color="#5b616b" /></mesh>
    </group>
  );
}

function Mandi({ position, name, labels, night, people = 26 }: { position: [number, number, number]; name: string; labels: boolean; night: boolean; people?: number }) {
  const crowd = useRef<THREE.Group>(null);
  const r = useMemo(() => seeded(name.length * 13), [name]);
  const folk = useMemo(() => Array.from({ length: people }, () => ({ x: (r() - 0.5) * 26, z: (r() - 0.5) * 18, c: ["#c0392b", "#2e86de", "#F3EEE8", "#e1b12c", "#6c5ce7", "#0a3d62"][Math.floor(r() * 6)], p: r() * 6 })), [people, r]);
  useFrame((st) => {
    crowd.current?.children.forEach((c, i) => { c.position.y = 0.9 + Math.abs(Math.sin(st.clock.elapsedTime * 2 + folk[i].p)) * 0.08; c.position.x = folk[i].x + Math.sin(st.clock.elapsedTime * 0.3 + folk[i].p) * 1.5; });
  });
  return (
    <group position={position}>
      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[44, 34]} /><meshStandardMaterial map={concreteTex()} /></mesh>
      {[-13, 0, 13].map((x) => (
        <group key={x} position={[x, 0, -8]}>
          {[-5, 5].flatMap((dx) => [-3, 3].map((dz) => <mesh key={`${dx}${dz}`} position={[dx, 2.5, dz]}><boxGeometry args={[0.25, 5, 0.25]} /><meshStandardMaterial color="#555" /></mesh>))}
          <mesh position={[0, 5.2, 0]} castShadow><boxGeometry args={[11, 0.25, 7.5]} /><meshStandardMaterial map={metalRoofTex()} /></mesh>
          {Array.from({ length: 6 }, (_, i) => <mesh key={i} position={[-4 + (i % 3) * 4, 0.45, -1.5 + Math.floor(i / 3) * 3]} castShadow><boxGeometry args={[2.6, 0.9, 1.4]} /><meshStandardMaterial color={["#d6402c", "#e8a93a", "#e5c640", "#5FB37C"][i % 4]} /></mesh>)}
        </group>
      ))}
      <group ref={crowd}>{folk.map((f, i) => <mesh key={i} position={[f.x, 0.9, f.z]} castShadow><capsuleGeometry args={[0.28, 1.0, 4, 8]} /><meshStandardMaterial color={f.c} /></mesh>)}</group>
      <mesh position={[0, 7.5, 6]}><boxGeometry args={[16, 2, 0.3]} /><meshStandardMaterial color="#0A2624" emissive="#FF684A" emissiveIntensity={night ? 0.6 : 0.05} /></mesh>
      <Label position={[0, 11, 6]} show={labels}><span className="text-gold">{name}</span></Label>
    </group>
  );
}

function ShipmentVisual({ ship, geo, proj, night, labels, commodity }: { ship: any; geo: any; proj: ReturnType<typeof makeProjection>; night: boolean; labels: boolean; commodity: string }) {
  const lv = ship.live || {};
  const toV = (g: number[][]) => g.map(([x, y]) => proj.toXZ(y, x)) as V2[];
  const current = useMemo(() => toV(geo.current || []), [geo.current, proj]);
  const original = useMemo(() => toV(geo.original || []), [geo.original, proj]);
  const tp = useMemo(() => {
    if (current.length < 2) return null;
    if (Math.hypot(current[0][0], current[0][1]) > HUB_RADIUS + 2) {   // rerouted geometry starts on the road, not at the hub
      const cum = polyLength(current);
      return { path: current, cum, hubLen: 0, realCum: cum, realExitIdx: 0 };
    }
    return buildTruckPath(current);
  }, [current]);
  const group = useRef<THREE.Group>(null);
  const shown = useRef<number | null>(null);
  const dist = useRef(0);
  const lastKey = useRef("");
  const dest = proj.toXZ(ship.destination.lat, ship.destination.lng);
  const frac = lv.route && lv.route.distance_m ? Math.min(1, lv.route.progress_m / lv.route.distance_m) : ship.status === "in_transit" ? 0 : 1;
  useFrame((_, dt) => {
    if (!tp || !group.current) return;
    const key = `${ship.reroute_count}`;
    const target = realToPath(frac * tp.realCum[tp.realCum.length - 1], tp);
    if (lastKey.current !== key || shown.current == null || target < shown.current - 50) { shown.current = target; lastKey.current = key; }
    const before = shown.current;
    shown.current += (target - shown.current) * Math.min(1, dt * 2.2);
    dist.current += Math.abs(shown.current - before);
    const p = pointOn(tp.path, tp.cum, shown.current);
    const ahead = pointOn(tp.path, tp.cum, shown.current + 4);
    const heading = Math.atan2(ahead.x - p.x, ahead.z - p.z);
    group.current.position.set(p.x, 0, p.z);
    const cur = group.current.rotation.y;
    let dh = heading - cur; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    group.current.rotation.y = cur + dh * Math.min(1, dt * 5);
    truckPoses.set(ship.id, { pos: group.current.position.clone(), heading: group.current.rotation.y });
  });
  useEffect(() => { mandiSpots.set(ship.id, new THREE.Vector3(dest[0], 0, dest[1])); }, [dest[0], dest[1], ship.id]);
  const roadPts = tp ? tp.path : [];
  const zones = lv.readings?.zone_temperatures_c;
  const cps = geo.checkpoints || ship.checkpoints || [];
  return (
    <group>
      {/* the road the truck is on (with the in-hub link) */}
      <Road points={roadPts} />
      {/* original plan shown faintly after a reroute */}
      {ship.reroute_count > 0 && original.length > 1 && <Road points={original} width={2.5} color="#8a9099" y={0.09} opacity={0.3} />}
      {(geo.reroutes || []).map((r: any, i: number) => {
        const old = toV(r.old_geometry || []);
        const [bx, bz] = proj.toXZ(r.blocked[0], r.blocked[1]);
        const k = old.findIndex(([x, z]) => Math.hypot(x - bx, z - bz) < 6);
        const pa = old[Math.max(0, k - 1)] || [bx, bz + 1], pb = old[Math.min(old.length - 1, k + 1)] || [bx, bz];
        return (
          <group key={i}>
            <Road points={old} width={2.2} color="#EB4D3D" dashed y={0.1} />
            <Barricade position={[bx, 0, bz]} heading={Math.atan2(pb[0] - pa[0], pb[1] - pa[1])} />
            <Label position={[bx, 6, bz]} show={labels}><span className="text-critical">Road blocked</span> · reroute +{r.added_km} km</Label>
          </group>
        );
      })}
      {cps.map((c: any, i: number) => {
        const [x, z] = proj.toXZ(c.lat, c.lng);
        const near = (original.length > 1 ? original : current);
        let best = 0, bd = Infinity;
        near.forEach(([px, pz], j) => { const d = Math.hypot(px - x, pz - z); if (d < bd) { bd = d; best = j; } });
        const a = near[Math.max(0, best - 1)] || [x, z], b = near[Math.min(near.length - 1, best + 1)] || [x, z + 1];
        return <Gantry key={i} position={[x, 0, z]} heading={Math.atan2(b[1] - a[1], b[0] - a[0]) * -1 + Math.PI / 2} name={c.name || `km ${Math.round(c.km)}`} passed={c.passed} labels={labels} />;
      })}
      <Mandi position={[dest[0], 0, dest[1]]} name={ship.destination.name} labels={labels} night={night} />
      {ship.status !== "in_transit" && (
        <group position={[dest[0] + 6, 0, dest[1] + 12]}>
          {Array.from({ length: Math.round(18 * (ship.status === "delivered" ? 1 : ship.unload_progress)) }, (_, i) => (
            <mesh key={i} position={[(i % 6) * 1.2, 0.4 + Math.floor(i / 6) * 0.8, 0]} castShadow>
              {ship.grade === "ALL" ? <boxGeometry args={[1.1, 0.75, 0.8]} /> : <sphereGeometry args={[0.5, 10, 8]} />}
              <meshStandardMaterial map={ship.grade === "ALL" ? crateTex() : sackTex()} />
            </mesh>
          ))}
        </group>
      )}
      <group ref={group}>
        <TruckModel refrigerated={!!lv.refrigerated} zones={zones} setpoint={lv.setpoint} coolingOn={(lv.flows?.q_cool_w ?? 0) > 0} doorOpen={!!lv.equipment?.door_open} night={night} distRef={dist} cargo={ship.grade === "ALL" ? "crates" : "bags"} />
        <Label position={[0, 6.5, 0]} show={labels}>
          <span className="text-gold">{ship.grade === "ALL" ? commodity : ship.grade}</span> · {lv.total_done_km?.toFixed(1)} / {lv.total_km?.toFixed(1)} km<br />
          {lv.refrigerated ? <>reefer · cargo {(lv.readings?.max_zone_c ?? lv.readings?.temperature_c)?.toFixed(1)} °C · Q {lv.produce?.quality?.toFixed(1)}</> : <>open truck</>}{lv.route?.delay_remaining_s > 0 ? " · STOPPED" : ""}
        </Label>
      </group>
    </group>
  );
}

export function Journey({ lot, geos, proj, night, labels }: { lot: any; geos: Record<number, any>; proj: ReturnType<typeof makeProjection> | null; night: boolean; labels: boolean }) {
  if (!lot || !proj) return null;
  return (
    <group>
      {(lot.shipments || []).map((s: any) => geos[s.id]?.current ? <ShipmentVisual key={s.id} ship={s} geo={geos[s.id]} proj={proj} night={night} labels={labels} commodity={lot.commodity} /> : null)}
    </group>
  );
}

export function roadsFor(lot: any, geos: Record<number, any>, proj: ReturnType<typeof makeProjection> | null): V2[][] {
  if (!lot || !proj) return [];
  return Object.values(geos).flatMap((g: any) => [g.original, g.current].filter(Boolean).map((geom: number[][]) => geom.map(([x, y]) => proj.toXZ(y, x)) as V2[]));
}
