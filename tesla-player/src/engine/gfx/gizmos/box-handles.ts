import * as THREE from 'three';
import type { BoxKind, SceneBox } from '@/model/coils/scene-data';
import { GfxGizmo, type Grip, type HandleColors } from './gizmo';

/**
 * A thing on the floor chosen: its outline on the floor (what moves or turns
 * it, with those tools), and what sizes it: a cube on a side (a counter-point's
 * rod length; not a knight), one on its depth (a cage, a table), an arrow over
 * it for its height.
 */
export class GfxBoxHandles extends GfxGizmo {
  constructor(colors: HandleColors, box: SceneBox, kind: BoxKind, outlineGrip: Grip | null) {
    super(colors);
    const a = -(box.rot * Math.PI) / 180;
    const local = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), a).add(new THREE.Vector3(box.x, 0, box.z));
    const w = 0.05, outline = new THREE.Shape();
    outline.moveTo(-box.w / 2 - w, -box.d / 2 - w); outline.lineTo(box.w / 2 + w, -box.d / 2 - w); outline.lineTo(box.w / 2 + w, box.d / 2 + w); outline.lineTo(-box.w / 2 - w, box.d / 2 + w);
    const hole = new THREE.Path();
    hole.moveTo(-box.w / 2, -box.d / 2); hole.lineTo(-box.w / 2, box.d / 2); hole.lineTo(box.w / 2, box.d / 2); hole.lineTo(box.w / 2, -box.d / 2);
    outline.holes.push(hole);
    const foot = new THREE.Mesh(new THREE.ShapeGeometry(outline), this.material(colors.grip));
    foot.rotation.set(-Math.PI / 2, a, 0, 'YXZ');
    foot.position.set(box.x, 0.012, box.z);
    this.put(foot, outlineGrip);
    if (kind !== 'knight') this.knob(local(box.w / 2, kind === 'counter' ? box.h : box.h / 2, 0), colors.size, { kind: 'cageW' }, 7, 'cube');
    if (kind === 'cage' || kind === 'table') this.knob(local(0, box.h / 2, box.d / 2), colors.size, { kind: 'cageD' }, 7, 'cube');
    this.knob(local(kind === 'counter' ? -box.w / 2 : 0, box.h + 0.12, 0), colors.size, { kind: 'cageH' }, 6, 'arrow');
  }
}
