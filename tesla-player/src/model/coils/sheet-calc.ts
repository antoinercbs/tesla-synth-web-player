import { PhyResponse } from './response';
import type { CoilSpec } from './spec';
import { ARC_CORNERS, PhyArcLoad, PhyCoil, type ArcCorner, type BangResult } from './physics';

/**
 * What the model makes of a sheet at a note, for the sheet and the page that
 * details its calculations: a bang for each arc corner, the arc against the
 * ontime, where the arcs start, strike and the OCD trips.
 */
export interface CoilCalc {
  /** The pulse the board sends at the note (µs). */
  T: number;
  /** At the note (µs): no arc under it; from it the arcs strike the ground (Infinity: never). */
  arcFrom: number;
  strikeFrom: number;
  /** The middle arc's: past it the OCD trips every bang (null: never). */
  useful: number | null;
  runs: { corner: ArcCorner; o: BangResult }[];
  sweep: { corner: ArcCorner; pts: { on: number; l: number; e: number; struck: boolean }[] }[];
  breakout: { lo: number; hi: number; mid: number };
  strikeLen: number;
}

/** A sheet worked out at a note: ~0.1 s, and its response's (PhyResponse) when it has none yet. */
export class PhySheetCalc {
  static at(s: CoilSpec, f: number): CoilCalc {
    const coil = new PhyCoil(s), m = coil.tank();
    const br = coil.sheetRod.breakout(), sl = coil.strikeLength();
    const T = coil.pulseUs(s.board.ontime, f);
    const runs = ARC_CORNERS.map((corner) => ({ corner, o: m.steady(new PhyArcLoad(corner, br.mid, sl), T * 1e-6, f, true) }));
    const useful = m.usefulOntime(new PhyArcLoad('milieu', br.mid, sl), f, Math.max(200, s.board.ontime));
    const top = s.board.ontime * 1.2, N = 30;
    const sweep = ARC_CORNERS.map((corner) => {
      const a = new PhyArcLoad(corner, br.mid, sl);
      return {
        corner,
        pts: Array.from({ length: N + 1 }, (_, i) => {
          const on = 2 + ((top - 2) * i) / N;
          const o = m.steady(a, coil.pulseUs(on, f) * 1e-6, f);
          return { on, l: o.l, e: o.eArc, struck: o.struck };
        }),
      };
    });
    const r = PhyResponse.of(s);
    return { T, arcFrom: r.arcFrom(f), strikeFrom: r.strikeFrom(f), useful, runs, sweep, breakout: br, strikeLen: sl };
  }
}
