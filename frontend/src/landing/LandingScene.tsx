import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Float, Sparkles, Stars } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";

/** One continuous world; each slide is a station along a camera path. `progress` (0..4) is animated by the page. */
export type Flight = { progress: number; speed: number };

const CAM = [new THREE.Vector3(6, 9, 24), new THREE.Vector3(14, 5, -34), new THREE.Vector3(-12, 7, -84), new THREE.Vector3(10, 5, -134), new THREE.Vector3(0, 9, -186)];
const LOOK = [new THREE.Vector3(-2, 1, -6), new THREE.Vector3(-7, 1.5, -50), new THREE.Vector3(-15, 3, -100), new THREE.Vector3(-8, 1.5, -150), new THREE.Vector3(-9, 3, -205)];
const camCurve = new THREE.CatmullRomCurve3(CAM, false, "centripetal");
const lookCurve = new THREE.CatmullRomCurve3(LOOK, false, "centripetal");
const SKY = ["#0e3b38", "#2a0f12", "#06222a", "#10232b", "#2b1a0c"].map((c) => new THREE.Color(c));
const GROUND = ["#1f4d2c", "#3a2416", "#0d2d33", "#1d2a2e", "#3d3020"].map((c) => new THREE.Color(c));
const LIGHT = ["#ffd7a8", "#ff6b5a", "#7fe3d6", "#ffd0a0", "#ffc070"].map((c) => new THREE.Color(c));

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function lerpColor(arr: THREE.Color[], p: number, out: THREE.Color) {
  const i = Math.min(arr.length - 2, Math.floor(p)), f = p - i;
  return out.copy(arr[i]).lerp(arr[i + 1], Math.min(1, Math.max(0, f)));
}

function Rig({ flight }: { flight: React.MutableRefObject<Flight> }) {
  const { camera, scene } = useThree();
  const look = useRef(new THREE.Vector3());
  const light = useRef<THREE.DirectionalLight>(null);
  const tmp = useMemo(() => new THREE.Color(), []);
  useFrame((st) => {
    const p = flight.current.progress, t = Math.min(1, Math.max(0, p / 4));
    const sway = Math.sin(st.clock.elapsedTime * 0.25) * 0.6;
    camera.position.copy(camCurve.getPointAt(t)).add(new THREE.Vector3(sway, Math.sin(st.clock.elapsedTime * 0.4) * 0.25, 0));
    look.current.copy(lookCurve.getPointAt(t));
    camera.lookAt(look.current);
    const sky = lerpColor(SKY, p, tmp);
    (scene.background as THREE.Color).copy(sky);
    scene.fog!.color.copy(sky);
    if (light.current) lerpColor(LIGHT, p, light.current.color);
  });
  return <directionalLight ref={light} position={[20, 30, 10]} intensity={2.2} castShadow={false} />;
}

function Ground({ flight }: { flight: React.MutableRefObject<Flight> }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(() => { if (mat.current) lerpColor(GROUND, flight.current.progress, mat.current.color); });
  return <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -100]}><planeGeometry args={[400, 500]} /><meshStandardMaterial ref={mat} roughness={1} /></mesh>;
}

/** Light streaks that stretch with flight speed: the "warp" between slides. */
function Streaks({ flight }: { flight: React.MutableRefObject<Flight> }) {
  const N = 260;
  const ref = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => { const r = seeded(7); return Array.from({ length: N }, () => [r() * 2 - 1, r() * 2 - 1, r()]); }, []);
  const m = useMemo(() => new THREE.Matrix4(), []), q = useMemo(() => new THREE.Quaternion(), []), v = useMemo(() => new THREE.Vector3(), []), sc = useMemo(() => new THREE.Vector3(), []);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((st) => {
    const cam = st.camera, sp = Math.min(1, flight.current.speed * 1.6);
    const dir = new THREE.Vector3(); cam.getWorldDirection(dir);
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    for (let i = 0; i < N; i++) {
      const [x, y, z] = seeds[i];
      const depth = ((z * 60 + st.clock.elapsedTime * (6 + sp * 120)) % 60);
      v.set(x * 14, y * 8, 0).applyQuaternion(q).add(cam.position).addScaledVector(dir, 60 - depth);
      sc.set(0.03, 0.03, 0.2 + sp * 9);
      m.compose(v, q, sc);
      ref.current!.setMatrixAt(i, m);
    }
    ref.current!.instanceMatrix.needsUpdate = true;
    if (mat.current) mat.current.opacity = 0.08 + sp * 0.75;
  });
  return <instancedMesh ref={ref} args={[undefined, undefined, N]} frustumCulled={false}><boxGeometry args={[1, 1, 1]} /><meshBasicMaterial ref={mat} color="#ffd9b0" transparent depthWrite={false} toneMapped={false} /></instancedMesh>;
}

