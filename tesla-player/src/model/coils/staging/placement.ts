import type { Around, PhyCoil, CounterPoint, Tip, TipGap } from '../physics';
import type { P3, PhySceneThings } from './things';

/** Where a coil stands in the scene: its place (m), its turn (rad, as the 3D's), hung from the ceiling, else on what (its base's height, m). */
export interface CoilPlace { x: number; z: number; azimuth: number; hang?: boolean; y?: number }

/**
 * A coil placed in a scene: its own frame (its axis, the topload's middle,
 * its front) set in the scene's, and what is grounded around it there, as
 * its physics reads it.
 */
export class PhyCoilPlacement {
  constructor(readonly coil: PhyCoil, readonly place: CoilPlace, readonly ceiling: number) {}

  /**
   * A point of its frame in the scene's: around its axis at az (°, from its
   * front), out r and past its topload's middle y (m, toward its tip: down
   * when hung, its base at the ceiling).
   */
  toScene(p: Tip): P3 {
    const at = this.place, a = at.azimuth + (p.az * Math.PI) / 180, top = this.coil.topHeight;
    return [at.x + p.r * Math.cos(a), at.hang ? this.ceiling - top - p.y : (at.y ?? 0) + top + p.y, at.z + p.r * Math.sin(a)];
  }

  /** The topload's middle, in the scene. */
  get top(): P3 {
    return this.toScene({ r: 0, y: 0, az: 0 });
  }

  /**
   * What is grounded around it besides its own ring: the scene's mesh (cages,
   * knights), the nearest counter-point, and hung or on a table, the floor (a
   * tip's height over it) in place of the mat under it.
   */
  around(things: PhySceneThings): Pick<Around, 'cages' | 'floor' | 'counter'> {
    const at = this.place;
    return { cages: this.meshGap(things), floor: at.hang || at.y ? (t) => this.toScene(t)[1] : null, counter: this.nearestCounter(things) };
  }

  /** From a tip to the nearest mesh (m); the crown's (no angle of its own) from the rim facing it. */
  private meshGap(things: PhySceneThings): TipGap | null {
    const mesh = things.mesh;
    if (!mesh.length) return null;
    const at = this.place;
    return (t) => Math.min(...mesh.map((m) => {
      const az = t.crown ? ((Math.atan2(m.box.z - at.z, m.box.x - at.x) - at.azimuth) * 180) / Math.PI : t.az;
      return m.nearest(this.toScene({ ...t, az })).gap;
    }));
  }

  /** The counter-point nearest its topload, as the physics reads one: in its frame (mm, °). */
  private nearestCounter(things: PhySceneThings): CounterPoint | null {
    const pole = things.nearestCounter(this.top);
    if (!pole) return null;
    const at = this.place, tip = pole.ends.tip, top = this.coil.topHeight, dx = tip[0] - at.x, dz = tip[2] - at.z;
    // along the coil's axis toward its tip: up standing, down hung
    const dy = at.hang ? this.ceiling - top - tip[1] : tip[1] - (at.y ?? 0) - top;
    return { az: ((Math.atan2(dz, dx) - at.azimuth) * 180) / Math.PI, r: Math.hypot(dx, dz) * 1000, dy: dy * 1000, len: pole.box.w * 1000 };
  }
}
