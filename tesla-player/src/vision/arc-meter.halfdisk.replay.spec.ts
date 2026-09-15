import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ArcMeter, summarize } from './arc-meter';

/** Same recording as arc-meter.replay.spec.ts; probes the half-disk zone (dirDeg). */
const FILE = process.env.ARC_REPLAY ?? '';
const W = 384, H = 512;

describe.skipIf(!FILE || !existsSync(FILE))('arc meter replay — half-disk zone', () => {
  it('keeps the arcs when the zone faces them and drops them when it faces away', () => {
    const buf = readFileSync(FILE);
    const frameBytes = W * H * 4;
    const n = Math.floor(buf.length / frameBytes);
    const frame = (i: number): Uint8ClampedArray => new Uint8ClampedArray(buf.buffer, buf.byteOffset + i * frameBytes, frameBytes);
    const s = 384 / 576;
    const run = (dirDeg: number | null): { p90: number; hit: number } => {
      const meter = new ArcMeter({ width: W, height: H, breakout: { x: Math.round(293 * s), y: Math.round(405 * s) }, roiRadius: 90 * s, excludeBelowY: Math.round(440 * s), dirDeg });
      const builder = meter.backgroundBuilder(32);
      for (let k = 0; k < 32; k++) builder.add(meter.cropFrom(frame(100 + k)));
      meter.buildBackground(builder);
      const Ls: number[] = [];
      for (let i = 100; i < n; i++) { const m = meter.measure(frame(i)); if (!m.moved) Ls.push(m.L); }
      const st = summarize(Ls);
      return { p90: st.p90, hit: st.hitRate };
    };
    const full = run(null);
    const probe = [-180, -135, -90, -45, 0, 45, 90, 135].map((d) => ({ d, ...run(d) }));
    console.log('full', full, '\n' + probe.map((p) => `${p.d}°: p90=${p.p90.toFixed(1)} hit=${p.hit.toFixed(2)}`).join('\n'));
    const best = probe.reduce((a, b) => (b.p90 > a.p90 ? b : a));
    const worst = probe.reduce((a, b) => (b.p90 < a.p90 ? b : a));
    // a half-disk never measures more than the full disk; facing the arcs it measures the
    // same; facing away it loses a good part of them (this recording sprays arcs over a wide
    // fan, so the back side still catches some: the synthetic unit test covers the clean case)
    for (const p of probe) expect(p.p90).toBeLessThanOrEqual(full.p90 + 0.5);
    expect(best.p90).toBeGreaterThan(full.p90 * 0.95);
    expect(worst.p90).toBeLessThan(full.p90 * 0.8);
  }, 120_000);
});
