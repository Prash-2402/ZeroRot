import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { qualityColor, tempColor } from "../lib/format";
import { asphaltTex, beltTex, brickTex, concreteTex, crateTex, fieldTex, metalRoofTex, panelTex, roofTex, sackTex, softDotTex } from "./textures";
import { HUB_RADIUS, seeded } from "./geo";
import { TractorTrolley } from "./Vehicles";

export const SITES = {
  trad: new THREE.Vector3(-30, 0, -20),
  adv: new THREE.Vector3(2, 0, -24),
  grading: new THREE.Vector3(38, 0, -20),
  farm: new THREE.Vector3(-70, 0, 0),
  yard: new THREE.Vector3(0, 0, 8),
};
const GRADE_COLOR: Record<string, string> = { A1: "#5FB37C", A2: "#FFC900", A3: "#F2994A", rejected: "#EB4D3D", uncertain: "#8A9099" };
const PRODUCE: Record<string, string> = { tomato: "#d6402c", mango: "#e8a93a", banana: "#e5c640", potato: "#b48a5a", onion: "#b5577a" };

export function Label({ position, children, show = true, dim = false }: { position: [number, number, number]; children: React.ReactNode; show?: boolean; dim?: boolean }) {
  if (!show) return null;
  return (
    <Html position={position} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
      <div className={`whitespace-nowrap border px-1.5 py-0.5 font-mono text-[10px] leading-tight shadow-xl ${dim ? "border-white/10 bg-ink/60 text-ink-300" : "border-gold/60 bg-ink/85 text-paper"}`}>{children}</div>
    </Html>
  );
}

/* ---------- crates inside a godown ---------- */
function CrateStack({ count, max, w, d, quality, commodity, rack = false }: { count: number; max: number; w: number; d: number; quality: number; commodity: string; rack?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const tops = useRef<THREE.InstancedMesh>(null);
  const slots = useMemo(() => {
    const out: [number, number, number][] = [];
    const cols = Math.max(1, Math.floor(w / 1.35)), rows = Math.max(1, Math.floor(d / 1.0));
    const layers = Math.ceil(max / (cols * rows));
    for (let l = 0; l < layers; l++) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push([-w / 2 + 0.7 + c * 1.35, (rack ? 0.25 + l * 1.25 : l * 0.85) + 0.42, -d / 2 + 0.55 + r * 1.0]);
    return out.slice(0, max);
  }, [w, d, max, rack]);
  const tex = crateTex();
  const topColor = useMemo(() => new THREE.Color(PRODUCE[commodity] || "#c0503a").lerp(new THREE.Color("#4a3a22"), Math.max(0, (85 - quality) / 60)), [commodity, quality]);
  useEffect(() => {
    const m = new THREE.Matrix4();
    for (let i = 0; i < slots.length; i++) {
      const [x, y, z] = slots[i];
      m.makeTranslation(x, i < count ? y : -50, z); ref.current!.setMatrixAt(i, m);
      m.makeTranslation(x, i < count ? y + 0.36 : -50, z); tops.current!.setMatrixAt(i, m);
    }
    ref.current!.instanceMatrix.needsUpdate = true; tops.current!.instanceMatrix.needsUpdate = true;
  }, [count, slots]);
  return (
    <>
      <instancedMesh ref={ref} args={[undefined, undefined, slots.length]} castShadow receiveShadow><boxGeometry args={[1.2, 0.8, 0.85]} /><meshStandardMaterial map={tex} /></instancedMesh>
      <instancedMesh ref={tops} args={[undefined, undefined, slots.length]}><boxGeometry args={[1.05, 0.12, 0.7]} /><meshStandardMaterial color={topColor} roughness={0.5} /></instancedMesh>
    </>
  );
}

function Particles({ count, box, color, rise, opacity = 0.5, size = 0.35 }: { count: number; box: [number, number, number]; color: string; rise: number; opacity?: number; size?: number }) {
  const ref = useRef<THREE.Points>(null);
  const pos = useMemo(() => {
    const r = seeded(count + Math.round(box[0]));
    const a = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) a.set([(r() - 0.5) * box[0], r() * box[1], (r() - 0.5) * box[2]], i * 3);
    return a;
  }, [count, box[0], box[1], box[2]]);
  useFrame((_, dt) => {
    const g = ref.current?.geometry.attributes.position as THREE.BufferAttribute | undefined;
    if (!g) return;
    const arr = g.array as Float32Array;
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] += rise * dt;
      arr[i * 3] += Math.sin((arr[i * 3 + 1] + i) * 0.7) * dt * 0.3;
      if (arr[i * 3 + 1] > box[1]) arr[i * 3 + 1] = 0;
      if (arr[i * 3 + 1] < 0) arr[i * 3 + 1] = box[1];
    }
    g.needsUpdate = true;
  });
  return (
    <points ref={ref}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[pos, 3]} /></bufferGeometry>
      <pointsMaterial map={softDotTex()} size={size} color={color} transparent opacity={opacity} depthWrite={false} sizeAttenuation />
    </points>
  );
}

