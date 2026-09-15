import { describe, expect, it } from 'vitest';
import {
  ArcMeter,
  blur3,
  dilateBinary,
  gradMag,
  maskedNcc,
  minMaxSquare,
  nccRef,
  percentile,
  summarize,
  tophat,
  type ArcGeometry,
} from './arc-meter';

/* ------------------------------------------------------------------ helpers */

const W = 192, H = 144;
const GEOM: ArcGeometry = { width: W, height: H, breakout: { x: 96, y: 60 }, roiRadius: 50, excludeBelowY: 80 };

/** Deterministic pseudo-random generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Distance from (px, py) to the segment a-b. */
function distToSeg(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / len2));
  return Math.hypot(px - (a.x + t * vx), py - (a.y + t * vy));
}

/**
 * A night scene: dark gradient sky, a bright static "LED bar" under the coil, a
 * lit "window" to the right, gaussian-ish sensor noise. Optionally shifted by
 * (dx, dy) (camera moved) and with an "arc" polyline from the breakout, `arcWidth` px wide
 * (2 by default), optionally wrapped in a gaussian halo (the camera's bloom around a bright channel).
 */
function scene(opts: { noise?: number; shift?: { dx: number; dy: number }; arc?: { x: number; y: number }[]; arcWidth?: number; arcHalo?: { amp: number; sigma: number }; glow?: number; seed?: number; ground?: { x: number; y: number; r: number } } = {}): Uint8ClampedArray {
  const { noise = 2, shift = { dx: 0, dy: 0 }, arc, arcWidth = 2, arcHalo, glow = 0, seed = 1, ground } = opts;
  const rand = rng(seed);
  const img = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = x - shift.dx, sy = y - shift.dy; // scene coordinate
      let r = 10 + sy * 0.15, g = 12 + sy * 0.15, b = 20 + sy * 0.2;
      // coil body: vertical bar under the breakout
      if (Math.abs(sx - 96) < 6 && sy > 62 && sy < 100) { r = 70; g = 70; b = 75; }
      // LED bar at the base (very bright, static)
      if (sy >= 96 && sy < 102 && sx > 70 && sx < 122) { r = 250; g = 250; b = 255; }
      // window on the right (static, orange, inside the ROI radius but static)
      if (sx > 130 && sx < 150 && sy > 40 && sy < 70) { r = 200; g = 140; b = 60; }
      // diffuse glow around the breakout (the arc lighting the toroid/room)
      if (glow > 0) {
        const dd = Math.hypot(sx - 96, sy - 60);
        const gl = glow * Math.exp(-(dd * dd) / (2 * 20 * 20));
        r += gl; g += gl; b += gl;
      }
      // ground lit up around a strike point: bright, wide, smooth, with grass texture on top
      if (ground) {
        const dd = Math.hypot(sx - ground.x, sy - ground.y);
        if (dd < ground.r) {
          // near-saturated lit grass: a bright smooth mound with a moderate, coarse texture on top
          const k = 0.6 + 0.4 * (1 - dd / ground.r);
          const tex = 30 * Math.sin(sx * 1.2) * Math.cos(sy * 1.1);
          r += 215 * k + tex; g += 205 * k + tex; b += 140 * k + tex;
        }
      }
      const n1 = (rand() + rand() + rand() - 1.5) * noise * 2;
      const i = (y * W + x) * 4;
      img[i] = r + n1; img[i + 1] = g + n1; img[i + 2] = b + n1; img[i + 3] = 255;
    }
  }
  if (arc && arcHalo) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let near = Infinity;
      for (let k = 0; k < arc.length - 1; k++) near = Math.min(near, distToSeg(x - shift.dx, y - shift.dy, arc[k], arc[k + 1]));
      const d = Math.max(0, near - arcWidth / 2);
      const gl = arcHalo.amp * Math.exp(-(d * d) / (2 * arcHalo.sigma * arcHalo.sigma));
      if (gl < 1) continue;
      const i = (y * W + x) * 4;
      img[i] += gl * 0.8; img[i + 1] += gl * 0.7; img[i + 2] += gl;
    }
  }
  if (arc) {
    // arcWidth-px wide violet/white filament along the polyline
    const o0 = -Math.floor((arcWidth - 1) / 2), o1 = Math.ceil((arcWidth - 1) / 2);
    for (let k = 0; k < arc.length - 1; k++) {
      const a = arc[k], b = arc[k + 1];
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = Math.round(a.x + (b.x - a.x) * t + shift.dx), y = Math.round(a.y + (b.y - a.y) * t + shift.dy);
        for (let oy = o0; oy <= o1; oy++) for (let ox = o0; ox <= o1; ox++) {
          const xx = x + ox, yy = y + oy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const i = (yy * W + xx) * 4;
          img[i] = 230; img[i + 1] = 200; img[i + 2] = 255;
        }
      }
    }
  }
  return img;
}

