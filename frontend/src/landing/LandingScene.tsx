import { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Float, Lightformer, Sparkles } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import { FarmScene, LossScene, MarketScene, PipelineScene, TwinScene } from "./dioramas";

/** `progress` (0..4) is animated by the page; `speed` drives the speed lines. */
export type Flight = { progress: number; speed: number };

const N = 5, R = 30, STEP = (Math.PI * 2) / N;
// sky gradient (top, bottom) and key-light colour per slide
const TOP = ["#0f4a45", "#2a0d10", "#062a30", "#14313a", "#3a2410"].map((c) => new THREE.Color(c));
const BOT = ["#f2b48a", "#8a3424", "#0f5a57", "#3f6f78", "#ffcf86"].map((c) => new THREE.Color(c));
const KEY = ["#ffe0b8", "#ffb09a", "#bff6ee", "#ffe6c8", "#ffd08a"].map((c) => new THREE.Color(c));
const SCENES = [FarmScene, LossScene, TwinScene, PipelineScene, MarketScene];

function mix(arr: THREE.Color[], p: number, out: THREE.Color) {
  const i = Math.min(arr.length - 2, Math.max(0, Math.floor(p)));
  return out.copy(arr[i]).lerp(arr[i + 1], Math.min(1, Math.max(0, p - i)));
}

function Sky({ flight }: { flight: React.MutableRefObject<Flight> }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = smoothstep(-0.25, 0.7, vP.y); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }",
  }), []);
  useFrame(({ scene }) => {
    mix(TOP, flight.current.progress, mat.uniforms.top.value);
    mix(BOT, flight.current.progress, mat.uniforms.bottom.value);
    if (scene.fog) (scene.fog as THREE.Fog).color.copy(mat.uniforms.bottom.value).lerp(mat.uniforms.top.value, 0.45);
  });
  return <mesh material={mat} scale={150}><sphereGeometry args={[1, 32, 16]} /></mesh>;
}

/** The turntable: five islands on a ring; the active one swings to the front. */
function Carousel({ flight }: { flight: React.MutableRefObject<Flight> }) {
  const g = useRef<THREE.Group>(null);
  const islands = useRef<THREE.Group[]>([]);
  useFrame((st) => {
    const p = flight.current.progress;
    if (g.current) g.current.rotation.y = -p * STEP;
    islands.current.forEach((isl, i) => {
      if (!isl) return;
      const d = Math.abs(i - p);
      isl.scale.setScalar(THREE.MathUtils.lerp(1, 0.62, Math.min(1, d)));
      isl.rotation.y = i * STEP + Math.sin(st.clock.elapsedTime * 0.18 + i) * 0.35;   // face the viewer, swaying gently
    });
  });
  return (
    <group ref={g} position={[0, -1.2, -R]}>
      {SCENES.map((S, i) => (
        <group key={i} position={[Math.sin(i * STEP) * R, 0, Math.cos(i * STEP) * R]}>
          <Float speed={1.1} rotationIntensity={0.08} floatIntensity={0.5}>
            <group ref={(el) => { if (el) islands.current[i] = el; }}><S /></group>
          </Float>
        </group>
      ))}
    </group>
  );
}

