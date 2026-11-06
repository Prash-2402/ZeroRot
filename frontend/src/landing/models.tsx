/* Hand-built low-poly models for the landing page (no external assets). */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";

export const C = {
  teal: "#17645F", tealLight: "#2fa59b", coral: "#FF684A", ivory: "#F3EEE8", gold: "#e0a92e",
  soil: "#6b4527", soilDark: "#4a2f1a", grass: "#5fa14a", grassDark: "#3f7d35", leaf: "#3d8b37", wood: "#b07a45", woodDark: "#7a5230",
};

export function seeded(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/* ---------- produce ---------- */
const tomatoGeo = new THREE.SphereGeometry(1, 28, 20);
const calyxGeo = (() => {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2, r = i % 2 ? 0.18 : 0.62;
    s[i ? "lineTo" : "moveTo"](Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ShapeGeometry(s);
})();

/** Glossy tomato; `rot` 0..1 browns, shrinks and wrinkles it. */
export function Tomato({ position = [0, 0, 0] as any, scale = 0.25, rot = 0, rotation = [0, 0, 0] as any }) {
  const color = useMemo(() => new THREE.Color("#e8321f").lerp(new THREE.Color("#5b3a1a"), rot), [rot]);
  const s = scale * (1 - rot * 0.25);
  return (
    <group position={position} rotation={rotation} scale={s}>
      <mesh geometry={tomatoGeo} scale={[1, 0.82 - rot * 0.15, 1]} castShadow>
        <meshPhysicalMaterial color={color} roughness={0.25 + rot * 0.6} clearcoat={1 - rot} clearcoatRoughness={0.15} />
      </mesh>
      <mesh geometry={calyxGeo} position={[0, 0.8 - rot * 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]}><meshStandardMaterial color={rot > 0.5 ? "#4b4a1e" : "#2f7a2a"} side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, 0.95, 0]}><cylinderGeometry args={[0.06, 0.08, 0.3, 6]} /><meshStandardMaterial color="#2f6b25" /></mesh>
      {rot > 0.45 && <mesh position={[0.45, 0.2, 0.6]} scale={[0.35, 0.25, 0.1]}><sphereGeometry args={[1, 10, 8]} /><meshStandardMaterial color="#d8d6c8" roughness={1} /></mesh>}
    </group>
  );
}

const leafGeo = (() => {
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.bezierCurveTo(0.25, 0.15, 0.3, 0.55, 0, 0.9); s.bezierCurveTo(-0.3, 0.55, -0.25, 0.15, 0, 0);
  const g = new THREE.ShapeGeometry(s, 8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.pow(p.getY(i), 2) * 0.35 - Math.abs(p.getX(i)) * 0.4);   // cupped and bent
  g.computeVertexNormals();
  return g;
})();

/** Staked tomato plant with leaves and a cluster of fruit. */
export function TomatoPlant({ position = [0, 0, 0] as any, seed = 1, height = 1.6, fruits = 4 }) {
  const r = useMemo(() => seeded(seed * 97 + 13), [seed]);
  const leaves = useMemo(() => Array.from({ length: 9 }, (_, i) => ({ y: 0.25 + (i / 9) * height * 0.9, a: i * 2.3 + r() * 0.6, s: 0.45 + r() * 0.25 })), [height, r]);
  const fr = useMemo(() => Array.from({ length: fruits }, () => ({ y: 0.45 + r() * height * 0.55, a: r() * Math.PI * 2, d: 0.22 + r() * 0.12, ripe: r() })), [fruits, height, r]);
  const g = useRef<THREE.Group>(null);
  useFrame((st) => { if (g.current) g.current.rotation.z = Math.sin(st.clock.elapsedTime * 1.2 + seed) * 0.04; });
  return (
    <group position={position} ref={g}>
      <mesh position={[0.12, height * 0.55, 0]} castShadow><cylinderGeometry args={[0.03, 0.035, height * 1.1, 5]} /><meshStandardMaterial color={C.woodDark} /></mesh>
      <mesh position={[0, height / 2, 0]} castShadow><cylinderGeometry args={[0.035, 0.05, height, 6]} /><meshStandardMaterial color="#3e7a2f" /></mesh>
      {leaves.map((l, i) => (
        <mesh key={i} geometry={leafGeo} position={[0, l.y, 0]} rotation={[-0.9, l.a, 0]} scale={l.s} castShadow>
          <meshStandardMaterial color={i % 3 ? C.leaf : "#4c9c3f"} side={THREE.DoubleSide} roughness={0.7} />
        </mesh>
      ))}
      {fr.map((f, i) => <Tomato key={i} position={[Math.cos(f.a) * f.d, f.y, Math.sin(f.a) * f.d]} scale={0.11} rot={0} />)}
    </group>
  );
}

