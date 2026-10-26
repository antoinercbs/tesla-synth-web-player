import type { Trial } from '@/model/tuning/trial';

export interface Suggestion {
  tapTurns: number;
  /** 'coarse' grid point, 'fine' neighbour of the best, 'optimum' parabola vertex, 'done' nothing left. */
  kind: 'coarse' | 'fine' | 'optimum' | 'done';
}

const EPS = 1e-6;

/**
 * Where to put the tap next. Advisory only: the operator moves the tap by hand
 * and may ignore it. Strategy: a coarse pass on a half-turn grid over the range,
 * then a fine pass at the tap step around the best point, then a parabola on
 * the best three to name an optimum. Arc length vs tap position has a single
 * maximum in the useful range, so this converges in about ten trials.
 */
export class TunTapSearch {
  constructor(readonly trials: Trial[], readonly min: number, readonly max: number, readonly step: number) {}

  /** A tap position on the step's grid, inside the range. */
  static snap(turns: number, step: number, min: number, max: number): number {
    const s = Math.round((turns - min) / step) * step + min;
    return Math.min(max, Math.max(min, Math.round(s * 1e6) / 1e6));
  }

  /** The best trial (highest score), or null. */
  static best(trials: Trial[]): Trial | null {
    let best: Trial | null = null;
    for (const t of trials) if (!best || t.score > best.score) best = t;
    return best;
  }

  /** Where to put the tap next. */
  next(): Suggestion {
    const { trials, min, max, step } = this;
    if (!(max > min) || !(step > 0)) return { tapTurns: min, kind: 'done' };
    const tested = new Map<number, number>(); // tap → best score seen there
    for (const t of trials) {
      const k = TunTapSearch.snap(t.tapTurns, step, min, max);
      tested.set(k, Math.max(tested.get(k) ?? -Infinity, t.score));
    }
    const isTested = (x: number): boolean => tested.has(TunTapSearch.snap(x, step, min, max));

    // 1. coarse grid: ends, middle, then quarter points (half-turn granularity when the range allows)
    const coarseStep = Math.max(step, (max - min) >= 2 ? 0.5 : step);
    const coarse: number[] = [];
    const mid = TunTapSearch.snap((min + max) / 2, coarseStep, min, max);
    for (const x of [min, max, mid]) if (!coarse.includes(x)) coarse.push(x);
    for (let x = min; x <= max + EPS; x += coarseStep) {
      const v = TunTapSearch.snap(x, step, min, max);
      if (!coarse.includes(v)) coarse.push(v);
    }
    // spread the order so early trials bracket the maximum quickly
    const ordered = [...coarse.slice(0, 3), ...TunTapSearch.bisectOrder(coarse.slice(3))];
    for (const x of ordered) if (!isTested(x)) return { tapTurns: x, kind: 'coarse' };

    // 2. fine: neighbours of the best at the tap step
    const entries = [...tested.entries()].sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) return { tapTurns: min, kind: 'coarse' };
    const [bestTap] = entries[0];
    for (const d of [step, -step, 2 * step, -2 * step]) {
      const x = bestTap + d;
      if (x < min - EPS || x > max + EPS) continue;
      if (!isTested(x)) return { tapTurns: TunTapSearch.snap(x, step, min, max), kind: 'fine' };
    }

    // 3. parabola through the best three distinct taps
    const top = entries.slice(0, 3);
    if (top.length === 3) {
      const [[x1, y1], [x2, y2], [x3, y3]] = top;
      const denom = (x1 - x2) * (x1 - x3) * (x2 - x3);
      if (Math.abs(denom) > EPS) {
        const a = (x3 * (y2 - y1) + x2 * (y1 - y3) + x1 * (y3 - y2)) / denom;
        const b = (x3 * x3 * (y1 - y2) + x2 * x2 * (y3 - y1) + x1 * x1 * (y2 - y3)) / denom;
        if (a < 0) {
          const vx = TunTapSearch.snap(-b / (2 * a), step, min, max);
          if (!isTested(vx)) return { tapTurns: vx, kind: 'optimum' };
        }
      }
    }
    return { tapTurns: bestTap, kind: 'done' };
  }

  /** Reorders grid points so successive picks split the largest untested interval. */
  private static bisectOrder(points: number[]): number[] {
    const out: number[] = [];
    const pool = [...points];
    const picked: number[] = [];
    while (pool.length) {
      let bestIdx = 0, bestGap = -1;
      for (let i = 0; i < pool.length; i++) {
        const gap = picked.length ? Math.min(...picked.map((p) => Math.abs(p - pool[i]))) : Infinity;
        if (gap > bestGap) { bestGap = gap; bestIdx = i; }
      }
      const v = pool.splice(bestIdx, 1)[0];
      picked.push(v); out.push(v);
    }
    return out;
  }
}
