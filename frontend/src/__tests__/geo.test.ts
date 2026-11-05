import { describe, expect, it } from "vitest";
import { HUB_RADIUS, buildTruckPath, makeProjection, pointOn, polyLength, realToPath, sunPosition, type V2 } from "../world/geo";

describe("solar position", () => {
  it("is high at local noon and below the horizon at midnight in Kolar", () => {
    // 06:30 UTC = 12:00 IST; 18:30 UTC = 00:00 IST
    const noon = sunPosition(new Date("2026-11-06T06:30:00Z"), 13.14, 78.13);
    const midnight = sunPosition(new Date("2026-11-06T18:30:00Z"), 13.14, 78.13);
    expect(noon.elevation).toBeGreaterThan(50);
    expect(noon.azimuth).toBeGreaterThan(150);   // sun is to the south in November
    expect(noon.azimuth).toBeLessThan(210);
    expect(midnight.elevation).toBeLessThan(-40);
  });
  it("rises in the east in the morning", () => {
    const morning = sunPosition(new Date("2026-11-06T01:30:00Z"), 13.14, 78.13);   // 07:00 IST
    expect(morning.elevation).toBeGreaterThan(0);
    expect(morning.azimuth).toBeGreaterThan(90);
    expect(morning.azimuth).toBeLessThan(135);
  });
});

describe("map projection and truck path", () => {
  it("projects north-up with metres scaled", () => {
    const p = makeProjection(13, 78, 1 / 40);
    const [x, z] = p.toXZ(13.01, 78);
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(-1113.2 / 40, 0);   // 0.01 deg latitude ~ 1113 m, north = -z
  });
  it("maps real route distance monotonically onto the world path and ends at the destination", () => {
    const route: V2[] = Array.from({ length: 50 }, (_, i) => [i * 10, -i * 4]);
    const tp = buildTruckPath(route);
    const total = polyLength(route).slice(-1)[0];
    let prev = -1;
    for (let k = 0; k <= 20; k++) {
      const d = realToPath((total * k) / 20, tp);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
    const end = pointOn(tp.path, tp.cum, realToPath(total, tp));
    expect(end.x).toBeCloseTo(route[49][0], 3);
    expect(end.z).toBeCloseTo(route[49][1], 3);
    // the truck leaves the hub on the ring road before joining the real route
    const ring = pointOn(tp.path, tp.cum, tp.cum[tp.path.length - (route.length - tp.realExitIdx) - 1]);
    expect(Math.hypot(ring.x, ring.z)).toBeCloseTo(HUB_RADIUS, 3);
  });
});