/* ---------- station 0: the farm at sunrise ---------- */
function Farm() {
  const rows = useRef<THREE.InstancedMesh>(null), fruit = useRef<THREE.InstancedMesh>(null);
  const pts = useMemo(() => { const out: [number, number][] = []; for (let r = -6; r <= 6; r++) for (let c = -12; c <= 12; c++) out.push([c * 1.4, r * 1.8 - 4]); return out; }, []);
  useFrame((st) => {
    const m = new THREE.Matrix4(), t = st.clock.elapsedTime;
    pts.forEach(([x, z], i) => {
      const s = 0.8 + 0.25 * Math.sin(t * 1.3 + i * 0.37);
      m.makeRotationZ(Math.sin(t * 0.9 + x * 0.3) * 0.08).setPosition(x, 0.7 * s, z); m.scale(new THREE.Vector3(s, s, s));
      rows.current!.setMatrixAt(i, m);
      m.makeTranslation(x + 0.25, 1.15 * s, z + 0.1);
      fruit.current!.setMatrixAt(i, m);
    });
    rows.current!.instanceMatrix.needsUpdate = true; fruit.current!.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      <instancedMesh ref={rows} args={[undefined, undefined, pts.length]}><coneGeometry args={[0.45, 1.4, 6]} /><meshStandardMaterial color="#3f8f3a" roughness={0.8} /></instancedMesh>
      <instancedMesh ref={fruit} args={[undefined, undefined, pts.length]}><sphereGeometry args={[0.15, 12, 10]} /><meshStandardMaterial color="#ff4a2e" emissive="#ff3b1f" emissiveIntensity={0.5} /></instancedMesh>
      <mesh position={[-18, 14, -40]}><sphereGeometry args={[5, 32, 24]} /><meshBasicMaterial color="#ffb067" toneMapped={false} /></mesh>
      <Sparkles count={120} scale={[40, 8, 30]} position={[0, 4, -4]} size={3} speed={0.4} color="#ffe2a8" />
    </group>
  );
}

/* ---------- station 1: the loss ---------- */
function Loss() {
  const pile = useRef<THREE.InstancedMesh>(null), bars = useRef<THREE.Group>(null);
  const N = 420;
  const items = useMemo(() => { const r = seeded(3); return Array.from({ length: N }, () => { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 6; return [Math.cos(a) * d, Math.max(0.2, (6 - d) * 0.55 * r() + 0.2), Math.sin(a) * d, r()]; }); }, []);
  useEffect(() => {
    {
      if (!pile.current) return;
      const m = new THREE.Matrix4(), c = new THREE.Color();
      items.forEach(([x, y, z, k], i) => { m.makeTranslation(x, y, z); pile.current!.setMatrixAt(i, m); pile.current!.setColorAt(i, c.set(k > 0.6 ? "#5a2a14" : k > 0.3 ? "#8a2b1c" : "#b8341f")); });
      pile.current.instanceMatrix.needsUpdate = true; if (pile.current.instanceColor) pile.current.instanceColor.needsUpdate = true;
    }
  }, [items]);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    bars.current?.children.forEach((b, i) => { const h = Math.max(0.3, (7 - i) * 1.1 + Math.sin(t * 2 + i) * 0.4 - ((t * 0.8) % 3)); b.scale.y = h; b.position.y = h / 2; });
  });
  return (
    <group position={[4, 0, -50]}>
      <instancedMesh ref={pile} args={[undefined, undefined, N]}><sphereGeometry args={[0.32, 10, 8]} /><meshStandardMaterial roughness={0.9} /></instancedMesh>
      <group ref={bars} position={[-10, 0, -4]}>
        {Array.from({ length: 7 }, (_, i) => <mesh key={i} position={[i * 1.3, 1, 0]}><boxGeometry args={[0.9, 1, 0.9]} /><meshStandardMaterial color="#ff4d4d" emissive="#ff2020" emissiveIntensity={0.8} /></mesh>)}
      </group>
      <pointLight position={[0, 6, 2]} intensity={60} distance={30} color="#ff3b30" />
      <Sparkles count={140} scale={[12, 5, 12]} position={[0, 3, 0]} size={2.5} speed={1.8} color="#2a1a10" opacity={0.9} />
    </group>
  );
}

