/* The five floating-island scenes, one per slide. */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Float, Sparkles } from "@react-three/drei";
import * as THREE from "three";
import { C, Coins, Crate, Godown, House, Laptop, Phone, ReeferTruck, Stall, TomatoPlant, Tree, seeded, useCanvasTexture } from "./models";

/** Floating island: grassy (or tinted) top, layered soil underside, drifting rocks. */
export function Island({ r = 5, top = C.grass, edge = C.grassDark, seed = 1, children }: { r?: number; top?: string; edge?: string; seed?: number; children?: React.ReactNode }) {
  const topGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(r, r * 0.97, 0.5, 64, 2);
    const p = g.attributes.position, rnd = seeded(seed);
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.2) p.setY(i, p.getY(i) + (rnd() - 0.5) * 0.06);
    g.computeVertexNormals();
    return g;
  }, [r, seed]);
  const rocks = useMemo(() => { const rnd = seeded(seed + 5); return Array.from({ length: 6 }, (_, i) => ({ a: (i / 6) * Math.PI * 2 + rnd(), d: r * (0.75 + rnd() * 0.5), y: -1.5 - rnd() * 2, s: 0.25 + rnd() * 0.35 })); }, [r, seed]);
  const rk = useRef<THREE.Group>(null);
  useFrame((st) => { rk.current?.children.forEach((c, i) => { c.position.y = rocks[i].y + Math.sin(st.clock.elapsedTime * 0.8 + i) * 0.15; c.rotation.y += 0.003; }); });
  return (
    <group>
      <mesh geometry={topGeo} position={[0, -0.25, 0]} receiveShadow castShadow><meshStandardMaterial color={top} roughness={0.95} /></mesh>
      <mesh position={[0, -0.52, 0]}><cylinderGeometry args={[r * 0.98, r * 0.98, 0.08, 64]} /><meshStandardMaterial color={edge} /></mesh>
      <mesh position={[0, -1.6, 0]}><cylinderGeometry args={[r * 0.97, r * 0.55, 2.1, 9, 1]} /><meshStandardMaterial color={C.soil} flatShading roughness={1} /></mesh>
      <mesh position={[0, -3.3, 0]}><coneGeometry args={[r * 0.55, 2.6, 8]} /><meshStandardMaterial color={C.soilDark} flatShading roughness={1} /></mesh>
      <group ref={rk}>{rocks.map((k, i) => <mesh key={i} position={[Math.cos(k.a) * k.d, k.y, Math.sin(k.a) * k.d]} scale={k.s}><dodecahedronGeometry args={[1, 0]} /><meshStandardMaterial color={C.soil} flatShading /></mesh>)}</group>
      {children}
    </group>
  );
}

/* ---------- 1. the farm ---------- */
export function FarmScene() {
  const rows = [-1.6, 0, 1.6];
  return (
    <Island seed={3}>
      {rows.map((z, ri) => (
        <group key={z}>
          <mesh position={[0.4, 0.04, z]} receiveShadow><boxGeometry args={[5.4, 0.08, 0.7]} /><meshStandardMaterial color="#7a5232" roughness={1} /></mesh>
          {[-2, -1, 0, 1, 2].map((x, ci) => <TomatoPlant key={x} position={[x * 1.1 + 0.4, 0.05, z]} seed={ri * 7 + ci} height={1.3 + ((ri + ci) % 3) * 0.15} />)}
        </group>
      ))}
      <group position={[-3.4, 0, -2.4]} rotation={[0, 0.7, 0]}><House /></group>
      <Tree position={[-3.6, 0, 1.6]} scale={1.1} />
      <Tree position={[3.7, 0, -2.6]} scale={0.9} color="#4f9a3c" />
      <Tree position={[-1.8, 0, -3.8]} scale={0.8} color="#3c8239" />
      <Crate position={[3.3, 0, 2.6]} rotation={[0, 0.4, 0]} fill={12} seed={4} />
      <Crate position={[2.2, 0, 3.2]} rotation={[0, -0.2, 0]} fill={10} seed={9} />
      {Array.from({ length: 14 }, (_, i) => { const a = (i / 14) * Math.PI * 1.1 + 2.2; return <mesh key={i} position={[Math.cos(a) * 4.5, 0.3, Math.sin(a) * 4.5]} castShadow><boxGeometry args={[0.08, 0.6, 0.08]} /><meshStandardMaterial color={C.woodDark} /></mesh>; })}
      <Sparkles count={60} scale={[9, 3, 9]} position={[0, 2, 0]} size={2.5} speed={0.35} color="#fff2b0" />
    </Island>
  );
}