function meterWithBackground(seedBase = 100): ArcMeter {
  const m = new ArcMeter(GEOM);
  const b = m.backgroundBuilder();
  for (let k = 0; k < 12; k++) b.add(m.cropFrom(scene({ seed: seedBase + k })));
  m.buildBackground(b);
  return m;
}

/* -------------------------------------------------------------------- tests */

describe('kernels', () => {
  it('blur3 preserves a flat field and gradMag is zero on it', () => {
    const flat = new Float32Array(W * H).fill(42);
    const bl = blur3(flat, W, H);
    expect(bl[W * 10 + 10]).toBeCloseTo(42, 5);
    const g = gradMag(bl, W, H);
    expect(Math.max(...g)).toBeLessThan(1e-4);
  });

  it('tophat keeps a thin bright line and removes a wide plateau', () => {
    const img = new Float32Array(W * H);
    for (let y = 20; y < 60; y++) for (let x = 20; x < 100; x++) img[y * W + x] = 100; // wide plateau
    for (let x = 110; x < 170; x++) img[80 * W + x] = 100; // 1-px line
    const out = new Float32Array(W * H), t1 = new Float32Array(W * H), t2 = new Float32Array(W * H);
    tophat(img, W, H, 9, out, t1, t2);
    expect(out[40 * W + 60]).toBeLessThan(1); // plateau interior gone
    expect(out[80 * W + 140]).toBeGreaterThan(90); // line kept
  });

  it('minMaxSquare matches a brute-force window min/max (borders included)', () => {
    const w = 37, h = 23, win = 9, r = 4;
    const img = new Float32Array(w * h); const rand = rng(11);
    for (let i = 0; i < img.length; i++) img[i] = Math.floor(rand() * 100);
    const out = new Float32Array(w * h), tmp = new Float32Array(w * h);
    for (const isMax of [true, false]) {
      minMaxSquare(img, w, h, win, isMax, out, tmp);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let v = isMax ? -Infinity : Infinity;
        for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++)
          for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) v = isMax ? Math.max(v, img[yy * w + xx]) : Math.min(v, img[yy * w + xx]);
        expect(out[y * w + x]).toBe(v);
      }
    }
  });

  it('dilateBinary matches a brute-force square dilation', () => {
    const w = 31, h = 19, r = 3;
    const src = new Uint8Array(w * h); const rand = rng(5);
    for (let i = 0; i < src.length; i++) src[i] = rand() < 0.03 ? 1 : 0;
    src[0] = 1; src[w * h - 1] = 1;
    const out = new Uint8Array(w * h), tmp = new Uint8Array(w * h);
    dilateBinary(src, w, h, r, out, tmp);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = 0;
      for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r) && !v; yy++)
        for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) if (src[yy * w + xx]) { v = 1; break; }
      expect(out[y * w + x]).toBe(v);
    }
  });

  it('maskedNcc is 1 at the true shift', () => {
    const a = new Float32Array(W * H), b = new Float32Array(W * H);
    const rand = rng(7);
    for (let i = 0; i < a.length; i++) a[i] = rand() * 100;
    // b(x,y) = a(x-3, y+2): reading b at (+3, -2) gives back a
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const sx = Math.min(W - 1, Math.max(0, x - 3)), sy = Math.min(H - 1, Math.max(0, y + 2));
      b[y * W + x] = a[sy * W + sx];
    }
    const xs: number[] = [], ys: number[] = [];
    for (let y = 10; y < H - 10; y += 2) for (let x = 10; x < W - 10; x += 2) { xs.push(x); ys.push(y); }
    const ref = nccRef(a, Int32Array.from(xs), Int32Array.from(ys), W);
    let best = -2, bdx = 0, bdy = 0;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const c = maskedNcc(ref, b, W, H, dx, dy);
      if (c > best) { best = c; bdx = dx; bdy = dy; }
    }
    expect(best).toBeGreaterThan(0.99);
    expect(bdx).toBe(3);
    expect(bdy).toBe(-2);
  });
});