function visibleCrates(lot: any, N: number) {
  if (!lot) return 0;
  const st = lot.storage;
  if (lot.stage === "intake") return Math.round(N * (st?.loading?.progress ?? 0));
  if (lot.stage === "storage") return N;
  if ((lot.stage === "grading" || lot.stage === "graded") && lot.grading) return Math.round(N * (1 - lot.grading.processed_kg / Math.max(1, lot.grading.total_kg)));
  return 0;
}

/* ---------- traditional brick godown ---------- */
function TraditionalGodown({ lot, cutaway, labels, night }: { lot: any; cutaway: boolean; labels: boolean; night: boolean }) {
  const W = 16, D = 10, H = 5;
  const st = lot?.storage;
  const eq = st?.equipment || {};
  const leftDoor = useRef<THREE.Group>(null), rightDoor = useRef<THREE.Group>(null);
  const louvers = useRef<THREE.Group[]>([]);
  useFrame((_, dt) => {
    const k = Math.min(1, dt * 3);
    const open = eq.door_open ? 1.6 : 0;
    if (leftDoor.current) leftDoor.current.rotation.y += (open - leftDoor.current.rotation.y) * k;
    if (rightDoor.current) rightDoor.current.rotation.y += (-open - rightDoor.current.rotation.y) * k;
    for (const l of louvers.current) if (l) l.rotation.x += ((eq.vents_open !== false ? 1.1 : 0) - l.rotation.x) * k;
  });
  const brick = brickTex(), roof = roofTex(), floor = concreteTex();
  const t = st?.readings?.temperature_c;
  const ref = 12;
  const N = lot ? Math.max(8, Math.min(140, Math.ceil(lot.quantity_kg / 40))) : 0;
  const wallMat = <meshStandardMaterial map={brick} roughness={0.95} />;
  const roofOpacity = cutaway ? 0.08 : 1;
  return (
    <group position={SITES.trad.toArray()}>
      <mesh position={[0, 0.05, 0]} receiveShadow><boxGeometry args={[W, 0.1, D]} /><meshStandardMaterial map={floor} /></mesh>
      <mesh position={[0, H / 2, -D / 2]} castShadow receiveShadow><boxGeometry args={[W, H, 0.4]} />{wallMat}</mesh>
      <mesh position={[-W / 2, H / 2, 0]} castShadow receiveShadow><boxGeometry args={[0.4, H, D]} />{wallMat}</mesh>
      <mesh position={[W / 2, H / 2, 0]} castShadow receiveShadow><boxGeometry args={[0.4, H, D]} />{wallMat}</mesh>
      {/* front wall with door opening (3.2 x 3.6) */}
      <mesh position={[-(W / 4 + 0.8), H / 2, D / 2]} castShadow><boxGeometry args={[W / 2 - 1.6, H, 0.4]} />{wallMat}</mesh>
      <mesh position={[W / 4 + 0.8, H / 2, D / 2]} castShadow><boxGeometry args={[W / 2 - 1.6, H, 0.4]} />{wallMat}</mesh>
      <mesh position={[0, H - 0.7, D / 2]} castShadow><boxGeometry args={[3.2, 1.4, 0.4]} />{wallMat}</mesh>
      <group ref={leftDoor} position={[-1.6, 0, D / 2 + 0.22]}><mesh position={[0.8, 1.8, 0]} castShadow><boxGeometry args={[1.6, 3.6, 0.12]} /><meshStandardMaterial color="#5a3d22" /></mesh></group>
      <group ref={rightDoor} position={[1.6, 0, D / 2 + 0.22]}><mesh position={[-0.8, 1.8, 0]} castShadow><boxGeometry args={[1.6, 3.6, 0.12]} /><meshStandardMaterial color="#5a3d22" /></mesh></group>
      {/* louvered vents on both side walls */}
      {[-W / 2 - 0.22, W / 2 + 0.22].flatMap((x, si) => [-2.5, 2.5].map((z, vi) => (
        <group key={`${x}${z}`} position={[x, H - 1.2, z]}>
          <mesh><boxGeometry args={[0.1, 1.2, 1.8]} /><meshStandardMaterial color="#2a2018" /></mesh>
          {[0, 1, 2, 3].map((k) => (
            <group key={k} position={[x > 0 ? 0.05 : -0.05, 0.42 - k * 0.28, 0]} ref={(el) => { if (el) louvers.current[si * 8 + vi * 4 + k] = el; }}>
              <mesh><boxGeometry args={[0.05, 0.05, 1.7]} /><meshStandardMaterial color="#8a6a44" /></mesh>
              <mesh position={[0, -0.1, 0]}><boxGeometry args={[0.04, 0.22, 1.7]} /><meshStandardMaterial color="#8a6a44" /></mesh>
            </group>
          ))}
        </group>
      )))}
      {/* gable roof */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, H + 1.25, s * D / 4 + s * 0.05]} rotation={[s * -0.46, 0, 0]} castShadow={!cutaway}>
          <boxGeometry args={[W + 1.2, 0.18, D / 2 / Math.cos(0.46) + 0.9]} />
          <meshStandardMaterial map={roof} transparent={cutaway} opacity={roofOpacity} depthWrite={!cutaway} />
        </mesh>
      ))}
      {[-W / 2, W / 2].map((x) => (
        <mesh key={x} position={[x, H + 0.05, 0]} rotation={[0, Math.PI / 2, 0]}>
          <shapeGeometry args={[(() => { const s = new THREE.Shape(); s.moveTo(-D / 2, 0); s.lineTo(D / 2, 0); s.lineTo(0, 2.5); s.closePath(); return s; })()]} />
          <meshStandardMaterial map={brick} side={THREE.DoubleSide} transparent={cutaway} opacity={cutaway ? 0.15 : 1} />
        </mesh>
      ))}
      {lot && night && <pointLight position={[0, H - 0.6, 0]} intensity={350} distance={26} color="#ffd9a0" />}
      {lot && <group position={[0, 0.1, -0.8]}><CrateStack count={visibleCrates(lot, N)} max={N} w={W - 3} d={D - 4} quality={st?.produce?.quality ?? 90} commodity={lot.commodity} /></group>}
      {lot && t != null && (
        <>
          <mesh position={[0, H / 2, 0]}><boxGeometry args={[W - 0.9, H - 0.2, D - 0.9]} /><meshBasicMaterial color={tempColor(t, ref)} transparent opacity={0.09} depthWrite={false} /></mesh>
          {t > 26 && <group position={[0, 0.3, 0]}><Particles count={Math.round(30 + (t - 26) * 15)} box={[W - 2, H - 1, D - 2]} color="#ff9a50" rise={0.6 + (t - 26) * 0.08} opacity={0.35} /></group>}
          {eq.vents_open !== false && <group position={[W / 2 + 1.2, H - 1.8, 0]}><Particles count={40} box={[2, 1.5, 6]} color="#dfe8f0" rise={0.25} opacity={0.25} size={0.5} /></group>}
        </>
      )}
      <Label position={[0, H + 4.2, 0]} show={labels} dim={!lot}>
        <div className="font-sans text-[10px] uppercase tracking-widest text-gold">Traditional godown</div>
        {lot && st ? <>{t?.toFixed(1)} °C · {st.readings.rh_pct.toFixed(0)}% RH · Q {st.produce.quality.toFixed(0)}<br />door {eq.door_open ? "OPEN" : "closed"} · vents {eq.vents_open ? "open" : "closed"}</> : "idle"}
      </Label>
    </group>
  );
}

