import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { CameraControls, Html, Sky, useTexture } from "@react-three/drei";
import * as THREE from "three";
import { useLive } from "../stores/live";
import { useUI, type Place } from "../stores/ui";
import { useT } from "../lib/i18n";
import { qualityColor } from "../lib/format";

// ---------- layout (metres) ----------
const SHED = new THREE.Vector3(-9, 0, -3);
const COLD = new THREE.Vector3(7.5, 0, -5);
const ROAD_Z = 10;
const PARK_X = 3;
const PALLET = new THREE.Vector3(-1.4, 0, ROAD_Z + 2.6);
const LOAD_SECONDS = 3.2;
const DRIVE_SECONDS = 3.5;
const STAGES = ["fresh", "aging", "spoiling"] as const;

export type FarmData = any;

function stageOf(q: number) { return q >= 75 ? "fresh" : q >= 55 ? "aging" : "spoiling"; }

function useLabelTexture(text: string, sub: string, bg = "#ffffff", fg = "#1F4D3A") {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024; c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = bg; g.fillRect(0, 0, 1024, 256);
    g.fillStyle = "#3E8E5A"; g.fillRect(0, 196, 1024, 26);
    g.fillStyle = fg; g.font = "bold 92px Inter, Arial, sans-serif"; g.fillText(text, 48, 120);
    g.font = "52px Inter, Arial, sans-serif"; g.fillStyle = "#5A5A55"; g.fillText(sub, 50, 178);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [text, sub, bg, fg]);
}

// ---------- produce crate with a real photo on the front ----------
function Crate({ produce, quality, position, rotation = 0, scale = 1 }: { produce: string; quality: number; position: [number, number, number]; rotation?: number; scale?: number }) {
  const tex = useTexture(Object.fromEntries(STAGES.map((s) => [s, `/produce/${produce}_${s}.jpg`]))) as Record<string, THREE.Texture>;
  useEffect(() => { Object.values(tex).forEach((t) => { t.colorSpace = THREE.SRGBColorSpace; }); }, [tex]);
  const stage = stageOf(quality);
  // slight darkening with age, on top of the stage photo
  const tint = useMemo(() => new THREE.Color().setScalar(0.72 + 0.28 * Math.min(1, Math.max(0, quality / 100))), [quality]);
  return (
    <group position={position} rotation={[0, rotation, 0]} scale={scale}>
      <mesh castShadow receiveShadow position={[0, 0.36, 0]}>
        <boxGeometry args={[1.05, 0.72, 0.8]} />
        <meshStandardMaterial color="#B98A52" roughness={0.9} />
      </mesh>
      {[0.12, 0.6].map((y) => (
        <mesh key={y} position={[0, y, 0.405]}><boxGeometry args={[1.07, 0.06, 0.02]} /><meshStandardMaterial color="#8E6436" /></mesh>
      ))}
      <mesh position={[0, 0.37, 0.412]}>
        <planeGeometry args={[0.86, 0.42]} />
        <meshStandardMaterial map={tex[stage]} color={tint} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.73, 0]}>
        <boxGeometry args={[0.98, 0.04, 0.72]} />
        <meshStandardMaterial map={tex[stage]} color={tint} roughness={0.9} />
      </mesh>
    </group>
  );
}

function CrateStack({ produce, quality, at, count = 6 }: { produce: string; quality: number; at: THREE.Vector3; count?: number }) {
  const spots: [number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const layer = Math.floor(i / 4), k = i % 4;
    spots.push([at.x + (k % 2) * 1.12 - 0.56, at.y + layer * 0.75, at.z + Math.floor(k / 2) * 0.86 - 0.43]);
  }
  return <>{spots.map((p, i) => <Crate key={i} produce={produce} quality={quality} position={p} />)}</>;
}

