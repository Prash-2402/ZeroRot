import { useEffect, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { voice } from "./voiceSignal";

const SKIN = "#b9784f", SKIN_DARK = "#9c6040", HAIR = "#1a110c", LIP = "#8c3a3a", SAREE = "#17645F", BORDER = "#FF684A", GOLD = "#e0a92e";

function Head({ speaking, listening }: { speaking: boolean; listening: boolean }) {
  const root = useRef<THREE.Group>(null), eyes = useRef<THREE.Group[]>([]), irises = useRef<THREE.Group[]>([]);
  const jaw = useRef<THREE.Group>(null), mouth = useRef<THREE.Mesh>(null), brows = useRef<THREE.Group[]>([]);
  const st = useRef({ open: 0, blinkAt: 2, blink: 0, look: new THREE.Vector2(), target: new THREE.Vector2(), lastMove: 0 });
  useEffect(() => {
    const move = (e: PointerEvent) => {
      st.current.target.set((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
      st.current.lastMove = performance.now();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerdown", move);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerdown", move); };
  }, []);
  useFrame((state, dt) => {
    const s = st.current, t = state.clock.elapsedTime;
    // eyes and head follow the finger/cursor; wander gently when idle
    if (performance.now() - s.lastMove > 2500) s.target.set(Math.sin(t * 0.37) * 0.35, Math.sin(t * 0.23) * 0.15);
    s.look.lerp(s.target, Math.min(1, dt * 4));
    voice.pulse = Math.max(0, voice.pulse - dt * 3.5);
    // mouth: syllable-like oscillation while speaking, wider at each word start
    const syll = Math.abs(Math.sin(t * 10.5) * 0.7 + Math.sin(t * 6.9 + 1.3) * 0.3);
    const want = speaking ? Math.min(1, 0.15 + syll * 0.55 + voice.pulse * 0.5) : 0;
    s.open += (want - s.open) * Math.min(1, dt * 18);
    if (jaw.current) jaw.current.position.y = -s.open * 0.11;
    if (mouth.current) mouth.current.scale.set(1 - s.open * 0.15, 0.15 + s.open * 1.0, 1);
    // blink every few seconds
    if (t > s.blinkAt) { s.blink = 1; s.blinkAt = t + 2.5 + Math.random() * 3; }
    s.blink = Math.max(0, s.blink - dt * 7);
    const lid = s.blink > 0.5 ? (1 - s.blink) * 2 : s.blink * 2;
    eyes.current.forEach((e) => e && (e.scale.y = Math.max(0.08, 1 - lid)));
    irises.current.forEach((i) => i && i.position.set(s.look.x * 0.045, s.look.y * 0.035, 0));
    const browLift = (listening ? 0.05 : 0) + (speaking ? Math.max(0, Math.sin(t * 2.3)) * 0.025 : 0);
    brows.current.forEach((b, k) => b && (b.position.y = 0.37 + browLift + (k ? 0 : 0.005)));
    if (root.current) {
      root.current.rotation.y = s.look.x * 0.3 + Math.sin(t * 0.5) * 0.04;
      root.current.rotation.x = -s.look.y * 0.15 + Math.sin(t * 0.7) * 0.02 + (speaking ? Math.sin(t * 5.2) * 0.025 : 0) + (listening ? 0.06 : 0);
      root.current.rotation.z = listening ? 0.07 : Math.sin(t * 0.4) * 0.02;
    }
  });
  const skin = <meshStandardMaterial color={SKIN} roughness={0.55} />;
  const hair = <meshStandardMaterial color={HAIR} roughness={0.45} metalness={0.05} />;
  return (
    <group>
      {/* shoulders in a saree with a coral border */}
      <mesh position={[0, -1.95, -0.1]} scale={[1.55, 0.75, 0.85]}><sphereGeometry args={[1, 40, 24]} /><meshStandardMaterial color={SAREE} roughness={0.7} /></mesh>
      <mesh position={[0.35, -1.6, 0.42]} rotation={[0.25, 0, -0.75]}><boxGeometry args={[0.22, 1.5, 0.12]} /><meshStandardMaterial color={BORDER} roughness={0.6} /></mesh>
      <mesh position={[0, -1.25, 0]}><cylinderGeometry args={[0.3, 0.36, 0.8, 24]} />{skin}</mesh>
      <group ref={root} position={[0, 0.05, 0]}>
        {/* head and face */}
        <mesh scale={[0.86, 1.05, 0.93]}><sphereGeometry args={[1, 48, 36]} />{skin}</mesh>
        <mesh position={[0, -0.6, 0.36]} scale={[0.46, 0.36, 0.44]}><sphereGeometry args={[1, 32, 24]} />{skin}</mesh>
        {[-1, 1].map((sd) => <mesh key={`ear${sd}`} position={[sd * 0.84, 0.02, -0.05]} scale={[0.1, 0.2, 0.13]}><sphereGeometry args={[1, 16, 12]} /><meshStandardMaterial color={SKIN_DARK} roughness={0.6} /></mesh>)}
        {[-1, 1].map((sd) => <mesh key={`ring${sd}`} position={[sd * 0.86, -0.22, 0]}><sphereGeometry args={[0.055, 16, 12]} /><meshStandardMaterial color={GOLD} metalness={0.8} roughness={0.25} /></mesh>)}
        {/* hair: cap, side volumes, centre parting, bun with jasmine */}
        <mesh position={[0, 0.16, -0.1]} scale={[0.92, 1.0, 0.95]}><sphereGeometry args={[1, 48, 36, 0, Math.PI * 2, 0, Math.PI * 0.52]} />{hair}</mesh>
        {[-1, 1].map((sd) => <mesh key={`side${sd}`} position={[sd * 0.62, 0.02, -0.12]} rotation={[0, 0, sd * 0.15]} scale={[0.32, 0.72, 0.7]}><sphereGeometry args={[1, 24, 18]} />{hair}</mesh>)}
        <mesh position={[0, 0.42, -0.95]}><sphereGeometry args={[0.36, 28, 20]} />{hair}</mesh>
        {Array.from({ length: 9 }, (_, i) => { const a = (i / 9) * Math.PI * 2; return <mesh key={`j${i}`} position={[Math.cos(a) * 0.34, 0.42 + Math.sin(a) * 0.34, -0.95 + 0.12]}><sphereGeometry args={[0.05, 10, 8]} /><meshStandardMaterial color="#fffaf0" roughness={0.4} /></mesh>; })}
        {/* bindi */}
        <mesh position={[0, 0.29, 0.92]}><sphereGeometry args={[0.045, 16, 12]} /><meshStandardMaterial color="#c81e1e" roughness={0.35} /></mesh>
        {/* brows */}
        {[-1, 1].map((sd, k) => (
          <group key={`brow${sd}`} ref={(g) => { if (g) brows.current[k] = g; }} position={[sd * 0.3, 0.37, 0.8]} rotation={[0, sd * 0.25, sd * -0.12]}>
            <mesh rotation={[0, 0, Math.PI / 2]}><capsuleGeometry args={[0.022, 0.2, 4, 8]} />{hair}</mesh>
          </group>
        ))}
        {/* eyes */}
        {[-1, 1].map((sd, k) => (
          <group key={`eye${sd}`} position={[sd * 0.28, 0.13, 0.845]} rotation={[0, sd * 0.3, 0]} ref={(g) => { if (g) eyes.current[k] = g; }}>
            <mesh scale={[1.15, 0.78, 0.55]}><sphereGeometry args={[0.14, 24, 18]} /><meshStandardMaterial color="#fbf7f2" roughness={0.3} /></mesh>
            <group ref={(g) => { if (g) irises.current[k] = g; }}>
              <mesh position={[0, 0, 0.06]} scale={[1, 1, 0.5]}><sphereGeometry args={[0.078, 20, 16]} /><meshStandardMaterial color="#3b2314" roughness={0.3} /></mesh>
              <mesh position={[0, 0, 0.085]} scale={[1, 1, 0.5]}><sphereGeometry args={[0.04, 16, 12]} /><meshStandardMaterial color="#080504" roughness={0.2} /></mesh>
              <mesh position={[0.025, 0.03, 0.1]}><sphereGeometry args={[0.014, 8, 6]} /><meshBasicMaterial color="#ffffff" /></mesh>
            </group>
            <mesh position={[0, 0.09, 0.03]} rotation={[0, 0, Math.PI / 2]}><capsuleGeometry args={[0.016, 0.24, 4, 8]} />{hair}</mesh>
          </group>
        ))}
        {/* nose */}
        <mesh position={[0, -0.12, 0.9]} scale={[0.075, 0.13, 0.085]}><sphereGeometry args={[1, 20, 16]} />{skin}</mesh>
        <mesh position={[0, -0.22, 0.9]} scale={[0.1, 0.05, 0.07]}><sphereGeometry args={[1, 20, 16]} /><meshStandardMaterial color={SKIN_DARK} roughness={0.55} /></mesh>
        <mesh position={[0.075, -0.21, 0.9]}><sphereGeometry args={[0.018, 8, 6]} /><meshStandardMaterial color={GOLD} metalness={0.8} roughness={0.25} /></mesh>
        {/* cheeks */}
        {[-1, 1].map((sd) => <mesh key={`ch${sd}`} position={[sd * 0.42, -0.2, 0.72]}><sphereGeometry args={[0.13, 16, 12]} /><meshStandardMaterial color="#c9705a" transparent opacity={0.35} roughness={0.7} depthWrite={false} /></mesh>)}
        {/* mouth: dark opening, upper lip, jaw with lower lip */}
        <group position={[0, -0.47, 0.86]}>
          <mesh ref={mouth} position={[0, -0.02, -0.02]} scale={[1, 0.15, 1]}><sphereGeometry args={[0.13, 24, 16]} /><meshStandardMaterial color="#3a1212" roughness={0.8} /></mesh>
          <mesh position={[0, 0.0, 0.005]}><boxGeometry args={[0.16, 0.035, 0.02]} /><meshStandardMaterial color="#f4efe6" roughness={0.3} /></mesh>
          <mesh position={[0, 0.035, 0.01]} scale={[0.16, 0.032, 0.06]}><sphereGeometry args={[1, 24, 12]} /><meshStandardMaterial color={LIP} roughness={0.4} /></mesh>
          {[-1, 1].map((sd) => <mesh key={`corner${sd}`} position={[sd * 0.155, 0.045, 0.0]} scale={[0.03, 0.022, 0.03]}><sphereGeometry args={[1, 10, 8]} /><meshStandardMaterial color="#6e2b2b" roughness={0.5} /></mesh>)}
          <group ref={jaw}>
            <mesh position={[0, -0.04, 0.01]} scale={[0.14, 0.04, 0.06]}><sphereGeometry args={[1, 24, 12]} /><meshStandardMaterial color={LIP} roughness={0.4} /></mesh>
          </group>
        </group>
      </group>
    </group>
  );
}

export default function Avatar3D({ speaking, listening, size = 170 }: { speaking: boolean; listening: boolean; size?: number }) {
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <div className="absolute inset-0 rounded-full" style={{ background: listening ? "radial-gradient(circle,#2fa59b 0%,transparent 70%)" : "radial-gradient(circle,#FF684A88 0%,transparent 70%)", opacity: speaking || listening ? 0.9 : 0.45, transition: "opacity .3s" }} />
      <Canvas dpr={[1, 2]} camera={{ position: [0, -0.75, 6.6], fov: 32 }} gl={{ alpha: true, antialias: true }} style={{ background: "transparent" }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[-2, 2.5, 4]} intensity={2.2} color="#fff1df" />
        <directionalLight position={[2.5, 1, -3]} intensity={1.4} color="#7fd6cc" />
        <pointLight position={[0, -1, 3]} intensity={6} distance={8} color="#ffb59a" />
        <Head speaking={speaking} listening={listening} />
      </Canvas>
    </div>
  );
}
