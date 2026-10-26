import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { GfxArcField, type ArcGeometry } from './field';

// the small coil: its topload's ring, its 30 cm tube tilted up 15°, its tip 0.94 m above the mat
const tilt = (15 * Math.PI) / 180;
const base = new Vector3(0.2335, 0.867, 0);
const axis = new Vector3(Math.cos(tilt), Math.sin(tilt), 0);
const TIP = base.clone().addScaledVector(axis, 0.3);
const GEO: ArcGeometry = {
  tubes: [{ tip: TIP, axis, base, len: 0.3 }], top: new Vector3(0, 0.867, 0), ringR: 0.1785, topR: 0.2335, up: new Vector3(0, 1, 0), matY: 0,
};

/** A seeded generator (mulberry32): the same sparks at every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('arc shape', () => {
  const field = new GfxArcField(GEO, 1.2);

  it('grows every spark from the tube\'s tip, the main one about as far as the reach', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { sparks } = field.grow({ reach: 1.1, strike: 'air' }, seeded(seed));
      expect(sparks.length).toBeGreaterThan(0);
      const main = sparks[0];
      expect(main.pts[0]).toEqual(TIP);
      const far = Math.max(...main.pts.map((p) => p.distanceTo(TIP)));
      expect(far).toBeLessThan(1.1 * 1.5);
    }
  });

  it('keeps sparks in the air off the mat', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { sparks } = field.grow({ reach: 1.5, strike: 'air' }, seeded(seed));
      expect(sparks.some((s) => s.strike)).toBe(false);
      for (const s of sparks) for (const p of s.pts) expect(p.y).toBeGreaterThan(-0.03);
    }
  });

  it('lands a strike on the mat, near where the simulation aims it', () => {
    const target = new Vector3(TIP.x + 0.4, 0, 0.1);
    let landed = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { sparks, landing } = field.grow({ reach: 1.2, strike: 'strike', target }, seeded(seed));
      const hit = sparks.find((s) => s.strike && s.width >= 1);
      const near = landing != null && Math.hypot(landing.x - target.x, landing.z - target.z) < 0.3;
      if (hit && Math.abs(hit.pts[hit.pts.length - 1].y) < 0.03 && near) landed++;
    }
    expect(landed).toBeGreaterThanOrEqual(18);
  });

  it('lands a strike on the point of a grounded ring when it aims there', () => {
    // a ring around the small coil: 1.80 m, 100 mm past the toroid's plane, six points
    const tips = Array.from({ length: 6 }, (_, k) => {
      const a = (k * Math.PI) / 3;
      return new Vector3(0.766 * Math.cos(a), 0.949, 0.766 * Math.sin(a));
    });
    const ringed = new GfxArcField({ ...GEO, ring: { center: new Vector3(0, 0.967, 0), R: 0.8825, a: 0.0175, tips } }, 0.4);
    let landed = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { sparks, landing } = ringed.grow({ reach: 0.33, strike: 'strike', target: tips[0], onto: 'point' }, seeded(seed));
      const hit = sparks.find((s) => s.strike && s.width >= 1);
      if (hit && landing === tips[0] && hit.pts[hit.pts.length - 1] === tips[0]) landed++;
      // no feet on a point
      expect(sparks.filter((s) => s.strike).length).toBeLessThanOrEqual(1);
    }
    expect(landed).toBeGreaterThanOrEqual(18);
    // the ring's own points are read, never moved
    expect(tips[0].x).toBeCloseTo(0.766, 9);
  });

  it('grows from each tube of a coil that has several, and from its crown when it has none', () => {
    const back = new Vector3(-0.2335, 0.867, 0), out = new Vector3(-Math.cos(tilt), Math.sin(tilt), 0);
    const tip2 = back.clone().addScaledVector(out, 0.3);
    const two = new GfxArcField({ ...GEO, tubes: [...GEO.tubes, { tip: tip2, axis: out, base: back, len: 0.3 }] }, 1);
    const { sparks } = two.grow({ reach: 0.8, strike: 'air', from: { tip: tip2, axis: out } }, seeded(3));
    expect(sparks[0].pts[0]).toEqual(tip2);
    expect(sparks[0].pts.some((p) => p.x < tip2.x - 0.2)).toBe(true);
    const crown = new GfxArcField({ ...GEO, tubes: [] }, 1);
    for (let seed = 1; seed <= 5; seed++) {
      const at = crown.grow({ reach: 0.6, strike: 'air' }, seeded(seed)).sparks[0].pts[0];
      expect(Math.hypot(at.x, at.z)).toBeCloseTo(GEO.topR, 6);
      expect(at.y).toBeCloseTo(GEO.top.y, 6);
    }
    // the tube's tip is read, never moved
    expect(TIP.x).toBeCloseTo(0.2335 + 0.3 * Math.cos(tilt), 9);
  });

  it('remembers a path only at bang rates where the air still holds it', () => {
    expect(GfxArcField.pathHeld(0)).toBe(0);
    expect(GfxArcField.pathHeld(55)).toBeLessThan(0.03);
    expect(GfxArcField.pathHeld(880)).toBeGreaterThan(0.75);
  });
});