/* ---------- advanced cold godown ---------- */
function AdvancedGodown({ lot, cutaway, labels, night }: { lot: any; cutaway: boolean; labels: boolean; night: boolean }) {
  const W = 22, D = 12, H = 7;
  const st = lot?.storage;
  const eq = st?.equipment || {};
  const qCool = st?.flows?.q_cool_w ?? 0;
  const door = useRef<THREE.Group>(null);
  const fans = useRef<THREE.Mesh[]>([]);
  useFrame((_, dt) => {
    if (door.current) door.current.position.y += ((eq.door_open ? 4.0 : 0) - door.current.position.y) * Math.min(1, dt * 2.5);
    for (const f of fans.current) if (f) f.rotation.z += dt * (qCool > 0 ? 4 + qCool / 1500 : 0);
  });
  const panel = panelTex(), floor = concreteTex();
  const t = st?.readings?.temperature_c;
  const sp = st?.setpoint ?? 13;
  const N = lot ? Math.max(8, Math.min(150, Math.ceil(lot.quantity_kg / 40))) : 0;
  const op = cutaway ? 0.12 : 1;
  const wall = (args: [number, number, number], pos: [number, number, number], transparent = false) => (
    <mesh position={pos} castShadow={!transparent} receiveShadow><boxGeometry args={args} /><meshStandardMaterial map={panel} transparent={transparent} opacity={transparent ? op : 1} depthWrite={!transparent || !cutaway} /></mesh>
  );
  return (
    <group position={SITES.adv.toArray()}>
      <mesh position={[0, 0.05, 0]} receiveShadow><boxGeometry args={[W, 0.1, D]} /><meshStandardMaterial map={floor} color="#c8ccd0" /></mesh>
      {wall([W, H, 0.4], [0, H / 2, -D / 2])}
      {wall([0.4, H, D], [-W / 2, H / 2, 0])}
      {wall([0.4, H, D], [W / 2, H / 2, 0], true)}
      {wall([W / 2 - 2.2, H, 0.4], [-(W / 4 + 1.1), H / 2, D / 2], true)}
      {wall([W / 2 - 2.2, H, 0.4], [W / 4 + 1.1, H / 2, D / 2], true)}
      {wall([4.4, H - 4.2, 0.4], [0, H - (H - 4.2) / 2, D / 2], true)}
      <mesh position={[0, H + 0.1, 0]} castShadow={!cutaway}><boxGeometry args={[W + 0.6, 0.3, D + 0.6]} /><meshStandardMaterial map={metalRoofTex()} transparent={cutaway} opacity={cutaway ? 0.06 : 1} depthWrite={!cutaway} /></mesh>
      <mesh position={[0, H - 0.6, D / 2 + 0.22]}><boxGeometry args={[W, 0.35, 0.05]} /><meshStandardMaterial color="#FF684A" emissive="#FF684A" emissiveIntensity={0.2} /></mesh>
      {/* roll-up door */}
      <group ref={door} position={[0, 0, D / 2 + 0.25]}>
        {Array.from({ length: 8 }, (_, i) => <mesh key={i} position={[0, 0.25 + i * 0.5, 0]}><boxGeometry args={[4.3, 0.46, 0.1]} /><meshStandardMaterial color="#cfd5da" metalness={0.5} roughness={0.4} /></mesh>)}
      </group>
      {/* evaporators inside on the back wall */}
      {[-6, 0, 6].map((x, i) => (
        <group key={x} position={[x, H - 1.5, -D / 2 + 0.7]}>
          <mesh><boxGeometry args={[3.2, 0.9, 0.8]} /><meshStandardMaterial color={eq.cooling_failed ? "#5b616b" : "#9aa7b0"} /></mesh>
          {[-0.8, 0.8].map((fx, k) => <mesh key={fx} ref={(el) => { if (el) fans.current[i * 2 + k] = el; }} position={[fx, 0, 0.42]}><circleGeometry args={[0.33, 6]} /><meshStandardMaterial color="#1a1d22" /></mesh>)}
        </group>
      ))}
      {qCool > 0 && <group position={[0, H - 2.4, -D / 2 + 3]}><Particles count={90} box={[W - 4, 2.2, 4]} color="#bfe3ff" rise={-0.5} opacity={0.35} size={0.6} /></group>}
      {/* condensing units outside the side wall */}
      {[-3, 3].map((z, i) => (
        <group key={z} position={[-W / 2 - 1.4, 1.1, z]}>
          <mesh castShadow><boxGeometry args={[1.8, 2.2, 2.4]} /><meshStandardMaterial color="#d8dde1" /></mesh>
          <mesh ref={(el) => { if (el) fans.current[6 + i] = el; }} position={[-0.92, 0.3, 0]} rotation={[0, -Math.PI / 2, 0]}><circleGeometry args={[0.8, 6]} /><meshStandardMaterial color="#25282d" /></mesh>
          <mesh position={[-0.93, 0.95, 0.9]}><sphereGeometry args={[0.09]} /><meshStandardMaterial color={eq.cooling_failed ? "#EB4D3D" : "#5FB37C"} emissive={eq.cooling_failed ? "#EB4D3D" : "#5FB37C"} emissiveIntensity={4} /></mesh>
        </group>
      ))}
      {lot && night && <pointLight position={[-5, H - 0.8, 0]} intensity={400} distance={24} color="#e6f2ff" />}
      {lot && night && <pointLight position={[5, H - 0.8, 0]} intensity={400} distance={24} color="#e6f2ff" />}
      {/* racks + crates */}
      {lot && <group position={[0, 0.1, 0.4]}><CrateStack count={visibleCrates(lot, N)} max={N} w={W - 4} d={D - 4.5} quality={st?.produce?.quality ?? 90} commodity={lot.commodity} rack /></group>}
      {lot && t != null && <mesh position={[0, H / 2, 0]}><boxGeometry args={[W - 0.9, H - 0.3, D - 0.9]} /><meshBasicMaterial color={tempColor(t, sp)} transparent opacity={0.08} depthWrite={false} /></mesh>}
      {/* virtual sensor nodes */}
      {cutaway && lot && st && [[-7, 2.4, -4, `T ${t?.toFixed(1)}°C`], [7, 2.4, -4, `RH ${st.readings.rh_pct.toFixed(0)}%`], [-7, 1.2, 3, `O₂ ${st.readings.o2_pct.toFixed(2)}%`], [7, 1.2, 3, `CO₂ ${st.readings.co2_pct.toFixed(3)}%`]].map(([x, y, z, txt]) => (
        <group key={txt as string} position={[x as number, y as number, z as number]}>
          <mesh><sphereGeometry args={[0.18, 12, 12]} /><meshStandardMaterial color="#FF684A" emissive="#FF684A" emissiveIntensity={3} /></mesh>
          <Label position={[0, 0.7, 0]}>{txt as string}</Label>
        </group>
      ))}
      <Label position={[0, H + 3.5, 0]} show={labels} dim={!lot}>
        <div className="font-sans text-[10px] uppercase tracking-widest text-gold">Advanced cold godown</div>
        {lot && st ? <>{t?.toFixed(1)} °C (set {sp.toFixed(1)}) · {st.readings.rh_pct.toFixed(0)}% RH · Q {st.produce.quality.toFixed(0)}<br />cooling {(qCool / 1000).toFixed(1)} kW · door {eq.door_open ? "OPEN" : "closed"}{eq.cooling_failed ? " · FAILURE" : ""}</> : "idle"}
      </Label>
    </group>
  );
}

