import type { BoxKind, SceneBox } from '../../scene-data';

/** A thing on the floor in its box (as stored: its centre, turn, width along its x, depth, height). */
export abstract class PhyProp<B extends SceneBox = SceneBox> {
  abstract readonly kind: BoxKind;

  constructor(readonly box: B) {}

  protected get turn(): number {
    return (this.box.rot * Math.PI) / 180;
  }

  /** A point of the floor in its frame, its x along its width. */
  local(x: number, z: number): [number, number] {
    const a = this.turn, dx = x - this.box.x, dz = z - this.box.z;
    return [dx * Math.cos(a) + dz * Math.sin(a), -dx * Math.sin(a) + dz * Math.cos(a)];
  }

  /** A point of its frame on the floor of the scene. */
  world(lx: number, lz: number): [number, number] {
    const a = this.turn;
    return [this.box.x + lx * Math.cos(a) - lz * Math.sin(a), this.box.z + lx * Math.sin(a) + lz * Math.cos(a)];
  }

  /** Over its footprint. */
  covers(x: number, z: number): boolean {
    const [lx, lz] = this.local(x, z);
    return Math.abs(lx) <= this.box.w / 2 && Math.abs(lz) <= this.box.d / 2;
  }
}