// ---------- environment ----------
function Ground() {
  const rows = useMemo(() => Array.from({ length: 14 }, (_, i) => i), []);
  const trees: [number, number, number][] = [[-22, 0, 4], [-18, 0, 14], [-25, 0, -8], [20, 0, -12], [24, 0, 2], [-14, 0, 26], [38, 0, 32], [18, 0, 34], [-30, 0, 16]];
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[220, 220]} /><meshStandardMaterial color="#9DBB6C" roughness={1} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 1]} receiveShadow><circleGeometry args={[15, 48]} /><meshStandardMaterial color="#CDB98E" roughness={1} /></mesh>
      {rows.map((i) => (
        <group key={i}>
          <mesh position={[0, 0.02, -16 - i * 1.6]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[56, 0.8]} /><meshStandardMaterial color="#7A5A3A" roughness={1} /></mesh>
          <mesh position={[0, 0.25, -16.8 - i * 1.6]} castShadow><boxGeometry args={[54, 0.5, 0.55]} /><meshStandardMaterial color={i % 3 === 0 ? "#4F8A3C" : "#5E9A45"} roughness={0.9} /></mesh>
        </group>
      ))}
      {trees.map((p, i) => (
        <group key={i} position={p}>
          <mesh position={[0, 1, 0]} castShadow><cylinderGeometry args={[0.18, 0.25, 2, 8]} /><meshStandardMaterial color="#6B4A2E" /></mesh>
          <mesh position={[0, 3, 0]} castShadow><icosahedronGeometry args={[1.6 + (i % 3) * 0.3, 0]} /><meshStandardMaterial color={i % 2 ? "#3F7D3A" : "#4C8C3F"} flatShading /></mesh>
        </group>
      ))}
      {/* road to the mandi */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[30, 0.02, ROAD_Z]} receiveShadow><planeGeometry args={[110, 4.2]} /><meshStandardMaterial color="#5E5A55" roughness={1} /></mesh>
      {Array.from({ length: 26 }, (_, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[-20 + i * 4, 0.03, ROAD_Z]}><planeGeometry args={[1.8, 0.14]} /><meshStandardMaterial color="#F2EDE0" /></mesh>
      ))}
    </group>
  );
}

function RoadSign({ x, text }: { x: number; text: string }) {
  const tex = useLabelTexture(text, "→", "#1F6B45", "#FFFFFF");
  return (
    <group position={[x, 0, ROAD_Z - 3]}>
      <mesh position={[0, 1.2, 0]} castShadow><cylinderGeometry args={[0.06, 0.06, 2.4]} /><meshStandardMaterial color="#888" /></mesh>
      <mesh position={[0, 2.4, 0.05]}><planeGeometry args={[2.6, 0.65]} /><meshStandardMaterial map={tex} /></mesh>
    </group>
  );
}

// ---------- buildings ----------
function Shed({ batch, quality, onPick, hovered, setHovered }: any) {
  return (
    <group position={SHED} onClick={(e) => { e.stopPropagation(); onPick(); }}
      onPointerOver={(e) => { e.stopPropagation(); setHovered("shed"); }} onPointerOut={() => setHovered(null)}>
      <mesh position={[0, 0.1, 0]} receiveShadow castShadow><boxGeometry args={[8, 0.2, 6]} /><meshStandardMaterial color="#B9B2A4" /></mesh>
      {[[-3.8, -2.8], [3.8, -2.8], [-3.8, 2.8], [3.8, 2.8]].map(([x, z], i) => (
        <mesh key={i} position={[x, 1.75, z]} castShadow><boxGeometry args={[0.22, 3.3, 0.22]} /><meshStandardMaterial color="#6E5236" /></mesh>
      ))}
      <mesh position={[0, 1.6, -2.95]} castShadow receiveShadow><boxGeometry args={[8, 3.1, 0.12]} /><meshStandardMaterial color="#C9A46E" /></mesh>
      <mesh position={[-3.95, 1.6, -0.6]} castShadow><boxGeometry args={[0.12, 3.1, 4.8]} /><meshStandardMaterial color="#C09A64" /></mesh>
      <group position={[0, 3.55, 0]} rotation={[0.13, 0, 0]}>
        <mesh castShadow receiveShadow><boxGeometry args={[9, 0.12, 7.2]} /><meshStandardMaterial color={hovered ? "#B8613F" : "#A5543C"} metalness={0.3} roughness={0.6} /></mesh>
        {Array.from({ length: 12 }, (_, i) => (
          <mesh key={i} position={[-4.2 + i * 0.76, 0.09, 0]}><boxGeometry args={[0.08, 0.06, 7.2]} /><meshStandardMaterial color="#8C4430" /></mesh>
        ))}
      </group>
      {batch && <CrateStack produce={batch.produce} quality={quality} at={new THREE.Vector3(-0.2, 0.2, -1)} count={6} />}
      <mesh position={[2.6, 0.55, 1.2]} castShadow><boxGeometry args={[1.2, 0.9, 0.9]} /><meshStandardMaterial color="#8C8C80" /></mesh>
    </group>
  );
}

