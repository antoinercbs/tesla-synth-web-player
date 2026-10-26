import type { SceneCounter } from '../../scene-data';
import { PhyGroundedProp } from './grounded-prop';
import type { Nearest, P3 } from './types';

/** A counter-point: its rod (as long as its box) at its height on a pole at its box's back, its tip toward its x. */
export class PhyCounterPole extends PhyGroundedProp<SceneCounter> {
  readonly kind = 'counter';

  /** Its rod's tip and its back on the pole (the scene's frame). */
  get ends(): { tip: P3; back: P3 } {
    const c = this.box, [tx, tz] = this.world(c.w / 2, 0), [bx, bz] = this.world(-c.w / 2, 0);
    return { tip: [tx, c.h, tz], back: [bx, c.h, bz] };
  }

  /** Its tip: where an arc lands on it. */
  nearest(p: P3): Nearest {
    const at = this.ends.tip, v: P3 = [p[0] - at[0], p[1] - at[1], p[2] - at[2]], gap = Math.hypot(...v);
    return { at, normal: gap > 1e-6 ? [v[0] / gap, v[1] / gap, v[2] / gap] : [0, 1, 0], gap };
  }

  /** Along its rod, six from its back to its tip. */
  samples(): P3[] {
    const { tip, back } = this.ends;
    return Array.from({ length: 6 }, (_, i) => [0, 1, 2].map((k) => back[k] + ((tip[k] - back[k]) * i) / 5) as P3);
  }
}
