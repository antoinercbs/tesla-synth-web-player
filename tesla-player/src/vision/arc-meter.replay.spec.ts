import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ArcMeter, summarize } from './arc-meter';

/**
 * Replay of a real recording through the TypeScript meter, to check the port
 * against the Python prototype. Opt-in: set ARC_REPLAY to a raw RGBA file
 * (ffmpeg -pix_fmt rgba, 384 px wide, 10 fps) of the club's "prairie" video.
 *
 *   ARC_REPLAY=/path/grass_384.rgba npx vitest run src/vision/arc-meter.replay.spec.ts
 *
 * Prototype reference on that video (out5, full-res px, fixed camera):
 * hit-rate 0.92, L p50 35.3, p90 38.9 → in work px (×384/576): p50 23.5, p90 25.9.
 */
const FILE = process.env.ARC_REPLAY ?? '';
const W = 384, H = 512;

describe.skipIf(!FILE || !existsSync(FILE))('arc meter replay (prairie video)', () => {
  it('reproduces the prototype statistics within tolerance', () => {
    const buf = readFileSync(FILE);
    const frameBytes = W * H * 4;
    const n = Math.floor(buf.length / frameBytes);
    expect(n).toBeGreaterThan(50);
    const frame = (i: number): Uint8ClampedArray =>
      new Uint8ClampedArray(buf.buffer, buf.byteOffset + i * frameBytes, frameBytes);

    const s = 384 / 576;
    const meter = new ArcMeter({
      width: W, height: H,
      breakout: { x: Math.round(293 * s), y: Math.round(405 * s) },
      roiRadius: 90 * s,
      excludeBelowY: Math.round(440 * s),
    });
    // no coil-off segment in the video: the background comes from a 3 s segment where the
    // camera is still (its first second pans) — the product captures coil-off frames the same way
    const builder = meter.backgroundBuilder(32);
    for (let k = 0; k < 32; k++) builder.add(meter.cropFrom(frame(100 + k)));
    const bg = meter.buildBackground(builder);
    console.log(`crop ${meter.crop.w}x${meter.crop.h} of ${W}x${H}`);
    expect(bg.sigmaMedian).toBeGreaterThan(0);
    expect(bg.sigmaMedian).toBeLessThan(10);

    const Ls: number[] = [];
    let unstable = 0, moved = 0, strayTotal = 0, lastMoved = -1;
    const shifts: string[] = [];
    const t0 = Date.now();
    for (let i = 0; i < n; i++) {
      const m = meter.measure(frame(i));
      if (i % 10 === 0) shifts.push(`${i}:(${m.shift.dx},${m.shift.dy})`);
      if (!m.stable) unstable++;
      if (m.moved) { moved++; lastMoved = i; continue; } // the product discards frames where the phone moved
      Ls.push(m.L);
      strayTotal += m.stray;
    }
    const msPerFrame = (Date.now() - t0) / n;
    const st = summarize(Ls);
    console.log('shifts every 10 frames:', shifts.join(' '), `| last moved frame: ${lastMoved}`);
    console.log(`replay: ${n} frames, ${msPerFrame.toFixed(1)} ms/frame (node), unstable=${unstable}, moved=${moved}, hit=${st.hitRate.toFixed(2)}, p50=${st.median.toFixed(1)}, p90=${st.p90.toFixed(1)}, max=${st.max.toFixed(1)}, stray/frame=${(strayTotal / Math.max(1, Ls.length)).toFixed(1)}`);

    expect(unstable).toBeLessThan(n * 0.05);
    // the recording pans slowly during its first ~8 s (shift −27 → 0), then holds still:
    // every "moved" frame must belong to that opening pan
    expect(lastMoved).toBeLessThan(95);
    expect(moved).toBeGreaterThan(50);
    expect(st.hitRate).toBeGreaterThan(0.8);
    expect(st.p90).toBeGreaterThan(25.9 * 0.8);
    expect(st.p90).toBeLessThan(25.9 * 1.2);
    expect(strayTotal / Math.max(1, Ls.length)).toBeLessThan(10);
    expect(msPerFrame).toBeLessThan(60);
  });
});