/** Low-poly tree: trunk + stacked faceted crowns. */
export function Tree({ position = [0, 0, 0] as any, scale = 1, color = "#3f8f3a" }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.6, 0]} castShadow><cylinderGeometry args={[0.12, 0.18, 1.2, 6]} /><meshStandardMaterial color={C.woodDark} flatShading /></mesh>
      <mesh position={[0, 1.5, 0]} castShadow><icosahedronGeometry args={[0.8, 0]} /><meshStandardMaterial color={color} flatShading /></mesh>
      <mesh position={[0.25, 2.1, 0.1]} castShadow><icosahedronGeometry args={[0.55, 0]} /><meshStandardMaterial color={new THREE.Color(color).offsetHSL(0, 0, 0.06)} flatShading /></mesh>
    </group>
  );
}

/** Slatted wooden crate, optionally full of tomatoes (fresh or rotting). */
export function Crate({ position = [0, 0, 0] as any, rotation = [0, 0, 0] as any, fill = 0, rot = 0, seed = 1 }) {
  const r = useMemo(() => seeded(seed), [seed]);
  const fruit = useMemo(() => Array.from({ length: fill }, (_, i) => [((i % 4) - 1.5) * 0.24 + (r() - 0.5) * 0.05, 0.42 + Math.floor(i / 8) * 0.17, (Math.floor(i / 4) % 2 - 0.5) * 0.3, r()]), [fill, r]);
  const wood = <meshStandardMaterial color={C.wood} roughness={0.85} />;
  return (
    <group position={position} rotation={rotation}>
      {[0.08, 0.3, 0.52].map((y) => [-0.35, 0.35].map((z) => <mesh key={`${y}${z}`} position={[0, y, z]} castShadow receiveShadow><boxGeometry args={[1.1, 0.14, 0.04]} />{wood}</mesh>))}
      {[0.08, 0.3, 0.52].map((y) => [-0.53, 0.53].map((x) => <mesh key={`s${y}${x}`} position={[x, y, 0]} castShadow><boxGeometry args={[0.04, 0.14, 0.74]} />{wood}</mesh>))}
      <mesh position={[0, 0.02, 0]} receiveShadow><boxGeometry args={[1.1, 0.04, 0.74]} /><meshStandardMaterial color={C.woodDark} /></mesh>
      {[[-0.53, -0.35], [0.53, -0.35], [-0.53, 0.35], [0.53, 0.35]].map(([x, z], i) => <mesh key={i} position={[x, 0.3, z]}><boxGeometry args={[0.07, 0.6, 0.07]} /><meshStandardMaterial color={C.woodDark} /></mesh>)}
      {fruit.map(([x, y, z, k], i) => <Tomato key={i} position={[x, y, z]} scale={0.12} rot={Math.min(1, Math.max(0, rot + (k - 0.5) * 0.4))} rotation={[k * 3, k * 5, 0]} />)}
    </group>
  );
}

/* ---------- vehicles ---------- */
function Wheel({ position }: { position: any }) {
  return (
    <group position={position} rotation={[0, 0, Math.PI / 2]}>
      <mesh castShadow><cylinderGeometry args={[0.38, 0.38, 0.28, 20]} /><meshStandardMaterial color="#1b1b1b" roughness={0.9} /></mesh>
      <mesh position={[0, 0.15, 0]}><cylinderGeometry args={[0.2, 0.2, 0.02, 16]} /><meshStandardMaterial color="#c9cfd3" metalness={0.8} roughness={0.3} /></mesh>
      <mesh position={[0, -0.15, 0]}><cylinderGeometry args={[0.2, 0.2, 0.02, 16]} /><meshStandardMaterial color="#c9cfd3" metalness={0.8} roughness={0.3} /></mesh>
    </group>
  );
}

