import type { SceneKnight } from '../../scene-data';
import { PhyGroundedProp } from './grounded-prop';
import type { Nearest, P3 } from './types';

/** A Faraday knight: grounded mail around their axis, from the shins to the helmet's point, a body's half-width out. */
export class PhyFaradayKnight extends PhyGroundedProp<SceneKnight> {
  readonly kind = 'knight';

  /** Their axis's ends and the mail's radius (m). */
  get axis(): { lo: number; hi: number; r: number } {
    const s = this.box.h / 1.8;
    return { lo: 0.35 * s, hi: this.box.h - 0.04 * s, r: 0.2 * s };
  }

  nearest(p: P3): Nearest {
    const k = this.box, { lo, hi, r } = this.axis, y = Math.max(lo, Math.min(hi, p[1]));
    const v: P3 = [p[0] - k.x, p[1] - y, p[2] - k.z], d = Math.hypot(...v);
    const n: P3 = d > 1e-6 ? [v[0] / d, v[1] / d, v[2] / d] : [0, 1, 0];
    return { at: [k.x + n[0] * r, y + n[1] * r, k.z + n[2] * r], normal: n, gap: Math.max(0, d - r) };
  }

  /** Along their axis, five from the shins up. */
  samples(): P3[] {
    const k = this.box, s = k.h / 1.8;
    return Array.from({ length: 5 }, (_, i) => [k.x, (0.35 + (i / 4) * 1.4) * s, k.z] as P3);
  }
}
