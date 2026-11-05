import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { tempColor } from "../lib/format";
import { Airflow, Crate, Scene, SensorTag } from "./common";

function crateGrid(n: number, w: number, d: number, start: [number, number]) {
  const out: [number, number, number][] = [];
  const perRow = Math.max(1, Math.floor(w / 0.7)), perCol = Math.max(1, Math.floor(d / 0.5));
  for (let i = 0; i < n; i++) {
    const layer = Math.floor(i / (perRow * perCol)), k = i % (perRow * perCol);
    out.push([start[0] + (k % perRow) * 0.7, layer * 0.42, start[1] + Math.floor(k / perRow) * 0.5]);
  }
  return out;
}

function sensorColor(kind: string, v: number, ref: number) {
  if (kind === "temperature") return tempColor(v, ref);
  if (kind === "oxygen") return v < 3 ? "#EB4D3D" : "#7FC4FF";
  if (kind === "co2") return v > 3 ? "#F2994A" : "#7FC4FF";
  return "#FF684A";
}

/** Traditional storage room: masonry walls (front cut away), door, vents, produce crates and virtual sensors. */
function TraditionalRoomInner({ live, cfg, refTemp }: { live: any; cfg: any; refTemp: number }) {
  const [L, W, H] = cfg?.dimensions_m || [8, 6, 3.5];
  const s = 0.75;
  const l = L * s, w = W * s, h = H * s;
  const eq = live?.equipment || {};
  const t = live?.readings?.temperature_c ?? refTemp;
  const crates = Math.min(48, Math.max(6, Math.round((cfg?.batch?.quantity_kg || 500) / 50)));
  const spots = useMemo(() => crateGrid(crates, l * 0.6, w * 0.6, [-l * 0.3, -w * 0.25]), [crates, l, w]);
  const door = useRef<THREE.Group>(null);
  useFrame(() => { if (door.current) door.current.rotation.y += ((eq.door_open ? -1.3 : 0) - door.current.rotation.y) * 0.08; });
  const wall = "#8B7660";
  const ach = live?.flows?.ach ?? 1;
  return (
    <>
      <mesh receiveShadow position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[l, w]} /><meshStandardMaterial color="#6B655C" /></mesh>
      <mesh position={[0, h / 2, -w / 2]} receiveShadow><boxGeometry args={[l, h, 0.2]} /><meshStandardMaterial color={wall} /></mesh>
      <mesh position={[-l / 2, h / 2, 0]}><boxGeometry args={[0.2, h, w]} /><meshStandardMaterial color={wall} /></mesh>
      <mesh position={[l / 2, h / 2, 0]}><boxGeometry args={[0.2, h, w]} /><meshStandardMaterial color={wall} transparent opacity={0.35} /></mesh>
      <mesh position={[0, h + 0.05, 0]}><boxGeometry args={[l + 0.3, 0.1, w + 0.3]} /><meshStandardMaterial color="#5A5048" transparent opacity={0.25} /></mesh>
      {/* vents (open: gold louvers) */}
      {[-l * 0.25, l * 0.25].map((x) => (
        <mesh key={x} position={[x, h * 0.8, -w / 2 + 0.11]}><boxGeometry args={[0.8, 0.35, 0.04]} /><meshStandardMaterial color={eq.vents_open ? "#FF684A" : "#3A3F47"} /></mesh>
      ))}
      <group ref={door} position={[l / 2, 0, w * 0.15]}>
        <mesh position={[0, h * 0.4, -0.6]}><boxGeometry args={[0.08, h * 0.8, 1.2]} /><meshStandardMaterial color="#4A3A2A" /></mesh>
      </group>
      {spots.map((p, i) => <Crate key={i} position={p} commodity={cfg?.batch?.commodity} quality={live?.produce?.quality ?? 90} />)}
      <Airflow size={[l * 0.95, h * 0.9, w * 0.9]} speed={0.15 + Math.min(3, ach) * 0.35} color={tempColor(t, refTemp)} />
      {(live?.sensors || []).filter((x: any) => x.position).map((x: any, i: number) => (
        <SensorTag key={x.id} position={[(-0.4 + (i / 5)) * l * 0.8, h * 0.45 + (i % 2) * h * 0.3, -w / 2 + 0.3]} label={x.id} unit={x.unit === "degC" ? "°C" : x.kind === "pressure" ? "hPa" : x.kind === "vents" || x.kind === "door" ? "" : x.unit}
          value={x.kind === "pressure" ? (x.value / 100).toFixed(0) : x.kind === "vents" ? (x.value ? "open" : "closed") : Number(x.value).toFixed(x.kind === "co2" ? 3 : 1)}
          color={sensorColor(x.kind, x.value, refTemp)} />
      ))}
    </>
  );
}

/** Industrial cold room: insulated panels, racks, evaporator with fan, cooling airflow, door, sensors. */
export function TraditionalRoom(props: { live: any; cfg: any; refTemp: number }) {
  const [L, W, H] = props.cfg?.dimensions_m || [8, 6, 3.5];
  const s = 0.75;
  return <Scene camera={[L * s * 0.9, H * s * 1.6, W * s * 1.9]} target={[0, H * s * 0.35, 0]}><TraditionalRoomInner {...props} /></Scene>;
}

