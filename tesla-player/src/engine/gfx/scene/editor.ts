import * as THREE from 'three';
import type { BoxKind } from '@/model/coils/scene-data';
import { GfxCoilBody } from '../coil/body';
import { GfxBoxHandles } from '../gizmos/box-handles';
import { GfxCoilMark } from '../gizmos/coil-mark';
import type { GfxGizmo, Grip, HandleColors } from '../gizmos/gizmo';
import { GfxMoveArrows, type MoveAxis } from '../gizmos/move-arrows';
import { GfxRingHandles } from '../gizmos/ring-handles';
import { GfxTubeHandles } from '../gizmos/tube-handles';
import { GfxTurnDial } from '../gizmos/turn-dial';
import type { SceneEditing, SceneTool } from '../types';
import { GfxBoxDrag } from './box-drag';
import { GfxCoilDrag } from './coil-drag';
import type { GfxScene } from './scene';

/**
 * A scene being set in the picture: what is chosen (a coil and its tube, or a
 * thing on the floor), the tool the hand holds, the handles that go with
 * them; a press on a handle or on a thing takes it (GfxCoilDrag, GfxBoxDrag).
 */
export class GfxEditor {
  readonly handles = new THREE.Group();
  /** Who hears the changes; null: the scene is only shown. */
  handlers: SceneEditing | null = null;
  /** The way the hand moves what it holds along, while it does. */
  along: MoveAxis = null;
  private sel: number | null = null;
  private selTube = 0;
  private selBox: { kind: BoxKind; i: number } | null = null;
  private held: SceneTool = 'move';
  private gizmos: GfxGizmo[] = [];

  constructor(readonly view: GfxScene, private readonly colors: HandleColors) {}

  /** Handles on the picture, heard by them; null: none. */
  edit(handlers: SceneEditing | null): void {
    this.handlers = handlers;
    if (!handlers) this.sel = null;
    this.place();
  }

  tool(t: SceneTool): void {
    this.held = t;
    this.place();
  }

  select(i: number | null, tube = 0): void {
    this.sel = i;
    this.selTube = tube;
    if (i != null) this.selBox = null;
    this.place();
  }

  selectBox(kind: BoxKind | null, i = 0): void {
    this.selBox = kind ? { kind, i } : null;
    if (kind) this.sel = null;
    this.place();
  }

  /** A click on nothing: nothing chosen. */
  deselect(): void {
    if (this.sel == null && !this.selBox) return;
    this.sel = null;
    this.selBox = null;
    this.place();
    this.handlers?.pick(null, 0);
  }

  /** The things changed: a chosen one gone is no longer chosen. */
  prune(): void {
    if (this.selBox && this.selBox.i >= this.view.props.count(this.selBox.kind)) this.selBox = null;
  }

  /** The handles for what is chosen and the tool held, drawn again. */
  place(): void {
    for (const g of this.gizmos) g.dispose();
    this.gizmos = [];
    if (!this.handlers) return;
    const { view, colors: c, held: tool } = this;
    const box = this.selBox ? view.props.box(this.selBox.kind, this.selBox.i) : undefined;
    // a thing on the floor: its outline (it moves or turns with those tools), its sizes, the arrows or the dial
    if (box) {
      if (tool === 'view') return;
      const R = Math.hypot(box.w, box.d) / 2 + 0.3;
      this.add(new GfxBoxHandles(c, box, this.selBox!.kind, tool === 'move' ? { kind: 'move' } : tool === 'rotate' ? { kind: 'turn' } : null));
      if (tool === 'rotate') this.add(new GfxTurnDial(c, box.x, 0, box.z, R, (box.rot * Math.PI) / 180));
      if (tool === 'move') this.add(new GfxMoveArrows(c, box.x, 0, box.z, R, this.along));
      return;
    }
    const coil = this.sel != null ? view.coils[this.sel] : null;
    if (!coil) return;
    const b = coil.body, sc = coil.sc;
    // on the floor around its base: moving, the arrows; turning, the dial; else its mark
    const base = (sc.spec.pri.od / 2000) * 0.66, w = Math.max(0.05, base * 0.25), r = base + 0.02 + w / 2, x = sc.x, z = sc.z ?? 0, y0 = b.hung ? 0 : b.baseY;
    if (tool === 'rotate') this.add(new GfxTurnDial(c, x, y0, z, Math.max(r + 0.3, b.topR + 0.2, 0.5), sc.azimuth));
    else if (tool === 'move') this.add(new GfxMoveArrows(c, x, y0, z, Math.max(r + 0.35, 0.5), this.along));
    else this.add(new GfxCoilMark(c, x, y0, z, r, w));
    const tubes = sc.tubes ?? GfxCoilBody.sheetTubes(sc.spec);
    if (tool === 'tubes') this.add(new GfxTubeHandles(c, b, tubes, this.selTube));
    if (tool !== 'view' && b.ring) this.add(new GfxRingHandles(c, b, sc, tubes));
  }

