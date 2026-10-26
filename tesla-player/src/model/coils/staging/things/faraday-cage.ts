import type { SceneCage } from '../../scene-data';
import { PhyGroundedProp } from './grounded-prop';
import type { Nearest, P3 } from './types';

/** A Faraday cage: grounded mesh on four walls and a roof (the floor is the stage's own ground). */
export class PhyFaradayCage extends PhyGroundedProp<SceneCage> {
  readonly kind = 'cage';

  nearest(p: P3): Nearest {
    const c = this.box, hw = c.w / 2, hd = c.d / 2, [lx, lz] = this.local(p[0], p[2]), y = p[1];
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    let qx = clamp(lx, -hw, hw), qy = clamp(y, 0, c.h), qz = clamp(lz, -hd, hd);
    if (Math.abs(lx) <= hw && Math.abs(lz) <= hd && y <= c.h) {
      // inside: the nearest wall, or the roof
      const toX = hw - Math.abs(lx), toZ = hd - Math.abs(lz), toY = c.h - y;
      if (toY <= toX && toY <= toZ) qy = c.h;
      else if (toX <= toZ) qx = Math.sign(lx || 1) * hw;
      else qz = Math.sign(lz || 1) * hd;
    }
    const [ax, az] = this.world(qx, qz), at: P3 = [ax, qy, az];
    const v: P3 = [p[0] - at[0], p[1] - at[1], p[2] - at[2]], gap = Math.hypot(...v);
    return { at, normal: gap > 1e-6 ? [v[0] / gap, v[1] / gap, v[2] / gap] : [0, 1, 0], gap };
  }

  /** Its walls at three heights, three across each; its roof, three by three. */
  samples(): P3[] {
    const c = this.box, out: P3[] = [], put = (lx: number, y: number, lz: number) => { const [x, z] = this.world(lx, lz); out.push([x, y, z]); };
    for (const u of [-0.5, 0, 0.5]) for (const v of [0.2, 0.5, 0.85]) {
      put(u * c.w, v * c.h, c.d / 2); put(u * c.w, v * c.h, -c.d / 2); put(c.w / 2, v * c.h, u * c.d); put(-c.w / 2, v * c.h, u * c.d);
    }
    for (const u of [-0.4, 0, 0.4]) for (const v of [-0.4, 0, 0.4]) put(u * c.w, c.h, v * c.d);
    return out;
  }
}
