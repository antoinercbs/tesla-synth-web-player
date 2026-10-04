import { describe, expect, it } from 'vitest';
import { RunSegmenter } from './arc-window';

/** Feeds `pattern` (1 = arc, 0 = none) one frame every 40 ms; returns the runs as frame indices. */
function runs(pattern: string, gapMs = 200): number[][] {
  const seg = new RunSegmenter<number>(gapMs);
  const out: number[][] = [];
  let cur: number[] | null = null;
  [...pattern].forEach((c, i) => {
    const r = seg.push(i, c === '1', i * 40);
    if (r.started) cur = [];
    cur?.push(...r.frames);
    if (r.ended) { out.push(cur!); cur = null; }
  });
  if (cur) out.push(cur);
  return out;
}

describe('RunSegmenter', () => {
  it('ignores silence', () => {
    expect(runs('0000000')).toEqual([]);
  });

  it('spans first arc → last arc, gaps inside included, silent tail dropped', () => {
    expect(runs('00110100000000000')).toEqual([[2, 3, 4, 5]]);
  });

  it('splits on a gap longer than gapMs', () => {
    // 200 ms = 5 frames: 5 silent frames keep the run, 6 end it
    expect(runs('1000001', 200)).toEqual([[0, 1, 2, 3, 4, 5, 6]]);
    expect(runs('10000001', 200)).toEqual([[0], [7]]);
  });

  it('close() ends the run and forgets its tail', () => {
    const seg = new RunSegmenter<number>(1000);
    seg.push(0, true, 0);
    seg.push(1, false, 40);
    seg.close();
    expect(seg.active).toBe(false);
    const r = seg.push(2, true, 80);
    expect(r).toEqual({ started: true, frames: [2], ended: false });
  });
});
