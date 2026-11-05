import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Sky, Stars } from "@react-three/drei";
import * as THREE from "three";
import { grassTex, softDotTex } from "./textures";
import { seeded, type V2 } from "./geo";

export type Env = { elevation: number; azimuth: number; cloud: number; rain: number; rh: number; isNight: boolean; daylight: number };

export function envFrom(sun: { elevation: number; azimuth: number }, cloud: number | null, precip: number | null, rh: number | null): Env {
  const daylight = THREE.MathUtils.clamp((sun.elevation + 6) / 18, 0, 1);
  return { ...sun, cloud: (cloud ?? 20) / 100, rain: precip ?? 0, rh: rh ?? 60, isNight: sun.elevation < -4, daylight };
}

/** Sun, sky, fog, stars, clouds and rain driven by the simulated time, location and the live forecast. */
export function Atmosphere({ env, focus }: { env: Env; focus: THREE.Vector3 }) {
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const { scene } = useThree();
  const dir = useMemo(() => {
    const el = THREE.MathUtils.degToRad(Math.max(env.elevation, -10));
    const az = THREE.MathUtils.degToRad(env.azimuth);
    return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  }, [env.elevation, env.azimuth]);
  const dayFog = new THREE.Color("#c9d6dd"), duskFog = new THREE.Color("#d79a6a"), nightFog = new THREE.Color("#141c2c");
  const fogColor = useMemo(() => {
    const c = new THREE.Color();
    if (env.daylight < 0.35) c.copy(nightFog).lerp(duskFog, env.daylight / 0.35);
    else c.copy(duskFog).lerp(dayFog, Math.min(1, (env.daylight - 0.35) / 0.4));
    return c.lerp(new THREE.Color("#8a939a"), env.cloud * 0.5);
  }, [env.daylight, env.cloud]);
  useEffect(() => {
    scene.fog = new THREE.FogExp2(fogColor, (env.isNight ? 0.0004 : 0.00055) + (env.rh > 90 ? 0.0004 : 0) + Math.min(1, env.rain) * 0.0003);
    scene.background = fogColor;
  }, [fogColor, env.rh, env.rain, scene]);
  useFrame(() => {
    const l = sunRef.current;
    if (!l) return;
    l.position.copy(focus).addScaledVector(dir, 300);
    l.target.position.copy(focus);
    l.target.updateMatrixWorld();
  });
  const sunI = env.isNight ? 0.05 : (0.4 + 2.6 * env.daylight) * (1 - env.cloud * 0.6);
  return (
    <>
      {!env.isNight && <Sky distance={4500} sunPosition={dir.clone().multiplyScalar(100)} turbidity={4 + env.cloud * 10} rayleigh={1.2 + env.cloud} mieCoefficient={0.006} mieDirectionalG={0.85} />}
      {env.daylight < 0.4 && <Stars radius={1800} depth={200} count={4000} factor={6} fade speed={0.2} />}
      <hemisphereLight args={[env.isNight ? "#30406a" : "#dfeaf5", env.isNight ? "#0a0c10" : "#5a5040", env.isNight ? 0.5 : 0.55 + 0.35 * env.daylight]} />
      <directionalLight ref={sunRef} intensity={sunI} color={env.daylight < 0.45 ? "#ffb070" : "#fff4e2"} castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.04}
        shadow-camera-left={-90} shadow-camera-right={90} shadow-camera-top={90} shadow-camera-bottom={-90} shadow-camera-near={10} shadow-camera-far={700} />
      {env.isNight && <directionalLight position={[-200, 300, 100]} intensity={0.45} color="#9fb5ff" />}
      <CloudLayer cover={env.cloud} night={env.isNight} focus={focus} />
      {env.rain > 0.1 && <Rain intensity={env.rain} focus={focus} />}
    </>
  );
}

function CloudLayer({ cover, night, focus }: { cover: number; night: boolean; focus: THREE.Vector3 }) {
  const group = useRef<THREE.Group>(null);
  const items = useMemo(() => {
    const r = seeded(77);
    return Array.from({ length: 70 }, () => ({ x: (r() - 0.5) * 2600, z: (r() - 0.5) * 2600, y: 260 + r() * 120, s: 120 + r() * 220, puffs: 3 + Math.floor(r() * 4), seed: r() }));
  }, []);
  const tex = softDotTex();
  const visible = Math.round(items.length * Math.min(1, cover * 1.1));
  useFrame((_, dt) => {
    if (!group.current) return;
    group.current.position.x += dt * 2.5;
    if (group.current.position.x > 1300) group.current.position.x -= 2600;
    group.current.position.z = focus.z * 0.6;
  });
  return (
    <group ref={group}>
      {items.slice(0, visible).map((c, i) => (
        <group key={i} position={[c.x, c.y, c.z]}>
          {Array.from({ length: c.puffs }, (_, k) => (
            <sprite key={k} position={[(k - c.puffs / 2) * c.s * 0.35, Math.sin(k + c.seed * 6) * c.s * 0.08, (k % 2) * c.s * 0.2]} scale={[c.s * (0.8 + (k % 3) * 0.2), c.s * 0.45, 1]}>
              <spriteMaterial map={tex} color={night ? "#3a4256" : cover > 0.7 ? "#b8bec4" : "#ffffff"} transparent opacity={0.75} depthWrite={false} fog={false} />
            </sprite>
          ))}
        </group>
      ))}
    </group>
  );
}