describe('ArcMeter', () => {
  it('measures nothing on a coil-off frame (static lights, noise)', () => {
    const m = meterWithBackground();
    const r = m.measure(scene({ seed: 999 }));
    expect(r.L).toBe(0);
    expect(r.stable).toBe(true);
    expect(r.stray).toBeLessThan(20);
  });

  it('measures the arc length from the breakout and ignores static bright objects', () => {
    const m = meterWithBackground();
    // arc going up-left, tip at (60, 30): length = hypot(36, 30) ≈ 46.9
    const arc = [{ x: 96, y: 60 }, { x: 84, y: 50 }, { x: 72, y: 42 }, { x: 60, y: 30 }];
    const r = m.measure(scene({ seed: 5, arc }));
    expect(r.L).toBeGreaterThan(42);
    expect(r.L).toBeLessThan(50);
    expect(r.tip).not.toBeNull();
    expect(r.tip!.x).toBeLessThan(66);
    expect(r.area).toBeGreaterThan(40);
    // the LED bar / window / coil body must not be detected
    expect(r.stray).toBeLessThan(30);
  });

  it('keeps a channel that blooms to several pixels, with or without a halo', () => {
    const m = meterWithBackground();
    const arc = [{ x: 96, y: 60 }, { x: 84, y: 50 }, { x: 72, y: 42 }, { x: 60, y: 30 }]; // ≈ 46.9
    for (const arcWidth of [4, 6]) {
      const r = m.measure(scene({ seed: 5, arc, arcWidth }));
      expect(r.L).toBeGreaterThan(42);
      expect(r.L).toBeLessThan(52);
    }
    // a horizontal channel fills the most of any square neighbourhood: the case a density rule breaks on
    const flat = m.measure(scene({ seed: 5, arc: [{ x: 96, y: 60 }, { x: 120, y: 60 }, { x: 142, y: 60 }], arcWidth: 5 }));
    expect(flat.L).toBeGreaterThan(42);
    const halo = m.measure(scene({ seed: 5, arc, arcHalo: { amp: 100, sigma: 2 } }));
    expect(halo.L).toBeGreaterThan(42);
    expect(halo.L).toBeLessThan(52);
  });

  it('follows a forked arc past the fork', () => {
    const m = meterWithBackground();
    // the polyline retraces the trunk so the second branch grows from the fork point (78, 48)
    const fork = [{ x: 96, y: 60 }, { x: 78, y: 48 }, { x: 60, y: 30 }, { x: 78, y: 48 }, { x: 60, y: 52 }, { x: 50, y: 56 }];
    for (const arcWidth of [3, 5]) {
      const r = m.measure(scene({ seed: 5, arc: fork, arcWidth }));
      expect(r.L).toBeGreaterThan(42); // tip (60, 30) ≈ 46.9; the fork itself is at ≈ 21.6
      expect(r.L).toBeLessThan(52);
    }
  });

  it('ignores the diffuse glow of the arc on the surroundings', () => {
    const m = meterWithBackground();
    const r = m.measure(scene({ seed: 6, glow: 60 }));
    expect(r.L).toBe(0);
  });

  it('reports the same length when the camera shifted a few pixels', () => {
    const m = meterWithBackground();
    const arc = [{ x: 96, y: 60 }, { x: 110, y: 40 }, { x: 124, y: 28 }]; // ≈ 42.5 px
    const still = m.measure(scene({ seed: 8, arc }));
    const moved = m.measure(scene({ seed: 9, arc, shift: { dx: 6, dy: -4 } }));
    expect(moved.shift.dx).toBe(6);
    expect(moved.shift.dy).toBe(-4);
    expect(moved.stable).toBe(true);
    expect(moved.moved).toBe(false); // 6 px = the limit, not beyond
    expect(Math.abs(moved.L - still.L)).toBeLessThan(3);
    const far = m.measure(scene({ seed: 12, arc, shift: { dx: 12, dy: 2 } }));
    expect(far.moved).toBe(true);
  });

  it('stops at the channel where a strike lights up the ground (the lit patch is not arc)', () => {
    // arc from the breakout down-left to the ground at (60, 78); a lit patch of radius 16 around the strike point
    const arc = [{ x: 96, y: 60 }, { x: 84, y: 66 }, { x: 72, y: 72 }, { x: 60, y: 78 }];
    const ground = { x: 60, y: 78, r: 16 };
    const strict = meterWithBackground();
    const r = strict.measure(scene({ seed: 21, arc, ground }));
    const toStrike = Math.hypot(96 - 60, 60 - 78); // ≈ 40.2
    expect(r.L).toBeGreaterThan(toStrike - ground.r - 6); // channel kept up to the patch
    expect(r.L).toBeLessThanOrEqual(toStrike + 2); // never beyond the strike point
    expect(r.area).toBeLessThan(260); // the patch (≈ 800 px) is not counted
    // without the thin-channel rule the patch would be swallowed into the arc
    const plain = new ArcMeter(GEOM, { thinRatio: 0 });
    const b = plain.backgroundBuilder();
    for (let k = 0; k < 12; k++) b.add(plain.cropFrom(scene({ seed: 100 + k })));
    plain.buildBackground(b);
    plain.measure(scene({ seed: 21, arc, ground }));
    // kept pixels inside the lit patch but AWAY from the channel: (almost) none with the rule, plenty without
    const inPatch = (m: ArcMeter): number => {
      let c = 0;
      for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
        if (!m.keep[y * m.width + x]) continue;
        const fx = x + m.crop.x0, fy = y + m.crop.y0;
        if (Math.hypot(fx - ground.x, fy - ground.y) >= ground.r - 3) continue;
        let near = Infinity;
        for (let k = 0; k < arc.length - 1; k++) near = Math.min(near, distToSeg(fx, fy, arc[k], arc[k + 1]));
        if (near > 4) c++;
      }
      return c;
    };
    expect(inPatch(strict)).toBeLessThan(15);
    expect(inPatch(plain)).toBeGreaterThan(inPatch(strict) + 25);
  });

  it('half-disk zone: keeps an arc the zone faces and ignores one behind it', () => {
    const arcRight = [{ x: 96, y: 60 }, { x: 120, y: 52 }, { x: 138, y: 58 }];
    const arcLeft = [{ x: 96, y: 60 }, { x: 72, y: 52 }, { x: 54, y: 58 }];
    const build = (dirDeg: number | null): ArcMeter => {
      const m = new ArcMeter({ ...GEOM, dirDeg });
      const b = m.backgroundBuilder();
      for (let k = 0; k < 12; k++) b.add(m.cropFrom(scene({ seed: 300 + k })));
      m.buildBackground(b);
      return m;
    };
    const full = build(null), facingRight = build(0), facingLeft = build(180), facingUp = build(-90);
    const Lfull = full.measure(scene({ arc: arcRight, seed: 7 })).L;
    expect(Lfull).toBeGreaterThan(38);
    // the zone faces the arc: same length as the full disk
    expect(facingRight.measure(scene({ arc: arcRight, seed: 7 })).L).toBeCloseTo(Lfull, 0);
    expect(facingLeft.measure(scene({ arc: arcLeft, seed: 7 })).L).toBeCloseTo(full.measure(scene({ arc: arcLeft, seed: 7 })).L, 0);
    // the arc runs behind the zone: only the root disk can be counted
    expect(facingLeft.measure(scene({ arc: arcRight, seed: 7 })).L).toBeLessThan(full.rootRadius + 2);
    expect(facingRight.measure(scene({ arc: arcLeft, seed: 7 })).L).toBeLessThan(full.rootRadius + 2);
    // perpendicular: the half-plane includes the arc's direction, so it is kept
    expect(facingUp.measure(scene({ arc: arcRight, seed: 7 })).L).toBeCloseTo(Lfull, 0);
    // geometry and heat carry the direction
    expect(facingRight.geom.dirDeg).toBe(0);
  });

  it('does not count an arc-like filament that is not connected to the breakout', () => {
    const m = meterWithBackground();
    const r = m.measure(scene({ seed: 10, arc: [{ x: 40, y: 20 }, { x: 60, y: 35 }] }));
    expect(r.L).toBe(0);
    expect(r.stray).toBeGreaterThan(10);
  });

  it('keeps the alignment confidence low on an unrelated scene', () => {
    const m = meterWithBackground();
    const junk = new Uint8ClampedArray(W * H * 4);
    const rand = rng(3);
    for (let i = 0; i < junk.length; i += 4) { const v = rand() * 255; junk[i] = v; junk[i + 1] = v; junk[i + 2] = v; junk[i + 3] = 255; }
    const r = m.measure(junk);
    expect(r.stable).toBe(false);
  });
});

describe('summarize', () => {
  it('computes hit rate, median and P90', () => {
    const s = summarize([0, 0, 10, 20, 30, 40, 50, 60, 70, 80]);
    expect(s.frames).toBe(10);
    expect(s.hitRate).toBeCloseTo(0.8);
    expect(s.median).toBeCloseTo(35);
    expect(s.p90).toBeCloseTo(71);
    expect(s.max).toBe(80);
    expect(percentile([], 0.5)).toBe(0);
  });
});
