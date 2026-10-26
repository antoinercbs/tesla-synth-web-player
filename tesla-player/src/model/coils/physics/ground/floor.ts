import { PhyGround } from './ground';
import type { Tip, TipGap } from './types';

/** The floor far under a hung coil or one on a table: as the scene says. */
export class PhyFloor extends PhyGround {
  readonly onto = 'mat';

  constructor(private readonly heightOf: TipGap) {
    super();
  }

  gap(t: Tip): number {
    return this.heightOf(t);
  }

  breakout(): null {
    return null;
  }
}