/* ---------- grading & bagging hall ---------- */
function Bags({ grade, filled, total, origin }: { grade: string; filled: number; total: number; origin: [number, number, number] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const MAX = 54;
  const shown = total > 0 ? Math.round((filled / total) * Math.min(MAX, total)) : 0;
  useEffect(() => {
    const m = new THREE.Matrix4();
    for (let i = 0; i < MAX; i++) {
      const l = Math.floor(i / 9), k = i % 9;
      m.compose(new THREE.Vector3((k % 3) * 0.95, i < shown ? 0.32 + l * 0.55 : -50, Math.floor(k / 3) * 0.75), new THREE.Quaternion(), new THREE.Vector3(1, 0.62, 0.8));
      ref.current!.setMatrixAt(i, m);
    }
    ref.current!.instanceMatrix.needsUpdate = true;
  }, [shown]);
  return (
    <group position={origin}>
      <instancedMesh ref={ref} args={[undefined, undefined, MAX]} castShadow><sphereGeometry args={[0.5, 12, 10]} /><meshStandardMaterial map={sackTex()} color={GRADE_COLOR[grade]} /></instancedMesh>
      <mesh position={[0.95, 0.02, 0.75]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[3.4, 2.8]} /><meshStandardMaterial color={GRADE_COLOR[grade]} transparent opacity={0.35} /></mesh>
    </group>
  );
}

function GradingHall({ lot, labels, night }: { lot: any; labels: boolean; night: boolean }) {
  const g = lot?.grading;
  const running = lot?.stage === "grading";
  const items = useRef<THREE.Group>(null);
  const scan = useRef<THREE.Mesh>(null);
  const belt = beltTex();
  const seq = useMemo(() => (g?.items?.length ? g.items.map((x: any) => x.grade) : []), [g?.items]);
  const color = PRODUCE[lot?.commodity] || "#c0503a";
  const BIN_Z: Record<string, number> = { A1: -4.5, A2: -1.5, A3: 1.5, rejected: 4.5, uncertain: 4.5 };
  useFrame((st, dt) => {
    if (!running) return;
    belt.offset.x -= dt * 0.6;
    const t = st.clock.elapsedTime;
    if (scan.current) (scan.current.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.25 * Math.sin(t * 10);
    items.current?.children.forEach((m, i) => {
      const period = 14;
      const ph = ((t * 1.6 + i * 1.4) % period) - 7;   // -7 .. 7 along the belt
      const grade = seq.length ? seq[(i + Math.floor((t * 1.6 + i * 1.4) / period) * 10) % seq.length] : "A1";
      const mat = (m as THREE.Mesh).material as THREE.MeshStandardMaterial;
      mat.color.set(ph > -1 ? GRADE_COLOR[grade] : color);
      if (ph < 4.5) m.position.set(ph, 1.25, 0);
      else { const k = Math.min(1, (ph - 4.5) / 2.5); m.position.set(4.5 + k * 2.5, 1.25 - k * 0.9, BIN_Z[grade] * k); }
    });
  });
  return (
    <group position={SITES.grading.toArray()}>
      <mesh position={[0, 0.05, 0]} receiveShadow><boxGeometry args={[24, 0.1, 15]} /><meshStandardMaterial map={concreteTex()} /></mesh>
      {[-11.5, 11.5].flatMap((x) => [-7, 0, 7].map((z) => <mesh key={`${x}${z}`} position={[x, 3.5, z]} castShadow><boxGeometry args={[0.35, 7, 0.35]} /><meshStandardMaterial color="#3a3f47" /></mesh>))}
      <mesh position={[0, 7.2, 0]} castShadow><boxGeometry args={[24.5, 0.25, 15.5]} /><meshStandardMaterial map={metalRoofTex()} /></mesh>
      {g && <pointLight position={[-2, 6.2, 0]} intensity={night ? 600 : 120} distance={30} color="#fff1d6" />}
      {g && night && <pointLight position={[6, 6.2, 0]} intensity={450} distance={22} color="#fff1d6" />}
      <group position={[-3, 0, 0]}>
        <mesh position={[0, 1.0, 0]} castShadow><boxGeometry args={[15, 0.18, 1.3]} /><meshStandardMaterial map={belt} /></mesh>
        {Array.from({ length: 8 }, (_, i) => <mesh key={i} position={[-7 + i * 2, 0.5, 0]}><boxGeometry args={[0.15, 1, 1.4]} /><meshStandardMaterial color="#5b616b" /></mesh>)}
        <group position={[-1, 0, 0]}>
          {[-0.95, 0.95].map((z) => <mesh key={z} position={[0, 1.7, z]}><boxGeometry args={[0.15, 3.4, 0.15]} /><meshStandardMaterial color="#0A2624" /></mesh>)}
          <mesh position={[0, 3.35, 0]}><boxGeometry args={[0.6, 0.4, 2.1]} /><meshStandardMaterial color="#0A2624" /></mesh>
          <mesh position={[0, 3.05, 0]}><boxGeometry args={[0.4, 0.3, 0.4]} /><meshStandardMaterial color="#FF684A" emissive="#FF684A" emissiveIntensity={running ? 2 : 0.3} /></mesh>
          <mesh ref={scan} position={[0, 2.05, 0]}><coneGeometry args={[0.8, 1.9, 4, 1, true]} /><meshBasicMaterial color="#FF684A" transparent opacity={running ? 0.35 : 0} side={THREE.DoubleSide} depthWrite={false} /></mesh>
        </group>
        <group ref={items}>{Array.from({ length: 10 }, (_, i) => <mesh key={i} position={[-20, 1.25, 0]} castShadow><sphereGeometry args={[0.22, 14, 12]} /><meshStandardMaterial color={color} roughness={0.45} visible={running} /></mesh>)}</group>
      </group>
      {(["A1", "A2", "A3"] as const).map((k, i) => (
        <group key={k}>
          <Bags grade={k} filled={g?.bags_filled?.[k] ?? 0} total={g?.bags?.[k] ?? 0} origin={[5.3, 0.05, -6 + i * 3.3]} />
          <Label position={[7, 4.2, -5.2 + i * 3.3]} show={labels && !!g}>{k}: {g?.bags_filled?.[k] ?? 0}/{g?.bags?.[k] ?? 0} bags</Label>
        </group>
      ))}
      <mesh position={[6.2, 0.6, 5.2]} castShadow><boxGeometry args={[2.2, 1.2, 1.8]} /><meshStandardMaterial color="#7a2a22" /></mesh>
      <Label position={[0, 9.5, 0]} show={labels} dim={!g}>
        <div className="font-sans text-[10px] uppercase tracking-widest text-gold">Scan & bag hall</div>
        {g ? <>{running ? "Bagging" : "Done"} · {(g.processed_kg / 1000).toFixed(2)} / {(g.total_kg / 1000).toFixed(2)} t · rejected {(g.kg.rejected).toFixed(0)} kg</> : "waiting for a scan"}
      </Label>
    </group>
  );
}

/* ---------- farm, intake tractor, yard, roads ---------- */
function Farm() {
  const f = fieldTex();
  return (
    <group position={SITES.farm.toArray()}>
      {[[-12, -26], [-12, 24], [14, -30], [14, 30]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.03, z]} rotation={[-Math.PI / 2, 0, i * 0.2]} receiveShadow><planeGeometry args={[26, 30]} /><meshStandardMaterial map={f} /></mesh>
      ))}
      <group position={[8, 0, 2]}>
        <mesh position={[0, 2, 0]} castShadow><boxGeometry args={[8, 4, 6]} /><meshStandardMaterial color="#8b5a3c" /></mesh>
        <mesh position={[0, 4.6, 0]} rotation={[0, 0, 0]} castShadow><boxGeometry args={[9, 0.2, 7]} /><meshStandardMaterial map={metalRoofTex()} /></mesh>
      </group>
    </group>
  );
}

