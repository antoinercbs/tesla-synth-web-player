export interface ArcStats {
  frames: number;
  /** Fraction of frames with an arc. */
  hitRate: number;
  /** 90th percentile of the per-frame length (the trial's figure of merit). */
  p90: number;
  median: number;
  max: number;
}

/** A trial's statistics, from the length the meter read on each frame. */
export class VisArcStats {
  /** Percentile with linear interpolation over a copy of the values. */
  static percentile(values: ArrayLike<number>, p: number): number {
    const n = values.length;
    if (n === 0) return 0;
    const a = Array.from(values).sort((x, y) => x - y);
    const pos = p * (n - 1);
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return a[lo] + (a[hi] - a[lo]) * (pos - lo);
  }

  /** A trial's figures from its frames' lengths. */
  static of(lengths: ArrayLike<number>): ArcStats {
    const n = lengths.length;
    if (n === 0) return { frames: 0, hitRate: 0, p90: 0, median: 0, max: 0 };
    let hits = 0, max = 0;
    for (let i = 0; i < n; i++) { if (lengths[i] > 0) hits++; if (lengths[i] > max) max = lengths[i]; }
    return { frames: n, hitRate: hits / n, p90: VisArcStats.percentile(lengths, 0.9), median: VisArcStats.percentile(lengths, 0.5), max };
  }
}