/** Refrigerated truck: cab, ribbed reefer box with cooling unit, coral stripe, headlights. */
export function ReeferTruck({ lights = true }: { lights?: boolean }) {
  return (
    <group>
      <RoundedBox args={[1.9, 1.9, 3.8]} radius={0.12} position={[0, 1.45, -0.7]} castShadow>
        <meshStandardMaterial color={C.ivory} roughness={0.4} />
      </RoundedBox>
      {Array.from({ length: 7 }, (_, i) => <mesh key={i} position={[0.96, 1.45, -2.3 + i * 0.53]}><boxGeometry args={[0.02, 1.7, 0.06]} /><meshStandardMaterial color="#d8d2ca" /></mesh>)}
      {Array.from({ length: 7 }, (_, i) => <mesh key={`l${i}`} position={[-0.96, 1.45, -2.3 + i * 0.53]}><boxGeometry args={[0.02, 1.7, 0.06]} /><meshStandardMaterial color="#d8d2ca" /></mesh>)}
      <mesh position={[0.97, 1.0, -0.7]}><boxGeometry args={[0.02, 0.18, 3.6]} /><meshStandardMaterial color={C.coral} /></mesh>
      <mesh position={[-0.97, 1.0, -0.7]}><boxGeometry args={[0.02, 0.18, 3.6]} /><meshStandardMaterial color={C.coral} /></mesh>
      <RoundedBox args={[1.2, 0.7, 0.5]} radius={0.08} position={[0, 2.25, 1.0]} castShadow><meshStandardMaterial color="#9aa5ab" metalness={0.5} roughness={0.4} /></RoundedBox>
      <RoundedBox args={[1.85, 1.45, 1.45]} radius={0.18} position={[0, 1.15, 1.95]} castShadow><meshStandardMaterial color={C.teal} roughness={0.35} metalness={0.2} /></RoundedBox>
      <mesh position={[0, 1.45, 2.68]}><boxGeometry args={[1.5, 0.6, 0.02]} /><meshPhysicalMaterial color="#9fd4e0" roughness={0.05} metalness={0.1} clearcoat={1} /></mesh>
      {[-0.93, 0.93].map((x) => <mesh key={x} position={[x, 1.45, 2.1]}><boxGeometry args={[0.02, 0.5, 0.7]} /><meshPhysicalMaterial color="#9fd4e0" roughness={0.05} clearcoat={1} /></mesh>)}
      <mesh position={[0, 0.55, 2.7]}><boxGeometry args={[1.8, 0.25, 0.12]} /><meshStandardMaterial color="#cfd6da" metalness={0.7} roughness={0.3} /></mesh>
      {[-0.65, 0.65].map((x) => <mesh key={`h${x}`} position={[x, 0.85, 2.69]}><boxGeometry args={[0.3, 0.16, 0.04]} /><meshBasicMaterial color="#fff6d8" toneMapped={false} /></mesh>)}
      <mesh position={[0, 0.45, -0.3]}><boxGeometry args={[1.6, 0.25, 5]} /><meshStandardMaterial color="#2b2f33" /></mesh>
      {[[-0.95, 0.4, 2.0], [0.95, 0.4, 2.0], [-0.95, 0.4, -0.9], [0.95, 0.4, -0.9], [-0.95, 0.4, -2.0], [0.95, 0.4, -2.0]].map((p, i) => <Wheel key={i} position={p} />)}
      {lights && <spotLight position={[0, 0.9, 2.8]} target-position={[0, 0, 9]} angle={0.5} penumbra={0.6} intensity={30} distance={14} color="#fff1c8" />}
    </group>
  );
}