function IntakeTractor({ lot }: { lot: any }) {
  const group = useRef<THREE.Group>(null);
  const crates = useRef<THREE.Group>(null);
  const dist = useRef(0);
  const site = lot?.mode === "traditional" ? SITES.trad : SITES.adv;
  const doorZ = site.z + (lot?.mode === "traditional" ? 5 : 6);
  const active = lot?.stage === "intake";
  const target = useMemo(() => new THREE.Vector3(site.x, 0, doorZ + 9), [site.x, doorZ]);
  const home = SITES.farm.clone().add(new THREE.Vector3(8, 0, 12));
  const pos = useRef(home.clone());
  useFrame((st, dt) => {
    if (!group.current) return;
    const goal = active ? target : home;
    const d = goal.clone().sub(pos.current);
    const len = d.length();
    if (len > 0.2) {
      const stepLen = Math.min(len, dt * 14);
      pos.current.addScaledVector(d.normalize(), stepLen);
      group.current.rotation.y = Math.atan2(d.x, d.z);
      dist.current += stepLen;
    } else if (active) group.current.rotation.y = Math.PI;   // backed up to the door
    group.current.position.copy(pos.current);
    group.current.visible = active || pos.current.distanceTo(home) > 1;
    if (crates.current) {
      const parked = active && pos.current.distanceTo(target) < 0.5;
      crates.current.visible = parked && !(lot?.storage?.loading?.done);
      crates.current.children.forEach((c, i) => {
        const k = ((st.clock.elapsedTime * 0.5 + i / crates.current!.children.length) % 1);
        c.position.set(site.x + Math.sin(i) * 0.4, 1.2 + Math.sin(k * Math.PI) * 0.6, target.z - 2 - k * 9);
      });
    }
  });
  const loaded = lot?.storage?.loading;
  return (
    <>
      <group ref={group}><TractorTrolley crates={active ? Math.round(12 * (1 - (loaded?.progress ?? 0))) : 0} distRef={dist} /></group>
      <group ref={crates}>{Array.from({ length: 6 }, (_, i) => <mesh key={i} castShadow><boxGeometry args={[0.85, 0.45, 1]} /><meshStandardMaterial map={crateTex()} /></mesh>)}</group>
    </>
  );
}

