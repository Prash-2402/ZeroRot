/** Solar position (NOAA simplified algorithm) and map projection for the 3D world. */
const rad = Math.PI / 180;

/** Sun elevation/azimuth in degrees for a UTC time and location. Azimuth: 0 = north, 90 = east. */
export function sunPosition(date: Date, lat: number, lng: number) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lst = (gmst * 15 + lng) * rad;
  const ha = lst - ra;
  const phi = lat * rad;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  return { elevation: el / rad, azimuth: ((az / rad) + 360) % 360 };
}

export const HUB_RADIUS = 72;

/** North-up local projection centred on the godown. 1 world unit = 1/scale metres. */
export function makeProjection(lat0: number, lng0: number, scale: number) {
  const k = 111320;
  const c = Math.cos(lat0 * rad);
  return {
    scale,
    toXZ: (lat: number, lng: number): [number, number] => [(lng - lng0) * c * k * scale, -(lat - lat0) * k * scale],
  };
}

export type V2 = [number, number];

export function polyLength(p: V2[]) {
  const cum = [0];
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  return cum;
}

export function pointOn(p: V2[], cum: number[], d: number): { x: number; z: number; heading: number } {
  if (p.length === 1) return { x: p[0][0], z: p[0][1], heading: 0 };
  const dd = Math.max(0, Math.min(cum[cum.length - 1], d));
  let lo = 1, hi = cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < dd) lo = mid + 1; else hi = mid; }
  const i = Math.max(1, lo);
  const seg = cum[i] - cum[i - 1] || 1;
  const f = (dd - cum[i - 1]) / seg;
  const [x0, z0] = p[i - 1], [x1, z1] = p[i];
  return { x: x0 + (x1 - x0) * f, z: z0 + (z1 - z0) * f, heading: Math.atan2(x1 - x0, z1 - z0) };
}

/**
 * World path for a truck: yard -> south lane -> ring road arc -> real projected route beyond the hub radius.
 * `realSplit` is the fraction of real route distance that maps onto the in-hub part, so position stays proportional to
 * the backend's distance-based progress.
 */
export function buildTruckPath(route: V2[]): { path: V2[]; cum: number[]; hubLen: number; realCum: number[]; realExitIdx: number } {
  const realCum = polyLength(route);
  let exit = route.findIndex(([x, z]) => Math.hypot(x, z) > HUB_RADIUS);
  if (exit < 0) exit = route.length - 1;
  const [ex, ez] = route[exit];
  const exitAng = Math.atan2(ez, ex);
  const startAng = Math.PI / 2;   // south of the hub (+z)
  let dAng = exitAng - startAng;
  while (dAng > Math.PI) dAng -= 2 * Math.PI;
  while (dAng < -Math.PI) dAng += 2 * Math.PI;
  const internal: V2[] = [[0, 12], [0, 40], [0, HUB_RADIUS]];
  const steps = Math.max(2, Math.ceil(Math.abs(dAng) / 0.12));
  for (let i = 1; i <= steps; i++) {
    const a = startAng + (dAng * i) / steps;
    internal.push([Math.cos(a) * HUB_RADIUS, Math.sin(a) * HUB_RADIUS]);
  }
  const path = [...internal, ...route.slice(exit)];
  const cum = polyLength(path);
  // hubLen runs up to route[exit] (includes the link from the ring road), so the rest maps 1:1 onto the real route
  return { path, cum, hubLen: cum[internal.length], realCum, realExitIdx: exit };
}

/** Map a real-route distance (in projected units along `route`) to a distance along the world truck path. */
export function realToPath(d: number, tp: ReturnType<typeof buildTruckPath>) {
  const exitD = tp.realCum[tp.realExitIdx];
  if (d <= exitD) return exitD > 0 ? (d / exitD) * tp.hubLen : tp.hubLen;
  return tp.hubLen + (d - exitD);
}

export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