function ColdRoomInner({ live, cfg, setpoint }: { live: any; cfg: any; setpoint: number }) {
  const eq = live?.equipment || {};
  const t = live?.readings?.temperature_c ?? setpoint;
  const cooling = (live?.flows?.q_cool_w ?? 0) > 0;
  const fan = useRef<THREE.Mesh>(null);
  const door = useRef<THREE.Group>(null);
  const qCool = live?.flows?.q_cool_w ?? 0;
  useFrame((_, dt) => {
    if (fan.current) fan.current.rotation.z += dt * (cooling ? 4 + qCool / 1500 : 0);
    if (door.current) door.current.position.x += ((eq.door_open ? 1.6 : 0) - door.current.position.x) * 0.06;
  });
  const crates = Math.min(54, Math.max(6, Math.round((cfg?.batch?.quantity_kg || 1000) / 60)));
  const racks = [-2.4, 0, 2.4];
  const tint = tempColor(t, setpoint);
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[9, 7]} /><meshStandardMaterial color="#C9CDD2" /></mesh>
      <mesh position={[0, 1.75, -3.5]}><boxGeometry args={[9, 3.5, 0.15]} /><meshStandardMaterial color="#E7EBEE" /></mesh>
      <mesh position={[-4.5, 1.75, 0]}><boxGeometry args={[0.15, 3.5, 7]} /><meshStandardMaterial color="#E7EBEE" /></mesh>
      <mesh position={[4.5, 1.75, 0]}><boxGeometry args={[0.15, 3.5, 7]} /><meshStandardMaterial color="#E7EBEE" transparent opacity={0.3} /></mesh>
      {/* temperature tint volume */}
      <mesh position={[0, 1.75, 0]}><boxGeometry args={[8.8, 3.4, 6.8]} /><meshBasicMaterial color={tint} transparent opacity={0.07} depthWrite={false} /></mesh>
      {/* evaporator */}
      <group position={[0, 3.0, -3.25]}>
        <mesh><boxGeometry args={[3, 0.6, 0.45]} /><meshStandardMaterial color={eq.cooling_failed ? "#5B616B" : "#9AA7B0"} /></mesh>
        <mesh ref={fan} position={[0, 0, 0.24]}><circleGeometry args={[0.24, 6]} /><meshStandardMaterial color="#1A1D22" /></mesh>
        <mesh position={[1.3, 0.2, 0.24]}><sphereGeometry args={[0.06]} /><meshStandardMaterial color={eq.cooling_failed ? "#EB4D3D" : "#5FB37C"} emissive={eq.cooling_failed ? "#EB4D3D" : "#5FB37C"} /></mesh>
      </group>
      {racks.map((x) => (
        <group key={x} position={[x, 0, -1]}>
          {[0, 1, 2].map((lvl) => <mesh key={lvl} position={[0, 0.05 + lvl * 0.9, 0]}><boxGeometry args={[1.8, 0.05, 2.4]} /><meshStandardMaterial color="#5B616B" /></mesh>)}
          {[[-0.88, -1.18], [0.88, -1.18], [-0.88, 1.18], [0.88, 1.18]].map(([a, b], i) => <mesh key={i} position={[a, 1.2, b]}><boxGeometry args={[0.05, 2.4, 0.05]} /><meshStandardMaterial color="#3A3F47" /></mesh>)}
        </group>
      ))}
      {Array.from({ length: crates }, (_, i) => {
        const r = racks[i % 3], lvl = Math.floor(i / 18) % 3, k = Math.floor(i / 3) % 6;
        return <Crate key={i} position={[r - 0.55 + (k % 2) * 1.1 - 0.0, 0.08 + lvl * 0.9, -1.9 + Math.floor(k / 2) * 0.8]} commodity={cfg?.batch?.commodity} quality={live?.produce?.quality ?? 90} />;
      })}
      {cooling && <Airflow size={[8, 0.6, 5.5]} speed={0.6 + qCool / 6000} color="#7FC4FF" origin={[0, 2.4, 0]} count={220} />}
      <group ref={door} position={[0, 0, 3.45]}><mesh position={[2.6, 1.3, 0]}><boxGeometry args={[1.6, 2.6, 0.12]} /><meshStandardMaterial color="#D2D7DC" /></mesh></group>
      {(live?.sensors || []).filter((x: any) => x.position && x.kind !== "power").map((x: any) => (
        <SensorTag key={x.id} position={[x.position[0], Math.max(0.6, x.position[1] + 0.3), x.position[2]]} label={x.id} unit={x.unit === "degC" ? "°C" : x.kind === "pressure" ? "hPa" : x.kind === "vents" || x.kind === "door" ? "" : x.unit}
          value={x.kind === "pressure" ? (x.value / 100).toFixed(0) : x.kind === "door" ? (x.value ? "open" : "closed") : Number(x.value).toFixed(x.kind === "co2" ? 3 : 1)}
          color={sensorColor(x.kind, x.value, setpoint)} />
      ))}
    </>
  );
}

export function ColdRoom(props: { live: any; cfg: any; setpoint: number }) {
  return <Scene camera={[7, 6, 9]} target={[0, 1.4, 0]}><ColdRoomInner {...props} /></Scene>;
}
