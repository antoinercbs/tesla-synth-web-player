import type { SceneTable } from '../../scene-data';
import { PhyProp } from './prop';

/** A table: a coil whose middle is over its top stands on it, and goes with it. */
export class PhyTable extends PhyProp<SceneTable> {
  readonly kind = 'table';

  get top(): number {
    return this.box.h;
  }

  /** A coil standing on it once it moved or turned to `to`: where it is now and by how much it turned (°); null: it was not on it. */
  carry(to: SceneTable, x: number, z: number): { x: number; z: number; turn: number } | null {
    if (!this.covers(x, z)) return null;
    const [lx, lz] = this.local(x, z), [nx, nz] = new PhyTable(to).world(lx, lz);
    return { x: nx, z: nz, turn: to.rot - this.box.rot };
  }
}