/* ---------- 2. the loss ---------- */
/** Tomatoes that ripen, brown and collapse in a loop (instanced, colour animated per frame). */
function RottingPile({ n = 70 }: { n?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const items = useMemo(() => { const r = seeded(11); return Array.from({ length: n }, () => { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 1.5; return { x: Math.cos(a) * d, z: Math.sin(a) * d, y: 0.18 + (1.5 - d) * 0.35 * r(), k: r() }; }); }, [n]);
  const m = useMemo(() => new THREE.Matrix4(), []), col = useMemo(() => new THREE.Color(), []);
  const fresh = new THREE.Color("#e8321f"), brown = new THREE.Color("#4a2e14"), mould = new THREE.Color("#8a8a6a");
  useFrame((st) => {
    const ph = (st.clock.elapsedTime * 0.12) % 1;   // one rot cycle every ~8 s
    items.forEach((it, i) => {
      const rot = Math.min(1, Math.max(0, ph * 1.6 - it.k * 0.6));
      const s = 0.16 * (1 - rot * 0.35);
      m.makeScale(s, s * (0.85 - rot * 0.35), s).setPosition(it.x, it.y * (1 - rot * 0.3), it.z);
      ref.current!.setMatrixAt(i, m);
      col.copy(fresh).lerp(brown, rot); if (rot > 0.7) col.lerp(mould, (rot - 0.7) * 1.2);
      ref.current!.setColorAt(i, col);
    });
    ref.current!.instanceMatrix.needsUpdate = true;
    if (ref.current!.instanceColor) ref.current!.instanceColor.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[undefined, undefined, n]} castShadow><sphereGeometry args={[1, 18, 14]} /><meshPhysicalMaterial roughness={0.45} clearcoat={0.5} /></instancedMesh>;
}

function CrashChart() {
  const tex = useCanvasTexture(512, 320, (g) => {
    g.fillStyle = "rgba(20,10,10,0.82)"; g.beginPath(); g.roundRect(0, 0, 512, 320, 24); g.fill();
    g.fillStyle = "#ffb4a8"; g.font = "bold 26px sans-serif"; g.fillText("Tomato, Rs per kg (2023)", 28, 48);
    const pts = [[30, 250], [90, 235], [150, 180], [210, 80], [250, 55], [290, 120], [340, 230], [400, 268], [480, 272]];
    g.strokeStyle = "rgba(255,255,255,.12)"; g.lineWidth = 1; [100, 160, 220, 280].forEach((y) => { g.beginPath(); g.moveTo(28, y); g.lineTo(490, y); g.stroke(); });
    g.strokeStyle = "#ff5a4a"; g.lineWidth = 7; g.lineJoin = "round"; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
    g.fillStyle = "#fff"; g.font = "bold 24px sans-serif"; g.fillText("Rs 150+", 205, 45 + 0); g.fillText("Rs 2-5", 400, 245);
    g.fillStyle = "#ffb4a8"; g.font = "18px sans-serif"; g.fillText("Jul", 200, 305); g.fillText("Sep", 395, 305);
  });
  return (
    <Float speed={1.5} floatIntensity={0.5} rotationIntensity={0.15}>
      <mesh><planeGeometry args={[3.4, 2.1]} /><meshBasicMaterial map={tex} transparent toneMapped={false} side={THREE.DoubleSide} /></mesh>
    </Float>
  );
}

export function LossScene() {
  return (
    <Island seed={8} top="#8a6a42" edge="#6e5233">
      <group position={[0.6, 0.02, 0.4]}><RottingPile /></group>
      <Crate position={[-2.4, 0, 1.4]} rotation={[0, 0.5, 0]} fill={14} rot={0.85} seed={21} />
      <Crate position={[-1.6, 0, -1.8]} rotation={[0.25, -0.4, 0.5]} fill={9} rot={0.6} seed={33} />
      <Crate position={[2.9, 0, -1.6]} rotation={[0, 1.2, 0]} fill={12} rot={0.95} seed={41} />
      <mesh position={[-3.5, 0.03, -0.6]} rotation={[-Math.PI / 2, 0, 0.3]} receiveShadow><planeGeometry args={[2.5, 6]} /><meshStandardMaterial color="#3d3a37" roughness={1} /></mesh>
      <Tree position={[3.4, 0, 2.6]} scale={0.8} color="#7d7a35" />
      <group position={[-0.2, 3.6, -2.2]}><CrashChart /></group>
      <Sparkles count={70} scale={[4, 2.5, 4]} position={[0.6, 1.3, 0.4]} size={2.2} speed={2.2} color="#1a120b" opacity={1} noise={2} />
      <pointLight position={[0.6, 2.5, 1.5]} intensity={18} distance={9} color="#ff5040" />
    </Island>
  );
}

/* ---------- 3. the digital twin ---------- */
function DataCard({ text, sub, color, position }: { text: string; sub: string; color: string; position: any }) {
  const tex = useCanvasTexture(320, 160, (g) => {
    g.fillStyle = "rgba(8,30,34,0.82)"; g.beginPath(); g.roundRect(0, 0, 320, 160, 22); g.fill();
    g.strokeStyle = color; g.lineWidth = 4; g.beginPath(); g.roundRect(3, 3, 314, 154, 20); g.stroke();
    g.fillStyle = color; g.font = "bold 54px sans-serif"; g.fillText(text, 24, 84);
    g.fillStyle = "#cfe9e5"; g.font = "24px sans-serif"; g.fillText(sub, 24, 130);
  }, [text, sub, color]);
  return <Float speed={2} floatIntensity={0.6}><mesh position={position}><planeGeometry args={[1.7, 0.85]} /><meshBasicMaterial map={tex} transparent toneMapped={false} side={THREE.DoubleSide} /></mesh></Float>;
}

export function TwinScene() {
  const rings = useRef<THREE.Group>(null), beam = useRef<THREE.Mesh>(null), cards = useRef<THREE.Group>(null);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    rings.current?.children.forEach((r, i) => { r.rotation.z = t * (0.4 + i * 0.25) * (i % 2 ? -1 : 1); });
    if (beam.current) { beam.current.position.y = 0.3 + ((Math.sin(t * 1.2) + 1) / 2) * 2.6; (beam.current.material as THREE.MeshBasicMaterial).opacity = 0.18 + Math.sin(t * 6) * 0.05; }
    if (cards.current) cards.current.rotation.y = Math.sin(t * 0.3) * 0.25;
  });
  return (
    <Island seed={14} top="#2b5752" edge="#1d403c">
      {Array.from({ length: 10 }, (_, i) => <mesh key={i} position={[0, 0.02, -4.5 + i]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[9, 0.02]} /><meshBasicMaterial color="#7fe3d6" transparent opacity={0.35} toneMapped={false} /></mesh>)}
      {Array.from({ length: 10 }, (_, i) => <mesh key={`v${i}`} position={[-4.5 + i, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.02, 9]} /><meshBasicMaterial color="#7fe3d6" transparent opacity={0.35} toneMapped={false} /></mesh>)}
      <group position={[0, 0.02, 0]}><Godown /></group>
      <mesh ref={beam} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[5.6, 4.2]} /><meshBasicMaterial color="#7fe3d6" transparent opacity={0.2} side={THREE.DoubleSide} toneMapped={false} depthWrite={false} /></mesh>
      <group ref={rings} position={[0, 1.8, 0]} rotation={[Math.PI / 2, 0, 0]}>
        {[3.6, 4.1, 4.6].map((r, i) => <mesh key={i}><torusGeometry args={[r, 0.03, 8, 128, Math.PI * (1.2 + i * 0.25)]} /><meshBasicMaterial color={i === 1 ? C.coral : "#7fe3d6"} toneMapped={false} /></mesh>)}
      </group>
      <group ref={cards}>
        <DataCard text="12.5 °C" sub="inside, auto-controlled" color="#7fe3d6" position={[-3.4, 3.6, 1]} />
        <DataCard text="93% RH" sub="humidity corrected" color="#7fe3d6" position={[3.6, 3.9, 0.6]} />
        <DataCard text="8.5 d" sub="shelf life, P10-P90" color="#FF684A" position={[-2.6, 5.0, -1.6]} />
        <DataCard text="Risk 4%" sub="100 model runs" color="#ffd27a" position={[2.4, 5.2, -1.8]} />
      </group>
      <Sparkles count={80} scale={[8, 5, 8]} position={[0, 2.5, 0]} size={2} speed={0.5} color="#7fe3d6" />
    </Island>
  );
}

