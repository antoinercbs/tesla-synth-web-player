import { PhyGround } from './ground';
import type { Tip, TipGap } from './types';

/** A scene's grounded mesh (cages, knights): as far as the scene says. */
export class PhyMesh extends PhyGround {
  readonly onto = 'cage';

  constructor(private readonly gapOf: TipGap) {
    super();
  }

  gap(t: Tip): number {
    return this.gapOf(t);
  }

  breakout(): null {
    return null;
  }
}