function ColdStore({ batch, quality, onPick, hovered, setHovered }: any) {
  const tex = useLabelTexture("COLD STORAGE", "Malur · 12–14 °C", "#F4F8FB");
  const fan = useRef<THREE.Mesh>(null);
  useFrame((_, d) => { if (fan.current) fan.current.rotation.z += d * 6; });
  return (
    <group position={COLD} onClick={(e) => { e.stopPropagation(); onPick(); }}
      onPointerOver={(e) => { e.stopPropagation(); setHovered("cold"); }} onPointerOut={() => setHovered(null)}>
      <mesh position={[0, 1.5, 0]} castShadow receiveShadow><boxGeometry args={[7, 2.8, 3]} /><meshStandardMaterial color={hovered ? "#EAF3FA" : "#DCE8F1"} metalness={0.2} roughness={0.5} /></mesh>
      {Array.from({ length: 16 }, (_, i) => (
        <mesh key={i} position={[-3.3 + i * 0.44, 1.5, 1.52]}><boxGeometry args={[0.07, 2.6, 0.05]} /><meshStandardMaterial color="#C5D5E0" /></mesh>
      ))}
      <mesh position={[0, 1.95, 1.56]}><planeGeometry args={[4.2, 1.05]} /><meshStandardMaterial map={tex} /></mesh>
      <mesh position={[3.52, 1.5, 0]}><boxGeometry args={[0.05, 2.7, 2.9]} /><meshStandardMaterial color="#BFD3E2" /></mesh>
      <mesh position={[-1.8, 3.15, 0]} castShadow><boxGeometry args={[1.6, 0.5, 1.6]} /><meshStandardMaterial color="#6C8AA0" /></mesh>
      <mesh ref={fan} position={[-1.8, 3.42, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.6, 6]} /><meshStandardMaterial color="#2E3E4A" /></mesh>
      <pointLight position={[4.4, 1.6, 0]} color="#8FD3FF" intensity={6} distance={6} />
      {/* pallet of crates outside the open door */}
      <mesh position={[5, 0.07, 0]} receiveShadow><boxGeometry args={[2.4, 0.14, 2]} /><meshStandardMaterial color="#9C7A4E" /></mesh>
      {batch && <CrateStack produce={batch.produce} quality={quality} at={new THREE.Vector3(5, 0.14, 0)} count={4} />}
    </group>
  );
}

