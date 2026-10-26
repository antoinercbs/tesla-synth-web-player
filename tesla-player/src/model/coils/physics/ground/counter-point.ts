import { AIR, type PhyAir, type Breakout } from '../air';
import type { PhyCoil } from '../coil';
import { PhyGround } from './ground';
import type { CounterPoint, Tip } from './types';

/** A counter-point near the coil: its tip; the crown's arcs meet it from the rim facing it. */
export class PhyCounterPoint extends PhyGround {
  readonly onto = 'counter';

  constructor(private readonly coil: PhyCoil, readonly point: CounterPoint) {
    super();
  }

  gap(t: Tip): number {
    const c = this.point;
    return PhyGround.apart(t.r, c.r / 1000, t.crown ? 0 : ((t.az - c.az) * Math.PI) / 180, c.dy / 1000 - t.y);
  }

  breakout(air: PhyAir = AIR): Breakout | null {
    return PhyGround.pointBreakout(this.coil, { r: this.point.r / 1000, y: this.point.dy / 1000 }, this.point.len / 1000, air);
  }
}
