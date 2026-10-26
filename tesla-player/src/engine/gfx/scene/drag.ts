import * as THREE from 'three';
import { GfxMoveArrows } from '../gizmos/move-arrows';
import type { Grip } from '../gizmos/gizmo';
import type { GfxEditor } from './editor';

type V3 = THREE.Vector3;

/**
 * Something on the picture taken by the hand, until it lets go. What is taken
 * moves at its own height: the point of it under the hand stays under it.
 * Seen from the side, that level is edge-on, and the drag is read on the
 * screen instead, across the view and away from it. A press that does not
 * move 3 px is a click: nothing changes.
 */
export abstract class GfxDrag {
  /** Where the hand took it, on its level. */
  protected readonly from: V3;
  protected readonly x0: number;
  protected readonly y0: number;
  /** A screen pixel where it was taken (m). */
  protected readonly k: number;
  private readonly plane: THREE.Plane;
  private readonly handleAt: V3;
  private readonly right: V3;
  private readonly away: V3;
  private moved = false;

  /** level: the height it moves at (m). */
  constructor(protected readonly editor: GfxEditor, e: PointerEvent, protected readonly grip: Grip, grabbed: V3, level: number) {
    const orbit = editor.view.orbit;
    this.x0 = e.clientX;
    this.y0 = e.clientY;
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -level);
    this.handleAt = grabbed.clone().setY(level);
    this.k = orbit.pixelAt(grabbed);
    ({ right: this.right, away: this.away } = orbit.floorAxes());
    this.from = this.at(e);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
  }

  /** Rounded to a step, without float crumbs. */
  protected static snap(v: number, step: number): number {
    return Number((Math.round(v / step) * step).toFixed(6));
  }

  /** Where the hand is on its level. */
  protected at(ev: PointerEvent): V3 {
    const rc = this.editor.view.rayAt(ev.clientX, ev.clientY), q = new THREE.Vector3();
    if (rc && Math.abs(rc.ray.direction.y) > 0.2 && rc.ray.intersectPlane(this.plane, q)) return q;
    const slant = Math.max(0.35, Math.abs(Math.sin(this.editor.view.orbit.pitch)));
    return this.handleAt.clone().addScaledVector(this.right, (ev.clientX - this.x0) * this.k).addScaledVector(this.away, (-(ev.clientY - this.y0) * this.k) / slant);
  }

  /** Moved on the floor from (x, z), the hand now at `at`: along an arrow's way; with Shift, the way it went most. Kept on the stage. */
  protected slide(ev: PointerEvent, at: V3, x: number, z: number): { x: number; z: number } {
    const kind = this.grip.kind;
    let dx = kind === 'moveZ' ? 0 : at.x - this.from.x, dz = kind === 'moveX' ? 0 : at.z - this.from.z;
    this.editor.along = GfxMoveArrows.axisOf(kind, dx, dz, ev.shiftKey);
    if (ev.shiftKey) {
      if (Math.abs(dx) > Math.abs(dz)) dz = 0;
      else dx = 0;
    }
    return { x: GfxDrag.snap(Math.max(-6, Math.min(6, x + dx)), 0.05), z: GfxDrag.snap(Math.max(-4, Math.min(4, z + dz)), 0.05) };
  }

  /** The hand moved (3 px at least since it took it). */
  protected abstract move(ev: PointerEvent): void;

  /** The hand let go; moved: it was a drag, not a click. */
  protected abstract end(moved: boolean): void;

  private readonly onMove = (ev: PointerEvent): void => {
    if (!this.moved && Math.hypot(ev.clientX - this.x0, ev.clientY - this.y0) < 3) return;
    this.moved = true;
    this.move(ev);
  };

  private readonly onUp = (): void => {
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.end(this.moved);
  };
}