/* ---------- buildings ---------- */
/** Corrugated-roof godown with a glass front, racks of crates, a cooling unit with a spinning fan. */
export function Godown({ glass = true }: { glass?: boolean }) {
  const fan = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => { if (fan.current) fan.current.rotation.z += dt * 9; });
  const roof = useMemo(() => Array.from({ length: 14 }, (_, i) => i), []);
  return (
    <group>
      <mesh position={[0, 0.06, 0]} receiveShadow><boxGeometry args={[5.4, 0.12, 4]} /><meshStandardMaterial color="#c9c2b8" /></mesh>
      {[[-2.55, 0], [2.55, 0]].map(([x], i) => <mesh key={i} position={[x, 1.5, 0]} castShadow receiveShadow><boxGeometry args={[0.15, 2.9, 3.8]} /><meshStandardMaterial color={C.ivory} roughness={0.7} /></mesh>)}
      <mesh position={[0, 1.5, -1.85]} castShadow receiveShadow><boxGeometry args={[5.2, 2.9, 0.15]} /><meshStandardMaterial color={C.ivory} roughness={0.7} /></mesh>
      {glass && <mesh position={[0, 1.5, 1.88]}><boxGeometry args={[5, 2.8, 0.04]} /><meshPhysicalMaterial color="#bfe9e4" transmission={0.9} thickness={0.2} roughness={0.05} transparent opacity={0.35} /></mesh>}
      <mesh position={[0, 2.95, 0]}><boxGeometry args={[5.3, 0.1, 3.9]} /><meshStandardMaterial color={C.teal} /></mesh>
      {roof.map((i) => [-1, 1].map((sd) => (
        <mesh key={`${i}${sd}`} position={[-2.6 + i * 0.4, 3.45, sd * 1.0]} rotation={[Math.PI / 2 + sd * 0.45, 0, 0]} castShadow>
          <cylinderGeometry args={[0.2, 0.2, 2.25, 10, 1, true, 0, Math.PI]} /><meshStandardMaterial color={i % 2 ? "#4f8f88" : "#5aa39b"} side={THREE.DoubleSide} metalness={0.4} roughness={0.4} />
        </mesh>
      )))}
      {[0, 1].map((row) => [-1.6, 0, 1.6].map((x) => <Crate key={`${row}${x}`} position={[x, 0.15 + row * 0.75, -0.6]} fill={8} seed={row * 10 + x * 3 + 7} />))}
      {[-2, 2].map((x) => <mesh key={x} position={[x * 0.95, 0.85, -0.6]}><boxGeometry args={[0.06, 1.6, 1]} /><meshStandardMaterial color="#8f9aa0" metalness={0.6} /></mesh>)}
      <group position={[2.75, 1.0, 0.6]}>
        <RoundedBox args={[0.5, 1.2, 1.2]} radius={0.06} castShadow><meshStandardMaterial color="#aab4b9" metalness={0.5} roughness={0.35} /></RoundedBox>
        <mesh position={[0.26, 0, 0]} rotation={[0, Math.PI / 2, 0]}><circleGeometry args={[0.45, 24]} /><meshStandardMaterial color="#2a2f33" /></mesh>
        <mesh ref={fan} position={[0.28, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <boxGeometry args={[0.8, 0.12, 0.02]} /><meshStandardMaterial color="#e8edf0" metalness={0.7} />
        </mesh>
      </group>
    </group>
  );
}

/** Simple farmhouse with a pitched coral roof. */
export function House() {
  return (
    <group>
      <RoundedBox args={[1.8, 1.2, 1.4]} radius={0.05} position={[0, 0.6, 0]} castShadow receiveShadow><meshStandardMaterial color="#f1e4cf" /></RoundedBox>
      <mesh position={[0, 1.55, 0]} rotation={[0, Math.PI / 4, 0]} castShadow><coneGeometry args={[1.45, 0.8, 4]} /><meshStandardMaterial color={C.coral} flatShading /></mesh>
      <mesh position={[0, 0.4, 0.71]}><boxGeometry args={[0.35, 0.7, 0.02]} /><meshStandardMaterial color={C.woodDark} /></mesh>
      {[-0.55, 0.55].map((x) => <mesh key={x} position={[x, 0.75, 0.71]}><boxGeometry args={[0.32, 0.3, 0.02]} /><meshBasicMaterial color="#ffd98a" toneMapped={false} /></mesh>)}
    </group>
  );
}

/** Canvas texture helper (screens, signs, awnings). */
export function useCanvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, deps: any[] = []) {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d")!);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
}

