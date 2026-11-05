import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { tempColor } from "../lib/format";
import { Airflow, Crate, Scene, SensorTag } from "./common";

const BOX_L = 6.4, BOX_W = 2.4, BOX_H = 2.5;

/** Temperature at a position along the cargo box, linearly interpolated between zone centres (front -> rear). */
function tempAt(x: number, zones: number[]) {
  if (!zones.length) return 0;
  const n = zones.length;
  const f = ((BOX_L / 2 - x) / BOX_L) * n - 0.5;   // 0 at front zone centre
  const i = Math.max(0, Math.min(n - 2, Math.floor(f)));
  const g = Math.max(0, Math.min(1, f - i));
  return zones[i] + (zones[i + 1] - zones[i]) * g;
}

function Road({ speed }: { speed: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.position.x += (speed / 3.6) * dt * 0.25;
    if (ref.current.position.x > 4) ref.current.position.x -= 4;
  });
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0, 0]}><planeGeometry args={[60, 7]} /><meshStandardMaterial color="#26292E" /></mesh>
      <group ref={ref}>{Array.from({ length: 16 }, (_, i) => <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[-30 + i * 4, 0.01, 0]}><planeGeometry args={[2, 0.15]} /><meshBasicMaterial color="#FF684A" /></mesh>)}</group>
    </group>
  );
}