/* ---------- 4. how it works ---------- */
function Packets({ curve, color, count = 5, speed = 0.25 }: { curve: THREE.Curve<THREE.Vector3>; color: string; count?: number; speed?: number }) {
  const g = useRef<THREE.Group>(null);
  const tube = useMemo(() => new THREE.TubeGeometry(curve, 64, 0.025, 6, false), [curve]);
  useFrame((st) => { g.current?.children.forEach((c, i) => { const u = (st.clock.elapsedTime * speed + i / count) % 1; c.position.copy(curve.getPointAt(u)); }); });
  return (
    <group>
      <mesh geometry={tube}><meshBasicMaterial color={color} transparent opacity={0.35} toneMapped={false} /></mesh>
      <group ref={g}>{Array.from({ length: count }, (_, i) => <mesh key={i}><sphereGeometry args={[0.09, 12, 10]} /><meshBasicMaterial color={color} toneMapped={false} /></mesh>)}</group>
    </group>
  );
}

export function PipelineScene() {
  const core = useRef<THREE.Group>(null), truck = useRef<THREE.Group>(null);
  const toCore = useMemo(() => new THREE.CatmullRomCurve3([new THREE.Vector3(-2.9, 2.2, 0.8), new THREE.Vector3(-1.6, 3.6, 0.6), new THREE.Vector3(0, 2.9, 0)]), []);
  const toLaptop = useMemo(() => new THREE.CatmullRomCurve3([new THREE.Vector3(0, 2.9, 0), new THREE.Vector3(1.6, 3.5, 0.4), new THREE.Vector3(2.7, 1.6, 0.8)]), []);
  const road = useMemo(() => new THREE.EllipseCurve(0, 0, 4.1, 4.1, 0, Math.PI * 2, false, 0), []);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    if (core.current) { core.current.rotation.y = t * 0.6; core.current.rotation.x = Math.sin(t * 0.5) * 0.2; }
    const u = (t * 0.05) % 1, p = road.getPointAt(u), q = road.getPointAt((u + 0.01) % 1);
    truck.current?.position.set(p.x, 0.02, p.y);
    truck.current?.rotation.set(0, Math.atan2(q.x - p.x, q.y - p.y), 0);
  });
  return (
    <Island seed={21} top="#56786b" edge="#3f5c51">
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} receiveShadow><ringGeometry args={[3.75, 4.45, 96]} /><meshStandardMaterial color="#33393d" roughness={0.9} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}><ringGeometry args={[4.08, 4.12, 96]} /><meshBasicMaterial color={C.coral} toneMapped={false} /></mesh>
      <group ref={truck} scale={0.33}><ReeferTruck lights={false} /></group>
      <Float speed={1.8} rotationIntensity={0.2} floatIntensity={0.6}><group position={[-2.9, 1.9, 0.8]} rotation={[0, 0.45, -0.08]} scale={0.75}><Phone /></group></Float>
      <group position={[2.6, 0.2, 0.6]} rotation={[0, -0.55, 0]} scale={0.62}><Laptop /></group>
      <group ref={core} position={[0, 2.9, 0]}>
        <mesh><icosahedronGeometry args={[0.55, 1]} /><meshStandardMaterial color={C.teal} emissive={C.tealLight} emissiveIntensity={0.8} flatShading /></mesh>
        <mesh scale={1.35}><icosahedronGeometry args={[0.55, 1]} /><meshBasicMaterial color="#7fe3d6" wireframe toneMapped={false} /></mesh>
      </group>
      <Packets curve={toCore} color={C.coral} />
      <Packets curve={toLaptop} color="#7fe3d6" speed={0.3} />
      {[["cloud", -1.2, 4.6, -1.8], ["chart", 1.4, 4.7, -1.6]].map(([k, x, y, z]: any) => (
        <Float key={k} speed={2} floatIntensity={0.8}>
          <group position={[x, y, z]}>
            {k === "cloud" ? [[-0.3, 0, 0, 0.4], [0.15, 0.1, 0, 0.5], [0.55, 0, 0, 0.35]].map(([a, b, c, s], i) => <mesh key={i} position={[a, b, c]}><sphereGeometry args={[s, 16, 12]} /><meshStandardMaterial color="#ffffff" /></mesh>)
              : [0.4, 0.7, 0.55, 1.0].map((h, i) => <mesh key={i} position={[i * 0.28 - 0.4, h / 2, 0]}><boxGeometry args={[0.2, h, 0.2]} /><meshStandardMaterial color={i === 3 ? C.coral : "#7fe3d6"} emissive={i === 3 ? C.coral : "#2fa59b"} emissiveIntensity={0.5} /></mesh>)}
          </group>
        </Float>
      ))}
      <Tree position={[-3.2, 0, -2.6]} scale={0.7} />
      <Tree position={[3.1, 0, -2.8]} scale={0.8} color="#4f9a3c" />
    </Island>
  );
}