/* ---------- station 2: the digital twin ---------- */
function Twin() {
  const rings = useRef<THREE.Group>(null), panels = useRef<THREE.Group>(null);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    rings.current?.children.forEach((r, i) => { r.rotation.x = t * (0.3 + i * 0.15); r.rotation.y = t * (0.2 + i * 0.1); });
    if (panels.current) panels.current.rotation.y = t * 0.25;
  });
  return (
    <group position={[-4, 0, -100]}>
      <mesh position={[0, 2.5, 0]}><boxGeometry args={[7, 5, 5]} /><meshStandardMaterial color="#7fe3d6" transparent opacity={0.12} emissive="#17645F" emissiveIntensity={0.6} /></mesh>
      <lineSegments position={[0, 2.5, 0]}><edgesGeometry args={[new THREE.BoxGeometry(7, 5, 5)]} /><lineBasicMaterial color="#7fe3d6" toneMapped={false} /></lineSegments>
      <group ref={rings} position={[0, 2.5, 0]}>
        {[3, 4.2, 5.4].map((r, i) => <mesh key={i}><torusGeometry args={[r, 0.04, 8, 96]} /><meshBasicMaterial color={i === 1 ? "#FF684A" : "#7fe3d6"} toneMapped={false} /></mesh>)}
      </group>
      <group ref={panels} position={[0, 3, 0]}>
        {Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2; return (
          <Float key={i} speed={2} floatIntensity={1}>
            <mesh position={[Math.cos(a) * 8, (i % 3) - 1, Math.sin(a) * 8]} rotation={[0, -a + Math.PI / 2, 0]}>
              <planeGeometry args={[2.4, 1.4]} /><meshBasicMaterial color={i % 2 ? "#FF684A" : "#7fe3d6"} transparent opacity={0.35} side={THREE.DoubleSide} toneMapped={false} />
            </mesh>
          </Float>); })}
      </group>
      <Sparkles count={160} scale={[16, 8, 16]} position={[0, 3, 0]} size={2} speed={0.6} color="#7fe3d6" />
    </group>
  );
}

/* ---------- station 3: the road ---------- */
function Road() {
  const truck = useRef<THREE.Group>(null);
  const curve = useMemo(() => new THREE.CatmullRomCurve3([new THREE.Vector3(-30, 0.05, -140), new THREE.Vector3(-10, 0.05, -150), new THREE.Vector3(8, 0.05, -146), new THREE.Vector3(26, 0.05, -160)]), []);
  const road = useMemo(() => new THREE.TubeGeometry(curve, 120, 1.6, 4, false), [curve]);
  const dash = useRef<THREE.Mesh>(null);
  useFrame((st) => {
    const u = (st.clock.elapsedTime * 0.06) % 1, p = curve.getPointAt(u), tg = curve.getTangentAt(u);
    truck.current?.position.set(p.x, 0.9, p.z);
    truck.current?.rotation.set(0, Math.atan2(tg.x, tg.z), 0);
    if (dash.current) (dash.current.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(st.clock.elapsedTime * 4) * 0.3;
  });
  return (
    <group>
      <mesh geometry={road} scale={[1, 0.05, 1]}><meshStandardMaterial color="#2b3236" roughness={0.9} /></mesh>
      <mesh ref={dash} geometry={useMemo(() => new THREE.TubeGeometry(curve, 120, 0.12, 4, false), [curve])} position={[0, 0.12, 0]}><meshBasicMaterial color="#FF684A" transparent toneMapped={false} /></mesh>
      {[0.15, 0.4, 0.65, 0.9].map((u, i) => { const p = curve.getPointAt(u); return (
        <group key={i} position={[p.x, 0, p.z + 3]}>
          <mesh position={[0, 1.6, 0]}><cylinderGeometry args={[0.08, 0.08, 3.2, 8]} /><meshStandardMaterial color="#cfd8dc" /></mesh>
          <Float speed={3} floatIntensity={0.6}><mesh position={[0, 3.6, 0]}><octahedronGeometry args={[0.45]} /><meshBasicMaterial color="#7fe3d6" toneMapped={false} /></mesh></Float>
        </group>); })}
      <group ref={truck}>
        <mesh position={[0, 0.3, -0.6]}><boxGeometry args={[1.8, 1.8, 3.6]} /><meshStandardMaterial color="#f3eee8" /></mesh>
        <mesh position={[0, 0, 1.7]}><boxGeometry args={[1.7, 1.3, 1.3]} /><meshStandardMaterial color="#17645F" /></mesh>
        <mesh position={[0, 0.2, 2.36]}><boxGeometry args={[1.2, 0.5, 0.05]} /><meshBasicMaterial color="#bfefff" toneMapped={false} /></mesh>
        {[[-0.9, 1.4], [0.9, 1.4], [-0.9, -1.4], [0.9, -1.4]].map(([x, z], i) => <mesh key={i} position={[x, -0.75, z]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.4, 0.4, 0.3, 16]} /><meshStandardMaterial color="#111" /></mesh>)}
        <pointLight position={[0, 0.3, 3]} intensity={20} distance={12} color="#fff1c8" />
      </group>
    </group>
  );
}