/** Horizontal speed lines while the carousel turns. */
function SpeedLines({ flight }: { flight: React.MutableRefObject<Flight> }) {
  const n = 140;
  const ref = useRef<THREE.InstancedMesh>(null), mat = useRef<THREE.MeshBasicMaterial>(null);
  const seeds = useMemo(() => Array.from({ length: n }, (_, i) => [Math.sin(i * 12.9898) * 0.5 + 0.5, Math.sin(i * 78.233) * 0.5 + 0.5, Math.sin(i * 37.719) * 0.5 + 0.5]), []);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const last = useRef(0);
  const { camera } = useThree();
  useFrame((st) => {
    const sp = Math.min(1, flight.current.speed * 1.3), dir = Math.sign(flight.current.progress - last.current) || 1;
    last.current = flight.current.progress;
    for (let i = 0; i < n; i++) {
      const [a, b, c] = seeds[i];
      const x = ((a * 40 - st.clock.elapsedTime * (4 + sp * 90) * dir) % 40 + 40) % 40 - 20;
      m.makeScale(0.3 + sp * 6, 0.02, 0.02).setPosition(x, (b - 0.5) * 14 + 2, -4 - c * 18);
      ref.current!.setMatrixAt(i, m);
    }
    ref.current!.instanceMatrix.needsUpdate = true;
    if (mat.current) mat.current.opacity = sp * 0.7;
    ref.current!.position.copy(camera.position);
    ref.current!.quaternion.copy(camera.quaternion);
  });
  return <instancedMesh ref={ref} args={[undefined, undefined, n]} frustumCulled={false}><boxGeometry args={[1, 1, 1]} /><meshBasicMaterial ref={mat} color="#fff1dc" transparent opacity={0} depthWrite={false} toneMapped={false} /></instancedMesh>;
}

function Rig({ flight }: { flight: React.MutableRefObject<Flight> }) {
  const key = useRef<THREE.DirectionalLight>(null);
  const look = useMemo(() => new THREE.Vector3(), []);
  useFrame((st) => {
    const t = st.clock.elapsedTime, sp = flight.current.speed;
    // the island sits right of centre on wide screens (text on the left), centred on narrow ones
    const wide = st.size.width > 900;
    st.camera.position.set(Math.sin(t * 0.2) * 0.6, 7 + Math.sin(t * 0.3) * 0.3 + sp * 1.2, 19 + sp * 4);
    look.set(wide ? -6.2 : 0, wide ? 0.8 : 2.5, 0);
    st.camera.lookAt(look);
    if (key.current) mix(KEY, flight.current.progress, key.current.color);
  });
  return (
    <directionalLight ref={key} position={[6, 12, 8]} intensity={2.4} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
      shadow-camera-left={-9} shadow-camera-right={9} shadow-camera-top={9} shadow-camera-bottom={-9} shadow-camera-near={1} shadow-camera-far={40} />
  );
}

/** Tells the page the world has rendered a few frames (hides the loader). */
function Ready({ onReady }: { onReady?: () => void }) {
  const n = useRef(0);
  useFrame(() => { if (++n.current === 4) onReady?.(); });
  return null;
}

export default function LandingScene({ flight, onReady }: { flight: React.MutableRefObject<Flight>; onReady?: () => void }) {
  return (
    <Canvas shadows dpr={[1, 1.75]} camera={{ fov: 40, near: 0.1, far: 400, position: [0, 7, 19] }} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
      onCreated={({ scene }) => { scene.fog = new THREE.Fog("#1b4a46", 30, 70); }}>
      <Sky flight={flight} />
      <ambientLight intensity={0.35} />
      <hemisphereLight args={["#fff6e8", "#2a3a2c", 0.6]} />
      <Rig flight={flight} />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={3} position={[0, 6, 6]} scale={[10, 4, 1]} color="#fff4e6" />
        <Lightformer form="rect" intensity={1.5} position={[-8, 2, 0]} rotation-y={Math.PI / 2} scale={[8, 3, 1]} color="#bff6ee" />
        <Lightformer form="ring" intensity={2} position={[8, 4, -4]} scale={4} color="#ffb48a" />
      </Environment>
      <Carousel flight={flight} />
      <Sparkles count={120} scale={[40, 18, 20]} position={[0, 4, -10]} size={2} speed={0.25} color="#fff4d6" opacity={0.6} />
      <SpeedLines flight={flight} />
      <Ready onReady={onReady} />
      <EffectComposer multisampling={4}>
        <Bloom intensity={0.6} luminanceThreshold={0.75} luminanceSmoothing={0.25} mipmapBlur />
        <Vignette offset={0.3} darkness={0.55} />
      </EffectComposer>
    </Canvas>
  );
}