/** Phone showing the ZERO ROT app (decision screen). */
export function Phone() {
  const tex = useCanvasTexture(360, 720, (g) => {
    g.fillStyle = "#F3EEE8"; g.fillRect(0, 0, 360, 720);
    g.fillStyle = "#17645F"; g.font = "bold 34px sans-serif"; g.fillText("ZERO ROT", 28, 70);
    g.fillStyle = "#FF684A"; rr(g, 24, 100, 312, 150, 22);
    g.fillStyle = "#fff"; g.font = "bold 22px sans-serif"; g.fillText("ADVICE", 44, 140); g.font = "bold 40px sans-serif"; g.fillText("Sell in 3 days", 44, 195);
    g.font = "20px sans-serif"; g.fillText("+ Rs 4,200 vs today", 44, 230);
    g.fillStyle = "#fff"; rr(g, 24, 275, 312, 170, 22);
    g.fillStyle = "#17645F"; g.font = "bold 20px sans-serif"; g.fillText("Spoilage risk", 44, 312);
    g.fillStyle = "#e7e1d9"; rr(g, 44, 330, 272, 16, 8); g.fillStyle = "#3f9b62"; rr(g, 44, 330, 70, 16, 8);
    g.fillStyle = "#17645F"; g.fillText("Quality 82  ·  Rs 24/kg", 44, 390); g.fillStyle = "#888"; g.font = "16px sans-serif"; g.fillText("Kolar APMC forecast", 44, 420);
    g.fillStyle = "#17645F"; rr(g, 24, 470, 98, 90, 18); g.fillStyle = "#fff"; rr(g, 131, 470, 98, 90, 18); g.fillStyle = "#fff"; rr(g, 238, 470, 98, 90, 18);
    g.fillStyle = "#fff"; g.font = "bold 20px sans-serif"; g.fillText("Sell", 50, 525); g.fillStyle = "#17645F"; g.fillText("Store", 150, 525); g.fillStyle = "#d64545"; g.fillText("Discard", 245, 525);
    g.fillStyle = "#FF684A"; g.beginPath(); g.arc(180, 640, 38, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#fff"; rr(g, 172, 618, 16, 30, 8); g.fillRect(178, 650, 4, 10);
  });
  return (
    <group>
      <RoundedBox args={[1.6, 3.2, 0.16]} radius={0.16} smoothness={6} castShadow><meshPhysicalMaterial color="#1c2226" metalness={0.6} roughness={0.25} clearcoat={1} /></RoundedBox>
      <mesh position={[0, 0, 0.085]}><planeGeometry args={[1.42, 2.95]} /><meshBasicMaterial map={tex} toneMapped={false} /></mesh>
    </group>
  );
}

/** Laptop showing the 3D world. */
export function Laptop() {
  const tex = useCanvasTexture(640, 400, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, 400); grd.addColorStop(0, "#0e3b38"); grd.addColorStop(1, "#1f4d2c");
    g.fillStyle = grd; g.fillRect(0, 0, 640, 400);
    g.fillStyle = "#3b4a52"; g.beginPath(); g.moveTo(0, 300); g.bezierCurveTo(200, 240, 380, 340, 640, 260); g.lineTo(640, 290); g.bezierCurveTo(380, 370, 200, 270, 0, 330); g.fill();
    g.strokeStyle = "#FF684A"; g.lineWidth = 4; g.setLineDash([14, 10]); g.beginPath(); g.moveTo(0, 315); g.bezierCurveTo(200, 255, 380, 355, 640, 275); g.stroke(); g.setLineDash([]);
    g.fillStyle = "#F3EEE8"; rr(g, 300, 255, 60, 30, 6); g.fillStyle = "#17645F"; rr(g, 355, 260, 22, 22, 5);
    g.fillStyle = "#F3EEE8"; rr(g, 20, 20, 210, 60, 14); g.fillStyle = "#17645F"; g.font = "bold 22px sans-serif"; g.fillText("Live · backend", 36, 58);
    g.fillStyle = "rgba(243,238,232,.92)"; rr(g, 430, 20, 190, 120, 14);
    g.fillStyle = "#17645F"; g.font = "bold 18px sans-serif"; g.fillText("Inside 12.5 °C", 448, 55); g.fillText("Quality 88", 448, 85); g.fillStyle = "#FF684A"; g.fillText("Rerouted 1×", 448, 115);
    g.fillStyle = "#7fe3d6"; [120, 220, 520].forEach((x) => { g.beginPath(); g.arc(x, x === 220 ? 268 : x === 120 ? 282 : 286, 8, 0, Math.PI * 2); g.fill(); });
  });
  return (
    <group>
      <RoundedBox args={[3.4, 0.12, 2.3]} radius={0.05} position={[0, 0.06, 0]} castShadow><meshStandardMaterial color="#c3c9cd" metalness={0.7} roughness={0.3} /></RoundedBox>
      <mesh position={[0, 0.125, 0.2]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[3, 1.3]} /><meshStandardMaterial color="#2a2f33" /></mesh>
      <group position={[0, 0.1, -1.12]} rotation={[-0.25, 0, 0]}>
        <RoundedBox args={[3.4, 2.2, 0.08]} radius={0.05} position={[0, 1.1, 0]} castShadow><meshStandardMaterial color="#c3c9cd" metalness={0.7} roughness={0.3} /></RoundedBox>
        <mesh position={[0, 1.12, 0.045]}><planeGeometry args={[3.15, 1.95]} /><meshBasicMaterial map={tex} toneMapped={false} /></mesh>
      </group>
    </group>
  );
}

