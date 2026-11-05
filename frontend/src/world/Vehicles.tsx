import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { tempColor } from "../lib/format";

function Wheel({ position, r = 0.5, spin }: { position: [number, number, number]; r?: number; spin: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => { if (ref.current) ref.current.rotation.x = spin.current / r; });
  return (
    <group position={position} ref={ref}>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[r, r, 0.4, 16]} /><meshStandardMaterial color="#141518" roughness={0.9} /></mesh>
      <mesh rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[r * 0.55, r * 0.55, 0.42, 10]} /><meshStandardMaterial color="#8a8f96" metalness={0.6} roughness={0.4} /></mesh>
    </group>
  );
}

/**
 * Truck model, length ~8 units along local +z (cab at +z). `zones` (front -> rear) colour the reefer side heat strip.
 * `distance` (world units travelled) drives wheel spin so wheels match the motion.
 */
export function TruckModel({ refrigerated, zones, setpoint, coolingOn, doorOpen, night, distRef, cargo = "crates" }: {
  refrigerated: boolean; zones?: number[]; setpoint?: number | null; coolingOn?: boolean; doorOpen?: boolean; night?: boolean; distRef: React.MutableRefObject<number>; cargo?: "crates" | "bags";
}) {
  const spin = useRef(0);
  const fan = useRef<THREE.Mesh>(null);
  const door = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    spin.current = distRef.current;
    if (fan.current && coolingOn) fan.current.rotation.z += dt * 18;
    if (door.current) door.current.rotation.y += ((doorOpen ? -1.7 : 0) - door.current.rotation.y) * Math.min(1, dt * 4);
  });
  const sp = setpoint ?? 13;
  return (
    <group>
      {/* chassis */}
      <mesh position={[0, 0.75, 0.3]} castShadow><boxGeometry args={[2.0, 0.35, 8.4]} /><meshStandardMaterial color="#1b1d21" /></mesh>
      {/* cab */}
      <group position={[0, 0, 3.4]}>
        <mesh position={[0, 1.9, 0.2]} castShadow><boxGeometry args={[2.3, 2.1, 1.9]} /><meshStandardMaterial color="#0A2624" metalness={0.5} roughness={0.35} /></mesh>
        <mesh position={[0, 2.35, 1.16]}><boxGeometry args={[2.1, 0.9, 0.04]} /><meshStandardMaterial color="#9fc6e8" metalness={0.9} roughness={0.05} /></mesh>
        <mesh position={[0, 1.05, 1.18]}><boxGeometry args={[2.3, 0.35, 0.1]} /><meshStandardMaterial color="#FF684A" /></mesh>
        {[-0.85, 0.85].map((x) => (
          <mesh key={x} position={[x, 1.25, 1.2]}><boxGeometry args={[0.35, 0.2, 0.05]} /><meshStandardMaterial color="#fff6d8" emissive="#fff2c4" emissiveIntensity={night ? 6 : 0.4} /></mesh>
        ))}
      </group>
      {/* body */}
      {refrigerated ? (
        <group position={[0, 2.25, -0.9]}>
          <mesh castShadow><boxGeometry args={[2.45, 2.6, 6.2]} /><meshStandardMaterial color="#F3EEE8" roughness={0.6} /></mesh>
          <mesh position={[0, 0.85, 0]}><boxGeometry args={[2.47, 0.18, 6.22]} /><meshStandardMaterial color="#FF684A" /></mesh>
          {/* zone heat strip, front (unit, +z) -> rear */}
          {(zones?.length ? zones : Array(6).fill(sp)).map((z, i, a) => {
            const zz = 3.1 - (i + 0.5) * (6.2 / a.length);
            const c = tempColor(z, sp);
            return [-1.24, 1.24].map((x) => (
              <mesh key={`${i}${x}`} position={[x, -0.55, zz]} rotation={[0, x > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}>
                <planeGeometry args={[6.2 / a.length - 0.08, 0.5]} /><meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.9} side={THREE.DoubleSide} />
              </mesh>
            ));
          })}
          {/* refrigeration unit */}
          <group position={[0, 0.75, 3.25]}>
            <mesh><boxGeometry args={[1.8, 1.0, 0.45]} /><meshStandardMaterial color={coolingOn ? "#a7b2bb" : "#5b616b"} metalness={0.4} /></mesh>
            <mesh ref={fan} position={[0, 0, 0.24]}><circleGeometry args={[0.32, 6]} /><meshStandardMaterial color="#1a1d22" /></mesh>
            <mesh position={[0.7, 0.35, 0.24]}><sphereGeometry args={[0.07]} /><meshStandardMaterial color={coolingOn ? "#5FB37C" : "#EB4D3D"} emissive={coolingOn ? "#5FB37C" : "#EB4D3D"} emissiveIntensity={3} /></mesh>
          </group>
          <group ref={door} position={[1.2, 0, -3.1]}><mesh position={[-0.6, 0, 0]}><boxGeometry args={[1.2, 2.5, 0.06]} /><meshStandardMaterial color="#e3e0d8" /></mesh></group>
          <group position={[-1.2, 0, -3.1]}><mesh position={[0.6, 0, 0]}><boxGeometry args={[1.2, 2.5, 0.06]} /><meshStandardMaterial color="#e3e0d8" /></mesh></group>
        </group>
      ) : (
        <group position={[0, 1.0, -0.9]}>
          <mesh position={[0, 0.35, 0]} castShadow><boxGeometry args={[2.45, 0.7, 6.2]} /><meshStandardMaterial color="#6b4a2b" /></mesh>
          {Array.from({ length: 14 }, (_, i) => (
            <mesh key={i} position={[((i % 2) - 0.5) * 1.1, 1.0 + Math.floor(i / 8) * 0.55, -2.6 + (Math.floor(i / 2) % 4) * 1.6]} castShadow>
              {cargo === "bags" ? <sphereGeometry args={[0.55, 10, 8]} /> : <boxGeometry args={[1.0, 0.55, 1.4]} />}
              <meshStandardMaterial color={cargo === "bags" ? "#d8c9a3" : "#b08850"} />
            </mesh>
          ))}
          <mesh position={[0, 1.7, 0]} castShadow><boxGeometry args={[2.5, 0.08, 6.25]} /><meshStandardMaterial color="#2d5a3a" roughness={0.9} /></mesh>
          {[-1.22, 1.22].map((x) => <mesh key={x} position={[x, 1.2, 0]}><boxGeometry args={[0.05, 1.0, 6.2]} /><meshStandardMaterial color="#2d5a3a" side={THREE.DoubleSide} transparent opacity={0.85} /></mesh>)}
        </group>
      )}
      {/* wheels */}
      {[3.6, -1.6, -3.0].flatMap((z) => [-1.05, 1.05].map((x) => <Wheel key={`${x}${z}`} position={[x, 0.55, z]} r={0.55} spin={spin} />))}
      {/* tail lights */}
      {[-0.9, 0.9].map((x) => <mesh key={x} position={[x, 1.0, -4.05]}><boxGeometry args={[0.3, 0.15, 0.05]} /><meshStandardMaterial color="#ff2a2a" emissive="#ff2a2a" emissiveIntensity={night ? 5 : 1} /></mesh>)}
    </group>
  );
}