  /** The handles keep their size on the screen. */
  scale(): void {
    this.handles.traverse((h) => {
      if (h.userData.size) h.scale.setScalar(h.userData.size * this.view.orbit.pixelAt(h.position));
    });
  }

  /**
   * A press: on a handle, it takes it; on a coil or a thing, it chooses it,
   * and with the move or turn tool takes it. False: the view turns instead.
   */
  grab(e: PointerEvent): boolean {
    if (!this.handlers) return false;
    const view = this.view, tool = this.held;
    const rc = (this.sel != null || this.selBox) && tool !== 'view' ? view.rayAt(e.clientX, e.clientY) : null;
    const hit = rc ? this.handleUnder(rc) : null;
    if (hit && this.selBox) {
      new GfxBoxDrag(this, e, this.selBox.kind, this.selBox.i, hit.grip, hit.at);
      return true;
    }
    let i: number, grip: Grip, grabbed: THREE.Vector3;
    if (hit) {
      i = this.sel!;
      grip = hit.grip;
      grabbed = hit.at;
    } else {
      // the coil itself, or a thing nearer: chosen; dragged, it moves or turns with those tools; with the view's, the view turns
      const k = view.pickCoil(e.clientX, e.clientY), g = view.pickProp(e.clientX, e.clientY, k ? k.at.distanceTo(view.orbit.camera.position) : Infinity);
      if (g) {
        if (g.kind !== this.selBox?.kind || g.i !== this.selBox.i) {
          this.sel = null;
          this.selBox = { kind: g.kind, i: g.i };
          this.place();
          this.handlers.pickBox(g.kind, g.i);
        }
        if (tool !== 'move' && tool !== 'rotate') return tool !== 'view';
        new GfxBoxDrag(this, e, g.kind, g.i, { kind: tool === 'move' ? 'move' : 'turn' }, g.at);
        return true;
      }
      if (!k) return false;
      if (k.i !== this.sel || this.selBox) {
        this.sel = k.i;
        this.selBox = null;
        this.selTube = 0;
        this.place();
        this.handlers.pick(k.i, 0);
      }
      if (tool !== 'move' && tool !== 'rotate') return tool !== 'view';
      i = k.i;
      grip = { kind: tool === 'move' ? 'move' : 'turn' };
      grabbed = k.at;
    }
    if (grip.tube != null) {
      this.selTube = grip.tube;
      this.handlers.pick(i, this.selTube);
    }
    new GfxCoilDrag(this, e, i, grip, grabbed);
    return true;
  }

  /** The cursor over a point of the page: a handle, the tool held over a thing, else the view's; null: leave it. */
  cursor(e: PointerEvent): string | null {
    if (!this.handlers || e.buttons) return null;
    const view = this.view, tool = this.held, rc = view.rayAt(e.clientX, e.clientY);
    const onHandle = (this.sel != null || !!this.selBox) && tool !== 'view' && !!rc && !!this.handleUnder(rc);
    const onThing = !onHandle && tool !== 'view' && (view.pickCoil(e.clientX, e.clientY) != null || view.pickProp(e.clientX, e.clientY) != null);
    return onHandle ? 'pointer' : onThing ? (tool === 'move' ? 'move' : tool === 'rotate' ? 'ew-resize' : 'pointer') : '';
  }

  dispose(): void {
    for (const g of this.gizmos) g.dispose();
    this.gizmos = [];
    this.handles.removeFromParent();
  }

  private add(g: GfxGizmo): void {
    this.gizmos.push(g);
    this.handles.add(g.group);
  }

  /** The handle under the ray, nearest first: what it does, where it is. */
  private handleUnder(rc: THREE.Raycaster): { grip: Grip; at: THREE.Vector3 } | null {
    const hit = rc.intersectObject(this.handles, true).find((h) => h.object.userData.grip);
    return hit ? { grip: hit.object.userData.grip as Grip, at: hit.object.position.clone() } : null;
  }
}
