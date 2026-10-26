import * as THREE from 'three';
import { GfxGizmo, type HandleColors } from './gizmo';

/** On the floor around a coil's base, its mark: what is chosen, when no tool moves or turns it. */
export class GfxCoilMark extends GfxGizmo {
  constructor(colors: HandleColors, x: number, y: number, z: number, r: number, w: number) {
    super(colors);
    const foot = new THREE.Mesh(new THREE.RingGeometry(r - w / 2, r + w / 2, 64), this.material(colors.grip));
    foot.rotation.x = -Math.PI / 2;
    foot.position.set(x, y + 0.012, z);
    this.put(foot, null);
  }
}