function Rain({ intensity, focus }: { intensity: number; focus: THREE.Vector3 }) {
  const ref = useRef<THREE.LineSegments>(null);
  const count = Math.min(6000, Math.round(1500 + intensity * 1500));
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(count * 6);
    const r = seeded(5);
    for (let i = 0; i < count; i++) {
      const x = (r() - 0.5) * 200, y = r() * 80, z = (r() - 0.5) * 200;
      p.set([x, y, z, x + 0.3, y + 1.6, z], i * 6);
    }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    return g;
  }, [count]);
  useFrame((_, dt) => {
    const a = ref.current?.geometry.attributes.position as THREE.BufferAttribute | undefined;
    if (!a || !ref.current) return;
    const arr = a.array as Float32Array;
    for (let i = 0; i < count; i++) {
      let y = arr[i * 6 + 1] - dt * 45;
      if (y < 0) y += 80;
      arr[i * 6 + 1] = y; arr[i * 6 + 4] = y + 1.6;
    }
    a.needsUpdate = true;
    ref.current.position.set(focus.x, 0, focus.z);
  });
  return <lineSegments ref={ref} geometry={geo}><lineBasicMaterial color="#a8c4dd" transparent opacity={0.45} /></lineSegments>;
}

/** Ground, distant hills, scattered trees (kept off the roads) and farmland. */
export function Terrain({ roads }: { roads: V2[][] }) {
  const tex = grassTex();
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, -0.02, 0]}>
        <planeGeometry args={[7000, 7000]} />
        <meshStandardMaterial map={tex} roughness={1} />
      </mesh>
      <Hills />
      <Trees roads={roads} />
    </>
  );
}

function Hills() {
  const hills = useMemo(() => {
    const r = seeded(31);
    return Array.from({ length: 46 }, (_, i) => {
      const a = (i / 46) * Math.PI * 2 + r() * 0.1;
      const d = 2600 + r() * 600;
      return { x: Math.cos(a) * d, z: Math.sin(a) * d, h: 120 + r() * 260, w: 300 + r() * 400 };
    });
  }, []);
  return (
    <group>
      {hills.map((h, i) => (
        <mesh key={i} position={[h.x, h.h / 2 - 5, h.z]}>
          <coneGeometry args={[h.w, h.h, 7]} />
          <meshStandardMaterial color="#4c6240" roughness={1} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function distToSegs(x: number, z: number, segs: number[][]) {
  let best = Infinity;
  for (const [ax, az, bx, bz] of segs) {
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const d = Math.hypot(x - (ax + t * dx), z - (az + t * dz));
    if (d < best) best = d;
  }
  return best;
}

function Trees({ roads }: { roads: V2[][] }) {
  const trunk = useRef<THREE.InstancedMesh>(null);
  const crown = useRef<THREE.InstancedMesh>(null);
  const crown2 = useRef<THREE.InstancedMesh>(null);
  const N = 2600;
  const key = roads.map((r) => r.length).join(",");
  useEffect(() => {
    const segs: number[][] = [];
    for (const r of roads) for (let i = 1; i < r.length; i += 1) segs.push([r[i - 1][0], r[i - 1][1], r[i][0], r[i][1]]);
    const grid = new Map<string, number[][]>();
    const cell = 60;
    for (const s of segs) {
      const minx = Math.floor(Math.min(s[0], s[2]) / cell) - 1, maxx = Math.floor(Math.max(s[0], s[2]) / cell) + 1;
      const minz = Math.floor(Math.min(s[1], s[3]) / cell) - 1, maxz = Math.floor(Math.max(s[1], s[3]) / cell) + 1;
      for (let gx = minx; gx <= maxx; gx++) for (let gz = minz; gz <= maxz; gz++) { const k = `${gx},${gz}`; if (!grid.has(k)) grid.set(k, []); grid.get(k)!.push(s); }
    }
    const r = seeded(99);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    let n = 0;
    for (let tries = 0; n < N && tries < N * 4; tries++) {
      const a = r() * Math.PI * 2;
      const d = 95 + Math.pow(r(), 0.8) * 2300;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (x < -20 && x > -110 && z > -60 && z < 60) continue;   // farmland west of the hub
      const near = grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`);
      if (near && distToSegs(x, z, near) < 9) continue;
      const h = 4 + r() * 7;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
      m.compose(p.set(x, h * 0.25, z), q, s.set(0.5, h * 0.5, 0.5)); trunk.current!.setMatrixAt(n, m);
      m.compose(p.set(x, h * 0.62, z), q, s.set(h * 0.45, h * 0.5, h * 0.45)); crown.current!.setMatrixAt(n, m);
      m.compose(p.set(x + 0.4, h * 0.9, z - 0.3), q, s.set(h * 0.32, h * 0.32, h * 0.32)); crown2.current!.setMatrixAt(n, m);
      col.setHSL(0.24 + r() * 0.08, 0.45 + r() * 0.2, 0.22 + r() * 0.12);
      crown.current!.setColorAt(n, col); crown2.current!.setColorAt(n, col.offsetHSL(0, 0, 0.04));
      n++;
    }
    for (const im of [trunk.current!, crown.current!, crown2.current!]) { im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); }
  }, [key]);
  return (
    <>
      <instancedMesh ref={trunk} args={[undefined, undefined, N]} castShadow><cylinderGeometry args={[0.35, 0.5, 1, 6]} /><meshStandardMaterial color="#5a4030" /></instancedMesh>
      <instancedMesh ref={crown} args={[undefined, undefined, N]} castShadow><icosahedronGeometry args={[1, 1]} /><meshStandardMaterial roughness={0.9} flatShading /></instancedMesh>
      <instancedMesh ref={crown2} args={[undefined, undefined, N]} castShadow><icosahedronGeometry args={[1, 0]} /><meshStandardMaterial roughness={0.9} flatShading /></instancedMesh>
    </>
  );
}
