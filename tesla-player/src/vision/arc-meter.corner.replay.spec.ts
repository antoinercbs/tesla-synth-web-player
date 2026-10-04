import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ArcMeter, summarize, type ArcGeometry } from './arc-meter';

/**
 * Same recording as arc-meter.replay.spec.ts; probes the corner zone the app now
 * sets (a wall behind the breakout, the floor) against the prototype's disk.
 *
 *   ARC_REPLAY=/path/grass_384.rgba npx vitest run src/vision/arc-meter.corner.replay.spec.ts
 */
const FILE = process.env.ARC_REPLAY ?? '';
const W = 384, H = 512;

describe.skipIf(!FILE || !existsSync(FILE))('arc meter replay — corner zone', () => {
  it('measures at least what the disk did, and as much on the arcs\' side of a wall', () => {
    const buf = readFileSync(FILE);
    const frameBytes = W * H * 4;
    const n = Math.floor(buf.length / frameBytes);
    const frame = (i: number): Uint8ClampedArray => new Uint8ClampedArray(buf.buffer, buf.byteOffset + i * frameBytes, frameBytes);
    const s = 384 / 576;
    const breakout = { x: Math.round(293 * s), y: Math.round(405 * s) };
    const excludeBelowY = Math.round(440 * s);
    const run = (zone: Partial<ArcGeometry>): { p90: number; hit: number; edge: number; ms: number } => {
      const meter = new ArcMeter({ width: W, height: H, breakout, excludeBelowY, ...zone });
      const builder = meter.backgroundBuilder(32);
      for (let k = 0; k < 32; k++) builder.add(meter.cropFrom(frame(100 + k)));
      meter.buildBackground(builder);
      const Ls: number[] = [];
      let edges = 0;
      const t0 = Date.now();
      for (let i = 100; i < n; i++) {
        const m = meter.measure(frame(i));
        if (m.moved) continue;
        Ls.push(m.L);
        if (m.edge) edges++;
      }
      const st = summarize(Ls);
      return { p90: st.p90, hit: st.hitRate, edge: edges / Math.max(1, Ls.length), ms: (Date.now() - t0) / Math.max(1, n - 100) };
    };
    const disk = run({ roiRadius: 90 * s });
    const open = run({});
    const right = run({ wall: { x: breakout.x - 14, side: 1 } });
    const left = run({ wall: { x: breakout.x + 14, side: -1 } });
    const fmt = (name: string, r: ReturnType<typeof run>): string => `${name}: p90=${r.p90.toFixed(1)} hit=${r.hit.toFixed(2)} edge=${r.edge.toFixed(2)} ${r.ms.toFixed(1)} ms/frame`;
    console.log([fmt('disk', disk), fmt('no wall', open), fmt('wall, arcs right', right), fmt('wall, arcs left', left)].join('\n'));
    // the open zone holds the disk: an arc the disk kept, it keeps at least as long
    expect(open.p90).toBeGreaterThanOrEqual(disk.p90 * 0.95);
    // on the side the arcs go, the wall costs (almost) nothing
    expect(Math.max(right.p90, left.p90)).toBeGreaterThan(open.p90 * 0.9);
  }, 300_000);
});