// ---------- mandi company reefer truck ----------
function TruckModel({ failed, ghost = false, logo }: { failed?: boolean; ghost?: boolean; logo: THREE.Texture }) {
  const light = useRef<THREE.MeshStandardMaterial>(null);
  const smoke = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (light.current) light.current.emissiveIntensity = failed ? (Math.sin(clock.elapsedTime * 8) > 0 ? 3 : 0.2) : 1.2;
    if (smoke.current) smoke.current.children.forEach((m, i) => {
      const t = (clock.elapsedTime * 0.6 + i / 5) % 1;
      m.position.set(-1.5 + Math.sin(i) * 0.2, 2.9 + t * 2.2, Math.cos(i * 2) * 0.3);
      m.scale.setScalar(0.25 + t * 0.6);
      ((m as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = (1 - t) * 0.55;
    });
  });
  const op = ghost ? 0.28 : 1;
  const mat = (color: string, extra: any = {}) => <meshStandardMaterial color={color} transparent={ghost} opacity={op} {...extra} />;
  return (
    <group>
      <mesh position={[0, 1.75, 0]} castShadow={!ghost}><boxGeometry args={[5, 2.5, 2.4]} />{mat("#F7F7F2")}</mesh>
      {!ghost && <mesh position={[0, 1.75, 1.21]}><planeGeometry args={[4.6, 1.15]} /><meshStandardMaterial map={logo} /></mesh>}
      {!ghost && <mesh position={[0, 1.75, -1.21]} rotation={[0, Math.PI, 0]}><planeGeometry args={[4.6, 1.15]} /><meshStandardMaterial map={logo} /></mesh>}
      <mesh position={[3.4, 1.35, 0]} castShadow={!ghost}><boxGeometry args={[1.8, 1.9, 2.3]} />{mat("#E07B39")}</mesh>
      <mesh position={[4.31, 1.7, 0]}><boxGeometry args={[0.02, 0.8, 2.0]} />{mat("#22313A", { metalness: 0.6, roughness: 0.2 })}</mesh>
      <mesh position={[2.35, 2.85, 0]}><boxGeometry args={[0.5, 0.55, 1.4]} />{mat("#9AA7B0")}</mesh>
      <mesh position={[2.62, 2.85, 0.5]}><sphereGeometry args={[0.1, 12, 12]} /><meshStandardMaterial ref={light} color={failed ? "#C2463B" : "#3E8E5A"} emissive={failed ? "#FF3B2F" : "#3EE07A"} transparent={ghost} opacity={op} /></mesh>
      <mesh position={[0.2, 0.35, 0]}><boxGeometry args={[7, 0.2, 2]} />{mat("#333")}</mesh>
      {[-1.8, -0.6, 3.4].map((x) => [-1.1, 1.1].map((z) => (
        <mesh key={`${x}${z}`} position={[x, 0.42, z]} rotation={[Math.PI / 2, 0, 0]} castShadow={!ghost}><cylinderGeometry args={[0.42, 0.42, 0.3, 16]} />{mat("#1E1E1E")}</mesh>
      )))}
      {failed && !ghost && (
        <group ref={smoke}>
          {Array.from({ length: 5 }, (_, i) => (
            <mesh key={i}><sphereGeometry args={[0.5, 10, 10]} /><meshStandardMaterial color="#9A9A9A" transparent opacity={0.4} depthWrite={false} /></mesh>
          ))}
        </group>
      )}
    </group>
  );
}

function roadX(progress: number) { return 10 + Math.min(1, Math.max(0, progress)) * 46; }

function Truck({ data, bananaQuality, onPick, setHovered }: any) {
  const logo = useLabelTexture("MANDI CO. · REEFER", "Mandi company truck (demo)");
  const group = useRef<THREE.Group>(null);
  const ghostRef = useRef<THREE.Group>(null);
  const loadingAt = useUI((s) => s.loadingAt);
  const endLoading = useUI((s) => s.endLoading);
  const live = useLive((s) => s.trucks[data?.trip_id || "TRIP-S2"]);
  const truckBatch = data?.batch;
  const state = data?.state;
  const failed = data?.reefer_status === "failed" || live?.reefer_status === "failed";
  const rerouted = data?.rerouted || live?.rerouted;
  const progress = live?.frac ?? data?.progress ?? 0;
  const ghostFrac = live?.ghost?.frac ?? null;
  const crates = useRef<THREE.Group>(null);
  const [loadedVisible, setLoadedVisible] = useState(true);
  useEffect(() => { setLoadedVisible(state === "parked"); }, [state]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    let x = PARK_X, z = ROAD_Z;
    const now = performance.now();
    if (loadingAt) {
      const t = (now - loadingAt) / 1000;
      // crates arc from the pallet into the back of the truck, one after another
      crates.current?.children.forEach((c, i) => {
        const s = Math.min(1, Math.max(0, (t - i * 0.45) / 0.6));
        const from = new THREE.Vector3(PALLET.x + (i % 2) * 1.1 - 0.55, 0.1 + Math.floor(i / 4) * 0.75, PALLET.z + (Math.floor((i % 4) / 2) - 0.5) * 0.86);
        const to = new THREE.Vector3(PARK_X - 2.4, 1.2, ROAD_Z);
        c.position.lerpVectors(from, to, s);
        c.position.y += Math.sin(s * Math.PI) * 1.4;
        c.visible = s < 1;
      });
      if (t > LOAD_SECONDS) {
        const d = Math.min(1, (t - LOAD_SECONDS) / DRIVE_SECONDS);
        x = PARK_X + (roadX(0.02) - PARK_X) * (d * d);
      }
      if (t > LOAD_SECONDS + DRIVE_SECONDS + 0.4 && state !== "parked") endLoading();
    } else if (state === "on_road" || state === "arrived") {
      x = roadX(state === "arrived" ? 1 : progress);
      z = rerouted ? ROAD_Z + 1.1 : ROAD_Z - 0.9;
    }
    g.position.x += (x - g.position.x) * (loadingAt ? 1 : 0.08);
    g.position.z += (z - g.position.z) * 0.08;
    if (ghostRef.current) {
      ghostRef.current.visible = Boolean(rerouted) && ghostFrac !== null;
      ghostRef.current.position.set(roadX(ghostFrac ?? 0), 0, ROAD_Z - 0.9);
    }
  });

  const showPallet = state === "parked" || !!loadingAt;
  return (
    <group>
      <group ref={group} position={[PARK_X, 0, ROAD_Z]} onClick={(e) => { e.stopPropagation(); onPick(); }}
        onPointerOver={(e) => { e.stopPropagation(); setHovered("truck"); }} onPointerOut={() => setHovered(null)}>
        <TruckModel failed={failed} logo={logo} />
      </group>
      <group ref={ghostRef} visible={false}><TruckModel ghost logo={logo} /></group>
      {showPallet && truckBatch && (
        <group onClick={(e) => { e.stopPropagation(); onPick(); }}>
          <mesh position={[PALLET.x, 0.06, PALLET.z]} receiveShadow><boxGeometry args={[2.4, 0.12, 2]} /><meshStandardMaterial color="#9C7A4E" /></mesh>
          <group ref={crates}>
            {Array.from({ length: 6 }, (_, i) => (
              <group key={i} position={[PALLET.x + (i % 2) * 1.1 - 0.55, 0.12 + Math.floor(i / 4) * 0.75, PALLET.z + (Math.floor((i % 4) / 2) - 0.5) * 0.86]}
                visible={loadedVisible || !!loadingAt}>
                <Crate produce={truckBatch.produce} quality={bananaQuality} position={[0, 0, 0]} />
              </group>
            ))}
          </group>
        </group>
      )}
    </group>
  );
}