/** Market stall with a striped awning and produce baskets. */
export function Stall({ stripe = C.coral, seed = 1 }: { stripe?: string; seed?: number }) {
  const tex = useCanvasTexture(256, 64, (g) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? "#F3EEE8" : stripe; g.fillRect(i * 32, 0, 32, 64); } }, [stripe]);
  const r = useMemo(() => seeded(seed), [seed]);
  const fruit = useMemo(() => Array.from({ length: 14 }, () => [(r() - 0.5) * 1.6, 1.05 + r() * 0.15, (r() - 0.5) * 0.5, r()]), [r]);
  return (
    <group>
      <RoundedBox args={[2.2, 0.9, 1]} radius={0.05} position={[0, 0.45, 0]} castShadow receiveShadow><meshStandardMaterial color={C.wood} /></RoundedBox>
      {[[-1, -0.45], [1, -0.45], [-1, 0.45], [1, 0.45]].map(([x, z], i) => <mesh key={i} position={[x, 1.3, z]}><cylinderGeometry args={[0.04, 0.04, 2.6, 6]} /><meshStandardMaterial color={C.woodDark} /></mesh>)}
      <mesh position={[0, 2.55, 0.15]} rotation={[0.3, 0, 0]} castShadow><boxGeometry args={[2.5, 0.06, 1.5]} /><meshStandardMaterial map={tex} /></mesh>
      {fruit.map(([x, y, z, k], i) => <Tomato key={i} position={[x, y, z]} scale={0.13} rotation={[k * 4, k * 6, 0]} />)}
    </group>
  );
}

/** Stack of gold coins. */
export function Coins({ count = 6 }: { count?: number }) {
  return <group>{Array.from({ length: count }, (_, i) => <mesh key={i} position={[(i % 2) * 0.02, 0.05 + i * 0.1, 0]} castShadow><cylinderGeometry args={[0.35, 0.35, 0.09, 28]} /><meshStandardMaterial color="#f5c542" metalness={0.55} roughness={0.3} emissive="#7a5200" emissiveIntensity={0.35} /></mesh>)}</group>;
}
