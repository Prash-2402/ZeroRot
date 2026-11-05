import { Suspense, useMemo, useRef, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls, useTexture } from "@react-three/drei";
import * as THREE from "three";

export function Scene({ children, camera = [9, 6, 10], target = [0, 1, 0], height = 460, dark = true }: {
  children: ReactNode; camera?: [number, number, number]; target?: [number, number, number]; height?: number | string; dark?: boolean;
}) {
  return (
    <div style={{ height }} className={dark ? "bg-ink" : "bg-paper-200"}>
      <Canvas shadows dpr={[1, 2]} camera={{ position: camera, fov: 42 }}>
        <color attach="background" args={[dark ? "#0B0C0F" : "#E9E6DF"]} />
        <hemisphereLight args={["#ffffff", "#30343b", 0.7]} />
        <directionalLight position={[8, 14, 6]} intensity={1.5} castShadow shadow-mapSize={[1024, 1024]} />
        <Suspense fallback={null}>{children}</Suspense>
        <gridHelper args={[60, 60, "#262A31", "#1A1D22"]} position={[0, 0.001, 0]} />
        <OrbitControls target={target} enablePan enableZoom enableRotate maxPolarAngle={1.5} minDistance={3} maxDistance={40} />
      </Canvas>
    </div>
  );
}

export function SensorTag({ position, label, value, unit, color = "#FFC900" }: { position: [number, number, number]; label: string; value: string | number; unit?: string; color?: string }) {
  return (
    <group position={position}>
      <mesh><sphereGeometry args={[0.09, 16, 16]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} /></mesh>
      <Html distanceFactor={9} position={[0, 0.25, 0]} center zIndexRange={[10, 0]}>
        <div className="whitespace-nowrap border border-ink-500 bg-ink/90 px-1.5 py-0.5 font-mono text-[10px] text-paper">
          <span className="text-ink-300">{label} </span><b style={{ color }}>{value}</b>{unit ? ` ${unit}` : ""}
        </div>
      </Html>
    </group>
  );
}

const STAGES = ["fresh", "aging", "spoiling"] as const;
const stageOf = (q: number) => (q >= 75 ? "fresh" : q >= 55 ? "aging" : "spoiling");
const PHOTO_OK = new Set(["tomato", "mango", "banana"]);

function PhotoFace({ commodity, quality, w = 0.5, h = 0.26 }: { commodity: string; quality: number; w?: number; h?: number }) {
  const tex = useTexture(Object.fromEntries(STAGES.map((s) => [s, `/produce/${commodity}_${s}.jpg`]))) as Record<string, THREE.Texture>;
  Object.values(tex).forEach((t) => { t.colorSpace = THREE.SRGBColorSpace; });
  return <mesh position={[0, 0.2, 0.201]}><planeGeometry args={[w, h]} /><meshStandardMaterial map={tex[stageOf(quality)]} /></mesh>;
}

/** Wooden crate; its front shows a real photo of the freshness stage (tomato/mango/banana) or a tint (others). */
export function Crate({ position, commodity, quality, tint }: { position: [number, number, number]; commodity: string; quality: number; tint?: string }) {
  return (
    <group position={position}>
      <mesh castShadow receiveShadow position={[0, 0.2, 0]}>
        <boxGeometry args={[0.6, 0.4, 0.4]} />
        <meshStandardMaterial color={tint || "#A07A4C"} roughness={0.85} />
      </mesh>
      {PHOTO_OK.has(commodity) && <PhotoFace commodity={commodity} quality={quality} />}
    </group>
  );
}

/** Air-circulation particles flowing along +x inside a box; speed and colour come from the simulation. */
export function Airflow({ size, speed, color, count = 160, origin = [0, 0, 0], reverse = false }: {
  size: [number, number, number]; speed: number; color: string; count?: number; origin?: [number, number, number]; reverse?: boolean;
}) {
  const ref = useRef<THREE.Points>(null);
  const pos = useMemo(() => {
    const a = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      a[i * 3] = (Math.random() - 0.5) * size[0];
      a[i * 3 + 1] = Math.random() * size[1];
      a[i * 3 + 2] = (Math.random() - 0.5) * size[2];
    }
    return a;
  }, [count, size[0], size[1], size[2]]);
  useFrame((_, dt) => {
    const g = ref.current?.geometry;
    if (!g) return;
    const arr = g.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      arr[i * 3] += (reverse ? -1 : 1) * speed * dt;
      if (arr[i * 3] > size[0] / 2) arr[i * 3] = -size[0] / 2;
      if (arr[i * 3] < -size[0] / 2) arr[i * 3] = size[0] / 2;
    }
    g.attributes.position.needsUpdate = true;
  });
  return (
    <points ref={ref} position={origin}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[pos, 3]} /></bufferGeometry>
      <pointsMaterial size={0.06} color={color} transparent opacity={0.7} depthWrite={false} />
    </points>
  );
}

export function Hud({ children }: { children: ReactNode }) {
  return <div className="pointer-events-none absolute left-3 top-3 space-y-1 font-mono text-[11px] text-paper">{children}</div>;
}