export function TractorTrolley({ crates, distRef }: { crates: number; distRef: React.MutableRefObject<number> }) {
  const spin = useRef(0);
  useFrame(() => { spin.current = distRef.current; });
  return (
    <group>
      <group position={[0, 0, 3.2]}>
        <mesh position={[0, 1.2, 0]} castShadow><boxGeometry args={[1.3, 0.9, 2.2]} /><meshStandardMaterial color="#c0392b" /></mesh>
        <mesh position={[0, 2.0, -0.3]} castShadow><boxGeometry args={[1.2, 0.9, 1.0]} /><meshStandardMaterial color="#c0392b" /></mesh>
        <mesh position={[0, 2.5, -0.3]}><boxGeometry args={[1.4, 0.08, 1.3]} /><meshStandardMaterial color="#222" /></mesh>
        <Wheel position={[-0.85, 0.85, -0.6]} r={0.85} spin={spin} /><Wheel position={[0.85, 0.85, -0.6]} r={0.85} spin={spin} />
        <Wheel position={[-0.6, 0.45, 0.8]} r={0.45} spin={spin} /><Wheel position={[0.6, 0.45, 0.8]} r={0.45} spin={spin} />
      </group>
      <mesh position={[0, 0.9, -0.2]} castShadow><boxGeometry args={[2.0, 0.6, 3.6]} /><meshStandardMaterial color="#556b2f" /></mesh>
      {Array.from({ length: Math.min(12, crates) }, (_, i) => (
        <mesh key={i} position={[((i % 2) - 0.5) * 0.9, 1.45 + Math.floor(i / 6) * 0.5, -1.5 + (Math.floor(i / 2) % 3) * 1.1]} castShadow>
          <boxGeometry args={[0.85, 0.45, 1.0]} /><meshStandardMaterial color="#b08850" />
        </mesh>
      ))}
      <Wheel position={[-1.05, 0.5, -0.4]} r={0.5} spin={spin} /><Wheel position={[1.05, 0.5, -0.4]} r={0.5} spin={spin} />
    </group>
  );
}
