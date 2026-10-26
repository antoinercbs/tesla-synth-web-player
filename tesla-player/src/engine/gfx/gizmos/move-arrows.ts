import * as THREE from 'three';
import { GfxGizmo, type HandleColors } from './gizmo';

/** The way a drag moves along: across the stage, toward the audience; null: anywhere. */
export type MoveAxis = 'x' | 'z' | null;

/**
 * Moving: two arrows on the floor (or the table) through what is chosen,
 * across the stage and toward the audience; each takes it along its way.
 * Moving along one, it is lit, the other faint, and a thin guide runs along
 * it across the stage.
 */
export class GfxMoveArrows extends GfxGizmo {
  constructor(colors: HandleColors, cx: number, y: number, cz: number, R: number, along: MoveAxis) {
    super(colors);
    const w = Math.max(0.012, R * 0.05), head = Math.max(0.05, R * 0.2), hw = Math.max(0.04, R * 0.14), shape = new THREE.Shape();
    shape.moveTo(-R, 0); shape.lineTo(-R + head, hw); shape.lineTo(-R + head, w); shape.lineTo(R - head, w); shape.lineTo(R - head, hw);
    shape.lineTo(R, 0); shape.lineTo(R - head, -hw); shape.lineTo(R - head, -w); shape.lineTo(-R + head, -w); shape.lineTo(-R + head, -hw);
    shape.closePath();
    for (const [kind, turn, axis] of [['moveX', 0, 'x'], ['moveZ', Math.PI / 2, 'z']] as const) {
      const lit = along === axis, m = new THREE.Mesh(new THREE.ShapeGeometry(shape), this.material(lit ? colors.bright : colors.grip, along && !lit ? 0.3 : 0.95));
      m.rotation.set(-Math.PI / 2, turn, 0, 'YXZ');
      m.position.set(cx, y + 0.014, cz);
      this.put(m, { kind });
      if (lit) {
        const guide = new THREE.Mesh(new THREE.PlaneGeometry(14, Math.max(0.006, w * 0.5)), this.material(colors.bright, 0.55));
        guide.rotation.set(-Math.PI / 2, turn, 0, 'YXZ');
        guide.position.set(cx, y + 0.012, cz);
        this.put(guide, null, undefined, 9);
      }
    }
  }

  /** The way a drag goes: the arrow taken; the move grip with Shift, the way it went most. */
  static axisOf(kind: string, dx: number, dz: number, shift: boolean): MoveAxis {
    return kind === 'moveX' ? 'x' : kind === 'moveZ' ? 'z' : kind === 'move' && shift ? (Math.abs(dx) > Math.abs(dz) ? 'x' : 'z') : null;
  }
}
