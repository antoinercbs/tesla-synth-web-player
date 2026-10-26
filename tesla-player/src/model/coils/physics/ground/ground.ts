import type { PhyAir, Breakout } from '../air';
import { BEVEL_POINT, EPS0, GROUNDED_POINT_A, TAU } from '../constants';
import type { PhyCoil } from '../coil';
import type { AxialPoint, StrikeTarget, Tip } from './types';

/** Something grounded near a coil's top: how far a tip is from it, and, a point of it, where it breaks out toward the top. */
export abstract class PhyGround {
  abstract readonly onto: StrikeTarget['onto'];

  abstract gap(t: Tip): number;

  /** Where it breaks out toward the top, a grounded point; null: it has none. */
  abstract breakout(air?: PhyAir): Breakout | null;

  /** Between two points at radii r1, r2 around the axis, an angle δ apart (rad), dy apart along it: the law of cosines. */
  protected static apart(r1: number, r2: number, d: number, dy: number): number {
    return Math.sqrt(Math.max(0, r1 * r1 + r2 * r2 - 2 * r1 * r2 * Math.cos(d) + dy * dy));
  }

  /**
   * A grounded point breaks out toward the topload as a lightning rod does: at
   * its tip, the topload's potential there (a sphere of the same capacitance:
   * V·R/d, R = C/4πε₀) over a thin rod's end (ρ·ln(2h/a), Ø 10, a bevel's point).
   */
  protected static pointBreakout(coil: PhyCoil, tip: AxialPoint, len: number, air: PhyAir): Breakout {
    const R = coil.topCapacitance / (2 * TAU * EPS0), d = Math.hypot(tip.r, tip.y);
    const at = (rho: number) => air.peek(rho) * rho * Math.log((2 * len) / GROUNDED_POINT_A) * (d / R);
    const lo = at(BEVEL_POINT[0]), hi = at(BEVEL_POINT[1]);
    return { lo, hi, mid: (lo + hi) / 2 };
  }
}
