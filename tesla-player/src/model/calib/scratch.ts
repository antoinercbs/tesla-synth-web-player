import { BIN_MS } from './types';

/** Scratch buffers over a song's bins, reused across a request's many demand curves. */
export class CalScratch {
  readonly bins: number;
  readonly diff: Float64Array;
  readonly vals: Float64Array;

  constructor(durationMs: number) {
    this.bins = Math.ceil(durationMs / BIN_MS) + 2;
    this.diff = new Float64Array(this.bins + 1);
    this.vals = new Float64Array(this.bins);
  }

  /** The q-quantile of the first `count` values (quickselect, reorders them). */
  quantile(count: number, q: number): number {
    const vals = this.vals;
    if (!count) return 0;
    const target = Math.min(count - 1, Math.floor(q * count));
    let lo = 0, hi = count - 1;
    while (lo < hi) {
      const pivot = vals[(lo + hi) >> 1];
      let i = lo, j = hi;
      while (i <= j) {
        while (vals[i] < pivot) i++;
        while (vals[j] > pivot) j--;
        if (i <= j) { const t = vals[i]; vals[i] = vals[j]; vals[j] = t; i++; j--; }
      }
      if (target <= j) hi = j;
      else if (target >= i) lo = i;
      else return vals[target];
    }
    return vals[target];
  }
}
