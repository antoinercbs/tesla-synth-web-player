import { PhyCounterPole } from './counter-pole';
import { PhyFaradayCage } from './faraday-cage';
import { PhyFaradayKnight } from './faraday-knight';
import type { PhyGroundedProp } from './grounded-prop';
import { PhyTable } from './table';
import type { Nearest, P3, ThingsData } from './types';

/** A scene's things on the floor, as objects. */
export class PhySceneThings {
  readonly tables: readonly PhyTable[];
  readonly cages: readonly PhyFaradayCage[];
  readonly counters: readonly PhyCounterPole[];
  readonly knights: readonly PhyFaradayKnight[];

  constructor(data: ThingsData = {}) {
    this.tables = (data.tables ?? []).map((b) => new PhyTable(b));
    this.cages = (data.cages ?? []).map((b) => new PhyFaradayCage(b));
    this.counters = (data.counters ?? []).map((b) => new PhyCounterPole(b));
    this.knights = (data.knights ?? []).map((b) => new PhyFaradayKnight(b));
  }

  /** The grounded mesh: the cages, the knights. */
  get mesh(): readonly PhyGroundedProp[] {
    return [...this.cages, ...this.knights];
  }

  /** The top a standing coil's middle is over (m; the floor: 0). */
  topUnder(x: number, z: number): number {
    return this.tables.reduce((top, t) => (t.covers(x, z) ? Math.max(top, t.top) : top), 0);
  }

  /** The nearest mesh to a point; null: none. */
  nearestMesh(p: P3): Nearest | null {
    const all = this.mesh.map((m) => m.nearest(p));
    return all.length ? all.reduce((a, b) => (b.gap < a.gap ? b : a)) : null;
  }

  /** The counter-point whose tip is nearest a point; null: none. */
  nearestCounter(p: P3): PhyCounterPole | null {
    let best: PhyCounterPole | null = null, bestD = Infinity;
    for (const c of this.counters) {
      const d = c.nearest(p).gap;
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }
}