function LightPole({ position, night }: { position: [number, number, number]; night: boolean }) {
  return (
    <group position={position}>
      <mesh position={[0, 4, 0]} castShadow><cylinderGeometry args={[0.12, 0.18, 8, 8]} /><meshStandardMaterial color="#3a3f47" /></mesh>
      <mesh position={[0.6, 7.9, 0]}><boxGeometry args={[1.4, 0.25, 0.5]} /><meshStandardMaterial color="#20232a" /></mesh>
      <mesh position={[0.9, 7.75, 0]}><boxGeometry args={[0.8, 0.06, 0.35]} /><meshStandardMaterial color="#fff4d6" emissive="#ffe7a8" emissiveIntensity={night ? 8 : 0} /></mesh>
    </group>
  );
}

export function Hub({ lots, activeId, cutaway, labels, night }: { lots: any[]; activeId: number | null; cutaway: "trad" | "adv" | null; labels: boolean; night: boolean }) {
  lots = [...lots].sort((a, b) => (a.id === activeId ? -1 : b.id === activeId ? 1 : 0));
  const trad = lots.find((l) => l.mode === "traditional" && ["intake", "storage"].includes(l.stage));
  const adv = lots.find((l) => l.mode === "advanced" && ["intake", "storage", "grading", "graded"].includes(l.stage));
  const grading = lots.find((l) => l.mode === "advanced" && l.grading && ["grading", "graded", "dispatched", "arrived", "delivered"].includes(l.stage));
  const intake = lots.find((l) => l.stage === "intake");
  const asphalt = useMemo(() => { const t = asphaltTex().clone(); t.repeat.set(1, 60); t.needsUpdate = true; return t; }, []);
  return (
    <group>
      <mesh position={[0, 0.02, 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[100, 40]} /><meshStandardMaterial map={concreteTex()} /></mesh>
      <mesh position={[0, 0.03, 46]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[8, 52]} /><meshStandardMaterial map={asphalt} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} receiveShadow><ringGeometry args={[HUB_RADIUS - 4, HUB_RADIUS + 4, 128]} /><meshStandardMaterial color="#2f3134" roughness={0.95} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}><ringGeometry args={[HUB_RADIUS - 0.15, HUB_RADIUS + 0.15, 128]} /><meshStandardMaterial color="#F2C230" /></mesh>
      <Farm />
      <TraditionalGodown lot={trad} cutaway={cutaway === "trad"} labels={labels} night={night} />
      <AdvancedGodown lot={adv} cutaway={cutaway === "adv"} labels={labels} night={night} />
      <GradingHall lot={grading} labels={labels} night={night} />
      <IntakeTractor lot={intake} />
      {[[-40, 0, 16], [-14, 0, 16], [14, 0, 16], [40, 0, 16], [4, 0, 40]].map((p, i) => <LightPole key={i} position={p as [number, number, number]} night={night} />)}
      {night && <pointLight position={[0, 9, 10]} intensity={300} distance={70} color="#ffe2a0" />}
      <Label position={[0, 3, 26]} show={labels} dim>Loading yard → ring road → highway</Label>
    </group>
  );
}

export { qualityColor };
