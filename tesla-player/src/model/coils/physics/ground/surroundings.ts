import { AIR, type PhyAir } from '../air';
import type { PhyCoil } from '../coil';
import { PhyCounterPoint } from './counter-point';
import { PhyFloor } from './floor';
import type { PhyGround } from './ground';
import { PhyMat } from './mat';
import { PhyMesh } from './mesh';
import { PhyRing } from './ring';
import type { Around, StrikeTarget, Tip } from './types';

/**
 * Everything grounded around a coil's top: the mat (or the floor), its ring,
 * the counter-point, the scene's mesh. A tip's arc strikes the nearest; on a
 * tie, the first of them in that order.
 */
export class PhySurroundings {
  readonly grounds: readonly PhyGround[];

  /** az0: where the ring's first point is (the first rim point's angle). */
  constructor(coil: PhyCoil, around: Around = {}, az0 = 0) {
    this.grounds = [
      around.floor ? new PhyFloor(around.floor) : new PhyMat(coil),
      ...(around.ring ? [new PhyRing(coil, around.ring, az0)] : []),
      ...(around.counter ? [new PhyCounterPoint(coil, around.counter)] : []),
      ...(around.cages ? [new PhyMesh(around.cages)] : []),
    ];
  }

  /** What a tip's arc strikes, and how far. */
  strike(t: Tip): StrikeTarget {
    let best: StrikeTarget = { onto: this.grounds[0].onto, gap: this.grounds[0].gap(t) };
    for (const g of this.grounds.slice(1)) {
      const gap = g.gap(t);
      if (gap < best.gap) best = { onto: g.onto, gap };
    }
    return best;
  }

  /** Where a grounded point of that kind breaks out toward the top (V); Infinity: none does. */
  pointBreakout(onto: StrikeTarget['onto'], air: PhyAir = AIR): number {
    return this.grounds.find((g) => g.onto === onto)?.breakout(air)?.mid ?? Infinity;
  }
}
