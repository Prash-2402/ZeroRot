import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { Scene } from "./common";

const CAT_COLOR: Record<string, string> = { good: "#5FB37C", damaged: "#F2994A", rejected: "#EB4D3D", uncertain: "#8A9099" };
const BIN_Z: Record<string, number> = { good: -1.6, damaged: 0, rejected: 1.6, uncertain: 0 };
const BELT_L = 12, SCAN_X = -1.5, GATE_X = 3.5;

/** Sorting line: fruit objects travel the belt, pass the camera, receive the category from the real inspection
 * result, and the gate diverts them into Good / Moderately damaged / Rejected bins. Uncertain objects go to manual check. */
function ConveyorLineInner({ objects, commodity, running }: { objects: { category: string; confidence: number }[]; commodity: string; running: boolean }) {
  const items = useMemo(() => (objects.length ? objects : []).slice(0, 24), [objects]);
  const group = useRef<THREE.Group>(null);
  const belt = useRef<THREE.Group>(null);
  const scan = useRef<THREE.Mesh>(null);
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 32;
    const g = c.getContext("2d")!;
    g.fillStyle = "#1A1D22"; g.fillRect(0, 0, 256, 32);
    g.fillStyle = "#3A3F47"; for (let i = 0; i < 256; i += 16) g.fillRect(i, 0, 6, 32);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping; t.repeat.set(8, 1);
    return t;
  }, []);
  const base = commodity === "banana" ? "#E5C640" : commodity === "mango" ? "#E8A93A" : commodity === "potato" ? "#B48A5A" : "#C8402F";
  useFrame((st, dt) => {
    if (!running) return;
    tex.offset.x -= dt * 0.35;
    const t = st.clock.elapsedTime;
    if (scan.current) (scan.current.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.2 * Math.sin(t * 8);
    group.current?.children.forEach((m, i) => {
      const period = items.length * 1.1 + 4;
      const phase = ((t * 0.9 + i * 1.1) % period) - 2;        // position along the line
      const x = -BELT_L / 2 + phase;
      const it = items[i];
      const past = x > SCAN_X;
      const mat = (m as THREE.Mesh).material as THREE.MeshStandardMaterial;
      mat.color.set(past ? CAT_COLOR[it.category] : base);
      if (x < GATE_X) m.position.set(x, 1.15, 0);
      else {
        const k = Math.min(1, (x - GATE_X) / 1.6);
        m.position.set(GATE_X + k * 1.6, 1.15 - k * 0.75, BIN_Z[it.category] * k);
      }
      m.visible = x < GATE_X + 2.4;
    });
  });
  return (
    <>
      {/* belt and frame */}
      <group ref={belt}>
        <mesh position={[0, 1.0, 0]}><boxGeometry args={[BELT_L, 0.12, 1.0]} /><meshStandardMaterial map={tex} /></mesh>
        {Array.from({ length: 13 }, (_, i) => <mesh key={i} position={[-BELT_L / 2 + i, 0.5, 0.55]}><boxGeometry args={[0.08, 1.0, 0.08]} /><meshStandardMaterial color="#5B616B" /></mesh>)}
        {Array.from({ length: 13 }, (_, i) => <mesh key={`b${i}`} position={[-BELT_L / 2 + i, 0.5, -0.55]}><boxGeometry args={[0.08, 1.0, 0.08]} /><meshStandardMaterial color="#5B616B" /></mesh>)}
      </group>
      {/* camera gantry + scan plane */}
      <group position={[SCAN_X, 0, 0]}>
        {[-0.8, 0.8].map((z) => <mesh key={z} position={[0, 1.6, z]}><boxGeometry args={[0.1, 3.2, 0.1]} /><meshStandardMaterial color="#08090B" /></mesh>)}
        <mesh position={[0, 3.2, 0]}><boxGeometry args={[0.2, 0.12, 1.8]} /><meshStandardMaterial color="#08090B" /></mesh>
        <mesh position={[0, 2.95, 0]}><boxGeometry args={[0.35, 0.3, 0.35]} /><meshStandardMaterial color="#FFC900" /></mesh>
        <mesh ref={scan} position={[0, 2.05, 0]}><coneGeometry args={[0.7, 1.7, 4, 1, true]} /><meshBasicMaterial color="#FFC900" transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} /></mesh>
        <Html position={[0, 3.5, 0]} center><div className="whitespace-nowrap bg-gold px-1.5 py-0.5 font-mono text-[10px] font-bold text-ink">CAMERA · OpenCV</div></Html>
      </group>
      {/* gate + bins */}
      <mesh position={[GATE_X, 1.25, 0]} rotation={[0, running ? 0.4 : 0, 0]}><boxGeometry args={[0.05, 0.35, 1.0]} /><meshStandardMaterial color="#FFC900" /></mesh>
      {[["good", "Good"], ["damaged", "Moderately damaged"], ["rejected", "Spoiled / rejected"]].map(([k, l]) => (
        <group key={k} position={[GATE_X + 1.8, 0, BIN_Z[k]]}>
          <mesh position={[0, 0.25, 0]}><boxGeometry args={[1.2, 0.5, 1.2]} /><meshStandardMaterial color={CAT_COLOR[k]} transparent opacity={0.85} /></mesh>
          <Html position={[0, 0.85, 0]} center><div className="whitespace-nowrap bg-ink px-1.5 py-0.5 font-mono text-[10px] text-paper">{l}: {objects.filter((o) => o.category === k).length}</div></Html>
        </group>
      ))}
      <group ref={group}>
        {items.map((_, i) => <mesh key={i} position={[-20, 1.15, 0]} castShadow><sphereGeometry args={[0.2, 20, 20]} /><meshStandardMaterial color={base} roughness={0.5} /></mesh>)}
      </group>
    </>
  );
}

export function ConveyorLine(props: { objects: { category: string; confidence: number }[]; commodity: string; running: boolean }) {
  return <Scene camera={[2, 7, 10]} target={[1, 0.8, 0]}><ConveyorLineInner {...props} /></Scene>;
}