// ---------- floating labels ----------
function PlaceLabel({ position, title, card, active, onClick, extra, tone }: any) {
  const { t } = useT();
  const q = card?.quality;
  const color = tone || (q !== undefined ? qualityColor(q) : "#6F8A6E");
  return (
    <Html position={position} center distanceFactor={11} zIndexRange={[20, 0]}>
      <button onClick={onClick}
        className={`flex items-center gap-2 whitespace-nowrap rounded-full border bg-white/95 py-1.5 pl-1.5 pr-3.5 text-left shadow-lg transition-transform hover:scale-105 ${active ? "border-forest ring-2 ring-forest/30" : "border-white"}`}>
        {card ? <img src={`/produce/${card.produce}_${card.photo_stage}.jpg`} alt="" className="h-9 w-9 rounded-full object-cover" /> : <span className="h-9 w-9 rounded-full bg-cream-200" />}
        <span>
          <span className="flex items-center gap-1.5 text-[13px] font-bold text-forest"><span className="h-2 w-2 rounded-full" style={{ background: color }} />{title}</span>
          {card && <span className="block text-[11px] text-charcoal-500">{Math.round(q)}% · {card.days_left === null ? "30+" : card.days_left < 1 ? "<1" : card.days_left.toFixed(1)} {t("days")}</span>}
          {extra && <span className="block text-[11px] font-semibold" style={{ color: tone || "#5A5A55" }}>{extra}</span>}
        </span>
      </button>
    </Html>
  );
}

// ---------- camera ----------
const VIEWS: Record<string, [number, number, number, number, number, number]> = {
  yard: [17, 15, 27, 0, 0, 2],
  shed: [-6, 4.6, 8, -5.5, 1.1, -3.5],
  cold: [17, 4.6, 5, 13, 1.1, -4.6],
  truck_parked: [6.5, 5.5, 20, 4.5, 1.2, ROAD_Z],
};