/** Refrigerated truck digital twin with exterior and cut-away views and a spatial cargo heatmap. */
function ReeferTruckInner({ live, setpoint, cutaway, commodity }: { live: any; setpoint: number; cutaway: boolean; commodity: string }) {
  const zones: number[] = live?.readings?.zone_temperatures_c || [];
  const eq = live?.equipment || {};
  const speed = live?.flows?.moving_speed_kmh ?? live?.route?.speed_kmh ?? 0;
  const cooling = (live?.flows?.q_cool_w ?? 0) > 0;
  const wheels = useRef<THREE.Group>(null);
  const door = useRef<THREE.Group>(null);
  const fan = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    wheels.current?.children.forEach((w) => { w.rotation.z -= (speed / 3.6) * dt / 0.45; });
    if (door.current) door.current.rotation.y += ((eq.door_open ? -1.6 : 0) - door.current.rotation.y) * 0.08;
    if (fan.current) fan.current.rotation.x += dt * (cooling ? 8 : 0);
  });
  const crates = useMemo(() => {
    const out: [number, number, number][] = [];
    for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 4; k++) out.push([BOX_L / 2 - 0.45 - i * 0.68, 0.55 + k * 0.42, -0.8 + j * 0.8]);
    return out;
  }, []);
  const wallOpacity = cutaway ? 0.08 : 1;
  const sensors = (live?.sensors || []).filter((s: any) => s.position);
  return (
    <>
      <Road speed={speed} />
      <group position={[0, 0, 0]}>
        {/* cargo box (x: +front .. -rear) */}
        <group position={[0, 0.4 + BOX_H / 2, 0]}>
          <mesh><boxGeometry args={[BOX_L, BOX_H, BOX_W]} /><meshStandardMaterial color="#F3EEE8" transparent opacity={wallOpacity} depthWrite={!cutaway} side={THREE.DoubleSide} /></mesh>
          {!cutaway && <mesh position={[0, 0.5, BOX_W / 2 + 0.01]}><planeGeometry args={[BOX_L * 0.9, 0.4]} /><meshBasicMaterial color="#0A2624" /></mesh>}
          {!cutaway && <mesh position={[0, 0.5, BOX_W / 2 + 0.012]}><planeGeometry args={[1.8, 0.1]} /><meshBasicMaterial color="#FF684A" /></mesh>}
        </group>
        {/* heatmap volumes per zone (cutaway) */}
        {cutaway && zones.map((z, i) => {
          const x = BOX_L / 2 - (i + 0.5) * (BOX_L / zones.length);
          return <mesh key={i} position={[x, 0.4 + BOX_H / 2, 0]}><boxGeometry args={[BOX_L / zones.length - 0.04, BOX_H - 0.1, BOX_W - 0.1]} /><meshBasicMaterial color={tempColor(z, setpoint)} transparent opacity={0.16} depthWrite={false} /></mesh>;
        })}
        {cutaway && crates.map((p, i) => <Crate key={i} position={[p[0], p[1] - 0.2, p[2]]} commodity={commodity} quality={live?.produce?.quality ?? 90} tint={tempColor(tempAt(p[0], zones), setpoint)} />)}
        {cutaway && cooling && <Airflow size={[BOX_L - 0.3, 0.5, BOX_W - 0.3]} speed={1.2} color="#7FC4FF" origin={[0, 0.4 + BOX_H - 0.45, 0]} reverse />}
        {/* refrigeration unit on the front wall */}
        <group position={[BOX_L / 2 + 0.2, 0.4 + BOX_H - 0.55, 0]}>
          <mesh><boxGeometry args={[0.4, 0.9, 1.6]} /><meshStandardMaterial color={eq.cooling_failed || !eq.refrigeration_on ? "#5B616B" : "#9AA7B0"} /></mesh>
          <mesh ref={fan} position={[0.21, 0, 0]} rotation={[0, Math.PI / 2, 0]}><circleGeometry args={[0.3, 6]} /><meshStandardMaterial color="#1A1D22" /></mesh>
          <mesh position={[0.22, 0.35, 0.6]}><sphereGeometry args={[0.06]} /><meshStandardMaterial color={eq.cooling_failed || !eq.refrigeration_on ? "#EB4D3D" : "#5FB37C"} emissive={eq.cooling_failed || !eq.refrigeration_on ? "#EB4D3D" : "#5FB37C"} /></mesh>
        </group>
        {/* rear door */}
        <group ref={door} position={[-BOX_L / 2, 0.4, BOX_W / 2]}><mesh position={[0, BOX_H / 2, -BOX_W / 4]}><boxGeometry args={[0.05, BOX_H, BOX_W / 2]} /><meshStandardMaterial color="#E1DED7" /></mesh></group>
        {/* cab */}
        <group position={[BOX_L / 2 + 1.45, 0, 0]}>
          <mesh position={[0, 1.35, 0]}><boxGeometry args={[2.0, 2.0, 2.3]} /><meshStandardMaterial color="#0A2624" metalness={0.4} roughness={0.4} /></mesh>
          <mesh position={[1.01, 1.7, 0]}><boxGeometry args={[0.02, 0.8, 2.0]} /><meshStandardMaterial color="#2F80ED" metalness={0.8} roughness={0.1} transparent opacity={0.7} /></mesh>
          <mesh position={[0, 0.4, 0]}><boxGeometry args={[2.0, 0.3, 2.3]} /><meshStandardMaterial color="#FF684A" /></mesh>
        </group>
        <mesh position={[0.6, 0.35, 0]}><boxGeometry args={[BOX_L + 2.8, 0.15, 1.8]} /><meshStandardMaterial color="#1A1D22" /></mesh>
        <group ref={wheels}>
          {[-2.4, -1.4, 1.6, BOX_L / 2 + 1.8].flatMap((x) => [-1.05, 1.05].map((z) => (
            <mesh key={`${x}${z}`} position={[x, 0.45, z]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.45, 0.45, 0.3, 18]} /><meshStandardMaterial color="#111317" /></mesh>
          )))}
        </group>
        {/* sensor markers at their modelled positions */}
        {cutaway && sensors.map((s: any) => (
          <SensorTag key={s.id} position={[s.position[0], 0.4 + Math.min(BOX_H - 0.1, s.position[1]), s.position[2]]} label={s.id}
            unit={s.unit === "degC" ? "°C" : ["door", "cooling_status", "gps"].includes(s.kind) ? "" : s.unit} color={s.kind === "temperature" ? tempColor(s.value, setpoint) : "#FF684A"}
            value={s.kind === "door" ? (s.value ? "open" : "closed") : s.kind === "cooling_status" ? (s.value ? "on" : "off") : s.kind === "gps" ? "fix" : Number(s.value).toFixed(s.kind === "co2" ? 3 : 1)} />
        ))}
      </group>
    </>
  );
}

export function ReeferTruck(props: { live: any; setpoint: number; cutaway: boolean; commodity: string }) {
  return <Scene camera={[7, 5.5, 9]} target={[0, 1.4, 0]}><ReeferTruckInner {...props} /></Scene>;
}