/* ---------- 5. the market ---------- */
export function MarketScene() {
  const coins = useRef<THREE.Group>(null), arrow = useRef<THREE.Group>(null);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    coins.current?.children.forEach((c, i) => { const k = ((t * 0.35 + i * 0.18) % 1); c.scale.y = 0.4 + k * 1.2; });
    if (arrow.current) arrow.current.position.y = 3.2 + Math.sin(t * 1.5) * 0.15;
  });
  return (
    <Island seed={30} top="#d9c58f" edge="#b9a26a">
      <group position={[-2.2, 0, -1.4]} rotation={[0, 0.35, 0]}><Stall stripe={C.coral} seed={2} /></group>
      <group position={[0.7, 0, -2.4]}><Stall stripe={C.teal} seed={5} /></group>
      <group position={[3.2, 0, -0.9]} rotation={[0, -0.5, 0]}><Stall stripe={C.gold} seed={8} /></group>
      <group position={[-1.2, 0, 2.3]} rotation={[0, 2.2, 0]} scale={0.45}><ReeferTruck lights={false} /></group>
      <group ref={coins} position={[1.6, 0, 1.4]}>
        {[0, 1, 2, 3].map((i) => <group key={i} position={[i * 0.75, 0, (i % 2) * 0.3]}><Coins count={3 + i * 2} /></group>)}
      </group>
      <group ref={arrow} position={[2.6, 3.2, 1.2]} rotation={[0, 0, -0.6]}>
        <mesh><cylinderGeometry args={[0.09, 0.09, 1.6, 12]} /><meshStandardMaterial color="#3fd17a" emissive="#22b35a" emissiveIntensity={0.7} /></mesh>
        <mesh position={[0, 0.95, 0]}><coneGeometry args={[0.28, 0.5, 16]} /><meshStandardMaterial color="#3fd17a" emissive="#22b35a" emissiveIntensity={0.7} /></mesh>
      </group>
      <Tree position={[-3.8, 0, 1.2]} scale={0.9} />
      <Sparkles count={90} scale={[9, 5, 9]} position={[0, 3, 0]} size={4} speed={0.6} color="#ffd27a" />
    </Island>
  );
}
