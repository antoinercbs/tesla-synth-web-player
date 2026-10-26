import type { CoilSpec } from '@/model/coils/spec';
import { AIR, type PhyAir, type Breakout } from './air';
import { BEVEL_POINT, EPS0, TAU } from './constants';

/**
 * An outlet point as the model sees it: a thin rod at the top's potential,
 * its length and radius (m), its tilt above the horizontal (°), the radius
 * range of its bevel's point (m).
 */
export class PhyRod {
  constructor(readonly h: number, readonly a: number, readonly tilt: number, readonly rho: readonly [number, number] = BEVEL_POINT) {}

  /** The sheet's own (its default point). */
  static ofSheet(spec: CoilSpec): PhyRod {
    return new PhyRod(spec.pin.h / 1000, spec.pin.d / 2000, spec.pin.tilt);
  }

  /** A thin wire's capacitance, half screened by the topload (F). */
  get capacitance(): number {
    return (0.7 * TAU * EPS0 * this.h) / Math.log((2 * this.h) / this.a);
  }

  /**
   * The breakout at its tip: the field at a thin conductor's end ≈ V / (ρ·ln(2h/a)),
   * ρ the radius of the bevel's point; a sharp bevel … one blunted by the arcs.
   */
  breakout(air: PhyAir = AIR): Breakout {
    const at = (rho: number) => air.peek(rho) * rho * Math.log((2 * this.h) / this.a);
    const lo = at(this.rho[0]), hi = at(this.rho[1]);
    return { lo, hi, mid: (lo + hi) / 2 };
  }
}
