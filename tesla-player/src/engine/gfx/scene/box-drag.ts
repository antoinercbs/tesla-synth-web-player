import type * as THREE from 'three';
import type { BoxKind, SceneBox } from '@/model/coils/scene-data';
import { PhyTable } from '@/model/coils/staging';
import type { Grip, GripKind } from '../gizmos/gizmo';
import type { StageCoil } from '../types';
import { GfxDrag } from './drag';
import type { GfxEditor } from './editor';

/** What moves at the height it was taken; the rest on the floor. */
const AT_ITS_HEIGHT: readonly GripKind[] = ['move', 'moveX', 'moveZ', 'aim', 'cageW', 'cageD'];
/** How tall each kind may be (m). */
const HEIGHTS: Record<BoxKind, [number, number]> = { table: [0.2, 2], cage: [0.5, 4], counter: [0.2, 3.5], knight: [1.2, 2.2] };

/**
 * A thing on the floor taken by the hand: moved, turned or sized, drawn as it
 * goes; the coils' arcs see it once let go. A table carries the coils
 * standing on it.
 */
export class GfxBoxDrag extends GfxDrag {
  private readonly start: SceneBox;
  private last: SceneBox;
  /** The coils standing on it (a table), as they were. */
  private readonly riders: { k: number; sc: StageCoil }[];

  constructor(editor: GfxEditor, e: PointerEvent, private readonly kind: BoxKind, private readonly i: number, grip: Grip, grabbed: THREE.Vector3) {
    super(editor, e, grip, grabbed, AT_ITS_HEIGHT.includes(grip.kind) ? grabbed.y : 0);
    const view = editor.view;
    this.start = { ...view.props.box(kind, i)! };
    this.last = this.start;
    const table = new PhyTable(this.start);
    this.riders = kind === 'table' ? view.coils.map((c, k) => ({ k, sc: { ...c.sc } })).filter((r) => !r.sc.hang && table.covers(r.sc.x, r.sc.z ?? 0)) : [];
  }

  protected move(ev: PointerEvent): void {
    const start = this.start, grip = this.grip, kind = this.kind, snap = GfxDrag.snap, next = { ...start }, at = this.at(ev);
    if (grip.kind === 'move' || grip.kind === 'moveX' || grip.kind === 'moveZ') Object.assign(next, this.slide(ev, at, start.x, start.z));
    else if (grip.kind === 'turn' || grip.kind === 'aim') {
      const to = grip.kind === 'aim' ? (Math.atan2(at.z - start.z, at.x - start.x) * 180) / Math.PI : start.rot - (ev.clientX - this.x0) * 0.6;
      next.rot = Math.round((((snap(to, ev.shiftKey ? 1 : 15) % 360) + 540) % 360) - 180);
    } else if (grip.kind === 'cageH') {
      const [lo, hi] = HEIGHTS[kind];
      next.h = Math.max(lo, Math.min(hi, snap(start.h - (ev.clientY - this.y0) * this.k, 0.05)));
    } else {
      // a side, out from the middle along its own axis
      const a = (start.rot * Math.PI) / 180, dx = at.x - start.x, dz = at.z - start.z;
      const along = grip.kind === 'cageW' ? dx * Math.cos(a) + dz * Math.sin(a) : -dx * Math.sin(a) + dz * Math.cos(a);
      const size = Math.max(0.1, Math.min(kind === 'counter' ? 1.5 : 6, snap(Math.abs(along) * 2, 0.05)));
      if (grip.kind === 'cageW') next.w = size;
      else next.d = size;
    }
    this.last = next;
    const view = this.editor.view;
    view.props.put(kind, this.i, next);
    this.ride(next, false);
    this.editor.place();
    this.editor.handlers?.changeBox(kind, this.i, next, false);
  }

  protected end(moved: boolean): void {
    if (this.editor.along) {
      this.editor.along = null;
      this.editor.place();
    }
    if (!moved) return;
    this.ride(this.last, true);
    this.editor.handlers?.changeBox(this.kind, this.i, this.last, true);
  }

  /** The coils it carries, where it is now. */
  private ride(to: SceneBox, done: boolean): void {
    const table = new PhyTable(this.start);
    for (const r of this.riders) {
      const c = table.carry(to, r.sc.x, r.sc.z ?? 0);
      if (c) this.editor.view.reshape(r.k, { ...r.sc, x: c.x, z: c.z, azimuth: r.sc.azimuth + (c.turn * Math.PI) / 180 }, done);
    }
  }
}
