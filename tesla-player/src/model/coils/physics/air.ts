import { AIR_DENSITY } from './constants';

/** Where a discharge starts: the top's voltage at a point's breakout (V), a sharp bevel, a blunted one, between. */
export interface Breakout {
  lo: number;
  hi: number;
  mid: number;
}

/** The air a coil fires in, by its density relative to sea level's. */
export class PhyAir {
  constructor(readonly density = AIR_DENSITY) {}

  /** Peek: the field that starts a discharge on a sphere of radius rho (m), in V/m. */
  peek(rho: number): number {
    return 27.2e5 * this.density * (1 + 0.54 / Math.sqrt(this.density * rho * 100));
  }
}

/** Lyon's air, the model's. */
export const AIR = new PhyAir();
