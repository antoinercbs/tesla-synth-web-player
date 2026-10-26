import type * as THREE from 'three';
import { GfxCoilBody } from '../coil/body';
import type { Grip } from '../gizmos/gizmo';
import type { StageCoil } from '../types';
import { GfxDrag } from './drag';
import type { GfxEditor } from './editor';

const D2R = Math.PI / 180;

/** A coil moved, turned, its tubes or its ring set by hand: drawn as it goes, its field worked out again once let go. */
export class GfxCoilDrag extends GfxDrag {
  private readonly start: StageCoil;
  private last: StageCoil;
  /** Hung, it is upside down: what goes up on the screen goes down along it. */
  private readonly hung: number;

  constructor(editor: GfxEditor, e: PointerEvent, private readonly i: number, grip: Grip, grabbed: THREE.Vector3) {
    super(editor, e, grip, grabbed, GfxCoilDrag.levelOf(editor, i, grip, grabbed));
    const coil = editor.view.coils[i], s0 = coil.sc;
    this.start = { ...s0, tubes: (s0.tubes ?? GfxCoilBody.sheetTubes(s0.spec)).map((t) => ({ ...t })), ring: s0.ring ? { ...s0.ring } : null };
    this.last = this.start;
    this.hung = coil.body.hung ? -1 : 1;
  }

  /** What is taken moves at its own height; its ring's size at the ring's; the rest on the floor. */
  private static levelOf(editor: GfxEditor, i: number, grip: Grip, grabbed: THREE.Vector3): number {
    const k = grip.kind;
    if (k === 'tube' || k === 'move' || k === 'moveX' || k === 'moveZ' || k === 'aim') return grabbed.y;
    return k === 'ringD' ? editor.view.coils[i].body.ring!.center.y : 0;
  }

  protected move(ev: PointerEvent): void {
    const start = this.start, grip = this.grip, snap = GfxDrag.snap, hung = this.hung;
    const next: StageCoil = { ...start, tubes: start.tubes!.map((t) => ({ ...t })), ring: start.ring ? { ...start.ring } : null };
    const dy = ev.clientY - this.y0, tube = grip.tube != null ? next.tubes![grip.tube] : null;
    if (grip.kind === 'tilt' && tube) tube.tilt = Math.max(-30, Math.min(85, Math.round(tube.tilt - dy * 0.4 * hung)));
    else if (grip.kind === 'ringY' && next.ring) next.ring.dy = Math.max(-400, Math.min(500, snap(next.ring.dy - dy * 2 * hung, 5)));
    else if (grip.kind === 'tube' && tube?.center) tube.len = Math.max(50, Math.min(1500, snap(tube.len - dy * 3 * hung, 10)));
    else {
      const at = this.at(ev), cx = start.x, cz = start.z ?? 0, ang = Math.atan2(at.z - cz, at.x - cx), r = Math.hypot(at.x - cx, at.z - cz);
      if (grip.kind === 'move' || grip.kind === 'moveX' || grip.kind === 'moveZ') Object.assign(next, this.slide(ev, at, start.x, cz));
      // the body turns with the hand across the screen, as a turntable's near edge; the dial points where the
      // hand is; both stop at its notches (Shift: to the degree)
      else if (grip.kind === 'turn') next.azimuth = snap(start.azimuth - (ev.clientX - this.x0) * 0.6 * D2R, (ev.shiftKey ? 1 : 15) * D2R);
      else if (grip.kind === 'aim') next.azimuth = snap(ang, (ev.shiftKey ? 1 : 15) * D2R);
      else if (grip.kind === 'tube' && tube) {
        tube.az = ((snap((ang - start.azimuth) / D2R, 5) % 360) + 360) % 360;
        tube.len = Math.max(50, Math.min(1500, snap(((r - (start.spec.top.D / 2000 - 0.02)) / Math.max(0.2, Math.cos(tube.tilt * D2R))) * 1000, 10)));
      } else if (grip.kind === 'ringD' && next.ring) next.ring.D = Math.max(start.spec.top.D + 300, Math.min(5000, snap((r + next.ring.tube / 2000) * 2000, 10)));
    }
    this.last = next;
    this.editor.view.reshape(this.i, next, false);
  }

  protected end(moved: boolean): void {
    this.editor.along = null;
    if (moved) this.editor.view.reshape(this.i, this.last, true);
    else this.editor.place();
  }
}
