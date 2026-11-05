import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useMitra } from "./store";

const SKIN = "#C68B59";
const SKIN_DARK = "#A8703F";

/** Mitra's face, built from simple shapes (no downloaded model). Mouth follows the voice level, eyes blink,
 *  brows lift while listening and the head gently follows the pointer. */
function Head() {
  const head = useRef<THREE.Group>(null);
  const mouth = useRef<THREE.Mesh>(null);
  const lids = useRef<THREE.Group[]>([]);
  const brows = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const nextBlink = useRef(1.5);
  const smooth = useRef(0);

  useFrame(({ clock, pointer }, dt) => {
    const t = clock.elapsedTime;
    const { level, phase } = useMitra.getState();
    // fake gentle chatter if the browser voice gives no audio level
    const target = phase === "speaking" ? Math.max(level, 0.15 + 0.35 * Math.abs(Math.sin(t * 11)) * (level === 0 ? 1 : 0)) : 0;
    smooth.current += (target - smooth.current) * Math.min(1, dt * 18);
    if (mouth.current) mouth.current.scale.set(1 + smooth.current * 0.15, 0.12 + smooth.current * 0.9, 1);
    if (head.current) {
      head.current.rotation.y += (pointer.x * 0.35 - head.current.rotation.y) * 0.06;
      head.current.rotation.x += (-pointer.y * 0.18 + (phase === "thinking" ? -0.12 : 0) - head.current.rotation.x) * 0.06;
      head.current.position.y = Math.sin(t * 1.6) * 0.025;
      head.current.rotation.z = phase === "thinking" ? Math.sin(t * 2) * 0.06 : 0;
    }
    // blink
    let lid = 0.05;
    if (t > nextBlink.current) {
      const k = (t - nextBlink.current) / 0.16;
      lid = k < 1 ? Math.sin(k * Math.PI) : 0.05;
      if (k >= 1) nextBlink.current = t + 2.2 + Math.random() * 3;
    }
    lids.current.forEach((l) => l && l.scale.set(1, Math.max(0.05, lid), 1));
    if (brows.current) brows.current.position.y += ((phase === "listening" ? 0.08 : 0) - brows.current.position.y) * 0.15;
    if (ring.current) {
      const on = phase === "listening" || phase === "speaking";
      const m = ring.current.material as THREE.MeshBasicMaterial;
      m.opacity += ((on ? 0.55 + 0.25 * Math.sin(t * 6) : 0) - m.opacity) * 0.15;
      ring.current.scale.setScalar(1 + (phase === "speaking" ? smooth.current * 0.08 : 0));
    }
  });

  const eye = (x: number, i: number) => (
    <group position={[x, 0.18, 0.84]}>
      <mesh scale={[1, 0.8, 0.6]}><sphereGeometry args={[0.13, 24, 24]} /><meshStandardMaterial color="#FFFDF7" roughness={0.3} /></mesh>
      <mesh position={[0, -0.005, 0.07]}><sphereGeometry args={[0.065, 20, 20]} /><meshStandardMaterial color="#3B2414" roughness={0.2} /></mesh>
      <mesh position={[0.02, 0.02, 0.125]}><sphereGeometry args={[0.018, 10, 10]} /><meshBasicMaterial color="#ffffff" /></mesh>
      <group ref={(g) => { if (g) lids.current[i] = g; }} position={[0, 0.11, 0.02]}>
        <mesh position={[0, -0.11, 0]} scale={[1.08, 1, 0.75]}><sphereGeometry args={[0.135, 20, 20, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color={SKIN_DARK} /></mesh>
      </group>
    </group>
  );

  return (
    <group>
      <mesh ref={ring} position={[0, 0.05, -0.6]}><torusGeometry args={[1.25, 0.05, 12, 64]} /><meshBasicMaterial color="#3E8E5A" transparent opacity={0} /></mesh>
      <group ref={head}>
        {/* neck and shirt */}
        <mesh position={[0, -1.05, -0.1]}><cylinderGeometry args={[0.32, 0.38, 0.5, 24]} /><meshStandardMaterial color={SKIN} /></mesh>
        <mesh position={[0, -1.55, -0.1]}><sphereGeometry args={[0.95, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#F2EBDC" /></mesh>
        <mesh position={[0, -1.35, 0.45]} rotation={[0.5, 0, 0]}><boxGeometry args={[0.5, 0.08, 0.4]} /><meshStandardMaterial color="#1F4D3A" /></mesh>
        {/* head */}
        <mesh scale={[0.92, 1.08, 0.95]}><sphereGeometry args={[0.95, 48, 48]} /><meshStandardMaterial color={SKIN} roughness={0.7} /></mesh>
        <mesh position={[-0.9, 0.05, 0]} scale={[0.5, 1, 0.8]}><sphereGeometry args={[0.18, 20, 20]} /><meshStandardMaterial color={SKIN_DARK} /></mesh>
        <mesh position={[0.9, 0.05, 0]} scale={[0.5, 1, 0.8]}><sphereGeometry args={[0.18, 20, 20]} /><meshStandardMaterial color={SKIN_DARK} /></mesh>
        {/* green farmer's cap (topi) */}
        <mesh position={[0, 0.55, -0.02]} scale={[0.98, 0.62, 1]}><sphereGeometry args={[0.95, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#1F4D3A" roughness={0.8} /></mesh>
        <mesh position={[0, 0.56, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.9, 0.07, 12, 48]} /><meshStandardMaterial color="#3E8E5A" /></mesh>
        <mesh position={[0, 0.58, 0.62]} rotation={[-0.25, 0, 0]} scale={[1, 0.12, 0.7]}><sphereGeometry args={[0.55, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#174033" /></mesh>
        {/* eyes and brows */}
        {eye(-0.33, 0)}
        {eye(0.33, 1)}
        <group ref={brows}>
          <mesh position={[-0.33, 0.39, 0.86]} rotation={[0, 0, 0.12]}><boxGeometry args={[0.26, 0.05, 0.06]} /><meshStandardMaterial color="#2A1A10" /></mesh>
          <mesh position={[0.33, 0.39, 0.86]} rotation={[0, 0, -0.12]}><boxGeometry args={[0.26, 0.05, 0.06]} /><meshStandardMaterial color="#2A1A10" /></mesh>
        </group>
        {/* nose */}
        <mesh position={[0, -0.02, 0.95]} rotation={[0.2, 0, 0]} scale={[0.8, 1.1, 1]}><sphereGeometry args={[0.11, 20, 20]} /><meshStandardMaterial color={SKIN_DARK} /></mesh>
        {/* moustache */}
        <mesh position={[-0.15, -0.22, 0.9]} rotation={[0, 0, Math.PI / 2 + 0.32]}><capsuleGeometry args={[0.045, 0.2, 6, 12]} /><meshStandardMaterial color="#2A1A10" /></mesh>
        <mesh position={[0.15, -0.22, 0.9]} rotation={[0, 0, Math.PI / 2 - 0.32]}><capsuleGeometry args={[0.045, 0.2, 6, 12]} /><meshStandardMaterial color="#2A1A10" /></mesh>
        {/* mouth: opens with the voice */}
        <mesh ref={mouth} position={[0, -0.4, 0.86]}><sphereGeometry args={[0.16, 24, 16]} /><meshStandardMaterial color="#5A1E1A" /></mesh>
        <mesh position={[-0.42, -0.2, 0.74]}><sphereGeometry args={[0.09, 16, 16]} /><meshStandardMaterial color="#D4886A" transparent opacity={0.35} /></mesh>
        <mesh position={[0.42, -0.2, 0.74]}><sphereGeometry args={[0.09, 16, 16]} /><meshStandardMaterial color="#D4886A" transparent opacity={0.35} /></mesh>
      </group>
    </group>
  );
}

export function MitraFace({ className }: { className?: string }) {
  return (
    <div className={className}>
      <Canvas dpr={[1, 2]} camera={{ position: [0, 0, 4.1], fov: 34 }} gl={{ alpha: true, antialias: true }}>
        <ambientLight intensity={0.55} />
        <directionalLight position={[2, 3, 4]} intensity={1.6} />
        <directionalLight position={[-3, 1, 2]} intensity={0.5} color="#D7E6DC" />
        <Head />
      </Canvas>
    </div>
  );
}