function CameraRig({ focus, truckX }: { focus: Place; truckX: number | null }) {
  const ref = useRef<CameraControls>(null);
  const truckXRounded = truckX === null ? null : Math.round(truckX);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let v = VIEWS[focus] || VIEWS.yard;
    // keep the truck in the left half of the screen, clear of the side panel
    if (focus === "truck") v = truckXRounded !== null ? [truckXRounded + 7, 6.5, ROAD_Z + 12, truckXRounded + 4.5, 1.2, ROAD_Z] : VIEWS.truck_parked;
    c.setLookAt(v[0], v[1], v[2], v[3], v[4], v[5], true);
  }, [focus, truckXRounded]);
  return <CameraControls ref={ref} minDistance={4} maxDistance={70} maxPolarAngle={1.42} smoothTime={0.6} />;
}

export function FarmScene({ data, onPick, selectedFuture }: { data: FarmData; onPick: (p: Place, batchId?: string) => void; selectedFuture: Record<string, number> }) {
  const { t, market } = useT();
  const focus = useUI((s) => s.focus);
  const loadingAt = useUI((s) => s.loadingAt);
  const live = useLive((s) => s.trucks["TRIP-S2"]);
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => { document.body.style.cursor = hovered ? "pointer" : "auto"; return () => { document.body.style.cursor = "auto"; }; }, [hovered]);
  const shed = data?.places?.shed?.[0];
  const cold = data?.places?.cold?.[0];
  const truckCard = data?.places?.truck?.[0];
  const truck = data?.truck || {};
  const q = (c: any) => (c ? (selectedFuture[c.id] ?? c.quality) : 100);
  const onRoad = truck.state === "on_road" || truck.state === "arrived";
  const truckX = onRoad && !loadingAt ? roadX(truck.state === "arrived" ? 1 : live?.frac ?? truck.progress ?? 0) : null;
  const failed = truck.reefer_status === "failed" || live?.reefer_status === "failed";
  const truckExtra = loadingAt ? t("loadingNow")
    : truck.state === "parked" ? t("truckWaiting").split(".")[0]
    : truck.state === "on_road" ? `${Math.round((live?.frac ?? truck.progress) * 100)}% · ${live?.cargo_temp ?? truck.cargo_temp?.toFixed?.(1) ?? "-"} °C`
    : truck.state === "arrived" ? t("arrived", { m: market(truck.trip?.dest_id, truck.dest_name) }) : "";
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [17, 15, 27], fov: 42 }} onPointerMissed={() => setHovered(null)}>
      <Sky sunPosition={[80, 40, 30]} turbidity={5} rayleigh={1.2} />
      <hemisphereLight args={["#E8F4FF", "#7C9A55", 0.85]} />
      <directionalLight position={[20, 28, 14]} intensity={1.7} castShadow shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-35} shadow-camera-right={45} shadow-camera-top={30} shadow-camera-bottom={-30} />
      <fog attach="fog" args={["#DDEBD6", 70, 150]} />
      <Suspense fallback={null}>
        <Ground />
        <RoadSign x={24} text={`${market("m_hubballi", "Hubballi APMC")} 479 km`} />
        <Shed batch={shed} quality={q(shed)} hovered={hovered === "shed"} setHovered={setHovered} onPick={() => onPick("shed", shed?.id)} />
        <ColdStore batch={cold} quality={q(cold)} hovered={hovered === "cold"} setHovered={setHovered} onPick={() => onPick("cold", cold?.id)} />
        <Truck data={{ ...truck, batch: truckCard }} bananaQuality={q(truckCard)} setHovered={setHovered} onPick={() => onPick("truck", truckCard?.id)} />
      </Suspense>
      {focus === "yard" && <>
      <PlaceLabel position={[SHED.x, 5.2, SHED.z]} title={t("shed")} card={shed} onClick={() => onPick("shed", shed?.id)} />
      <PlaceLabel position={[COLD.x, 4.6, COLD.z]} title={t("cold")} card={cold} onClick={() => onPick("cold", cold?.id)} />
      <PlaceLabel position={[truckX ?? PARK_X, 4.4, ROAD_Z]} title={t("truck")} card={truckCard} onClick={() => onPick("truck", truckCard?.id)}
        extra={failed ? `⚠ ${t("coolingFailed")}` : truckExtra} tone={failed ? "#C2463B" : undefined} />
      </>}
      <CameraRig focus={focus} truckX={truckX} />
    </Canvas>
  );
}
