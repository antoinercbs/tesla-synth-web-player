import type { PhyCoil } from '../coil';
import { PhyGround } from './ground';
import type { Tip } from './types';

/** The ground mat under a standing coil: as far as the tip is high. */
export class PhyMat extends PhyGround {
  readonly onto = 'mat';

  constructor(private readonly coil: PhyCoil) {
    super();
  }

  gap(t: Tip): number {
    return this.coil.topHeight + t.y;
  }

  breakout(): null {
    return null;
  }
}
