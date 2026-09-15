import { describe, expect, it } from 'vitest';
import { decodeBytes, downsampleHeat, encodeBytes, heatColor, mergeHeats } from './heat';

describe('heat', () => {
  it('round-trips bytes through base64', () => {
    const b = new Uint8Array(10000);
    for (let i = 0; i < b.length; i++) b[i] = (i * 37) & 255;
    expect(decodeBytes(encodeBytes(b))).toEqual(b);
  });

  it('downsamples an accumulator to ≤ 64 cells and normalises to the peak', () => {
    const w = 200, h = 130;
    const acc = new Uint32Array(w * h);
    for (let y = 10; y < 20; y++) for (let x = 100; x < 190; x++) acc[y * w + x] = 5; // a horizontal streak
    acc[60 * w + 50] = 50; // one hot pixel (diluted by the cell mean)
    const geom = { x0: 30, y0: 40, breakout: { x: 130, y: 55 }, roiRadius: 60, excludeBelowY: null };
    const hp = downsampleHeat(acc, w, h, geom, 42);
    expect(hp.cell).toBe(4);
    expect(hp.w).toBe(50); expect(hp.h).toBe(33);
    expect(hp.frames).toBe(42);
    const bytes = decodeBytes(hp.data);
    expect(bytes.length).toBe(50 * 33);
    expect(Math.max(...bytes)).toBe(255);
    // the streak cells peak; the lone hot pixel is averaged over its 16-px cell
    expect(bytes[(12 >> 2) * 50 + (150 >> 2)]).toBe(255);
    expect(bytes[(60 >> 2) * 50 + (50 >> 2)]).toBeLessThan(255);
    expect(hp.max).toBeCloseTo(5, 5);
  });

  it('merges heats of the same geometry in mean-count units', () => {
    const w = 8, h = 4;
    const geom = { x0: 0, y0: 0, breakout: { x: 4, y: 2 }, roiRadius: 3, excludeBelowY: null };
    const a = new Uint32Array(w * h); a[5] = 10;
    const b = new Uint32Array(w * h); b[5] = 10; b[6] = 30;
    const ha = downsampleHeat(a, w, h, geom, 10, 8), hb = downsampleHeat(b, w, h, geom, 20, 8);
    const m = mergeHeats([ha, hb])!;
    expect(m.frames).toBe(30);
    const bytes = decodeBytes(m.data);
    expect(bytes[6]).toBe(255); // 30
    expect(bytes[5]).toBe(Math.round((255 * 20) / 30)); // 10 + 10
    expect(mergeHeats([])).toBeNull();
  });

  it('colour ramp is monotonic in brightness and transparent at zero', () => {
    expect(heatColor(0)[3]).toBe(0);
    let last = 0;
    for (let v = 0.05; v <= 1; v += 0.05) {
      const [r, g, b] = heatColor(v);
      const lum = 0.3 * r + 0.59 * g + 0.11 * b;
      expect(lum).toBeGreaterThanOrEqual(last - 1);
      last = lum;
    }
  });
});
