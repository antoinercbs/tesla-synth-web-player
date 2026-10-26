import * as THREE from 'three';
import type { BoxKind, SceneBox } from '@/model/coils/scene-data';
import { disposeTree } from '../dispose';

/** A thing on the floor, drawn in its box: built in its own frame (its width along x), placed and turned as the box says. */
export abstract class GfxProp<B extends SceneBox = SceneBox> {
  readonly group = new THREE.Group();
  abstract readonly kind: BoxKind;

  constructor(readonly box: B) {
    this.group.position.set(box.x, 0, box.z);
    this.group.rotation.y = -(box.rot * Math.PI) / 180;
  }

  /** Where a ray meets its box (the scene's frame); null: it misses it. */
  hit(ray: THREE.Ray): THREE.Vector3 | null {
    const c = this.box, m = new THREE.Matrix4().makeRotationY(-(c.rot * Math.PI) / 180).setPosition(c.x, 0, c.z);
    const local = ray.clone().applyMatrix4(m.clone().invert());
    const at = local.intersectBox(new THREE.Box3(new THREE.Vector3(-c.w / 2, 0, -c.d / 2), new THREE.Vector3(c.w / 2, c.h, c.d / 2)), new THREE.Vector3());
    return at ? at.applyMatrix4(m) : null;
  }

  /** Its pose at a moment (s): only what moves has one. */
  animate?(t: number): void;

  dispose(): void {
    this.group.removeFromParent();
    disposeTree(this.group);
  }
}
