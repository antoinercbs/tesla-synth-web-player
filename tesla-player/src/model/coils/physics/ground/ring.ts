import { AIR, type PhyAir, type Breakout } from '../air';
import type { PhyCoil } from '../coil';
import { PhyGround } from './ground';
import type { AxialPoint, GroundRing, Tip } from './types';

/** A ring's shape about its coil: its tube's centre line and radius (m); each point's root on the tube and its tip, aimed at the topload's rim. */
export class PhyRingShape {
  readonly R: number;
  readonly y: number;
  readonly a: number;
  readonly points: { n: number; root: AxialPoint; tip: AxialPoint } | null;

  constructor(coil: PhyCoil, ring: GroundRing) {
    this.a = ring.tube / 2000;
    this.R = ring.D / 2000 - this.a;
    this.y = ring.dy / 1000;
    const p = ring.points;
    if (!p || p.n < 1 || p.len <= 0) {
      this.points = null;
      return;
    }
    // aimed from the tube's centre line at the rim (Ampère's: 8.8° for 100 mm past the joint plane)
    const ur = coil.spec.top.D / 2000 - this.R, uy = -this.y, ul = Math.hypot(ur, uy) || 1;
    const root = { r: this.R + (this.a * ur) / ul, y: this.y + (this.a * uy) / ul };
    this.points = { n: Math.round(p.n), root, tip: { r: root.r + (p.len / 1000) * (ur / ul), y: root.y + (p.len / 1000) * (uy / ul) } };
  }
}

/** A grounded ring: its tube, or the nearest of its points (the first in line with az0). */
export class PhyRing extends PhyGround {
  readonly onto = 'ring';
  readonly shape: PhyRingShape;

  constructor(private readonly coil: PhyCoil, readonly ring: GroundRing, private readonly az0 = 0) {
    super();
    this.shape = new PhyRingShape(coil, ring);
  }

  gap(t: Tip): number {
    const g = this.shape;
    let gap = Math.hypot(g.R - t.r, g.y - t.y) - g.a;
    if (g.points) {
      const step = (2 * Math.PI) / g.points.n, off = ((((t.az - this.az0) * Math.PI) / 180) % step + step) % step;
      gap = Math.min(gap, PhyGround.apart(t.r, g.points.tip.r, Math.min(off, step - off), g.points.tip.y - t.y));
    }
    return gap;
  }

  /** Its points break out toward the topload: lower than the crown's own, they start the gap for it. */
  breakout(air: PhyAir = AIR): Breakout | null {
    const p = this.shape.points;
    return p && this.ring.points ? PhyGround.pointBreakout(this.coil, p.tip, this.ring.points.len / 1000, air) : null;
  }
}