/* ---------- station 4: the market, profits up ---------- */
function Market() {
  const bars = useRef<THREE.Group>(null);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    bars.current?.children.forEach((b, i) => { const h = 1 + i * 1.1 + Math.sin(t * 1.5 + i) * 0.3; b.scale.y = h; b.position.y = h / 2; });
  });
  return (
    <group position={[0, 0, -205]}>
      {[-8, -3, 2, 7].map((x, i) => (
        <group key={i} position={[x, 0, 4]}>
          <mesh position={[0, 1, 0]}><boxGeometry args={[3.6, 2, 2.4]} /><meshStandardMaterial color="#e0a92e" /></mesh>
          <mesh position={[0, 2.6, 0]} rotation={[0, 0, 0]}><coneGeometry args={[2.8, 1.2, 4]} /><meshStandardMaterial color={i % 2 ? "#FF684A" : "#17645F"} /></mesh>
        </group>
      ))}
      <group ref={bars} position={[-4, 0, -4]}>
        {Array.from({ length: 7 }, (_, i) => <mesh key={i} position={[i * 1.3, 1, 0]}><boxGeometry args={[0.9, 1, 0.9]} /><meshStandardMaterial color="#3fd17a" emissive="#22b35a" emissiveIntensity={0.9} /></mesh>)}
      </group>
      <mesh position={[16, 16, -40]}><sphereGeometry args={[6, 32, 24]} /><meshBasicMaterial color="#ffcf70" toneMapped={false} /></mesh>
      <Sparkles count={220} scale={[30, 14, 20]} position={[0, 6, 0]} size={4} speed={0.8} color="#ffd27a" />
    </group>
  );
}

export default function LandingScene({ flight }: { flight: React.MutableRefObject<Flight> }) {
  return (
    <Canvas dpr={[1, 1.75]} camera={{ fov: 50, near: 0.1, far: 400, position: [6, 9, 24] }} gl={{ antialias: true }}
      onCreated={({ scene }) => { scene.background = new THREE.Color(SKY[0]); scene.fog = new THREE.Fog(SKY[0], 22, 70); }}>
      <ambientLight intensity={0.55} />
      <hemisphereLight args={["#ffffff", "#223", 0.5]} />
      <Rig flight={flight} />
      <Ground flight={flight} />
      <Stars radius={180} depth={40} count={1800} factor={4} fade speed={0.6} />
      <Farm />
      <Loss />
      <Twin />
      <Road />
      <Market />
      <Streaks flight={flight} />
      <EffectComposer multisampling={0}>
        <Bloom intensity={0.9} luminanceThreshold={0.55} luminanceSmoothing={0.2} mipmapBlur />
        <Vignette offset={0.25} darkness={0.7} />
      </EffectComposer>
    </Canvas>
  );
}
