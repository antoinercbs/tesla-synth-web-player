import * as THREE from 'three';
import type { SceneCounter } from '@/model/coils/scene-data';
import { earthCable } from '../coil/cable';
import { GFX_PALETTE } from '../palette';
import { GfxProp } from './prop';

/** A counter-point: its rod (Ø 10, cut in a bevel) clamped on a pole on a floor plate, an earth cable off the plate. */
export class GfxCounter extends GfxProp<SceneCounter> {
  readonly kind = 'counter';

  constructor(c: SceneCounter) {
    super(c);
    const steel = new THREE.MeshStandardMaterial({ color: GFX_PALETTE.metal.steel, metalness: 0.7, roughness: 0.4 }), pr = 0.005, back = -c.w / 2;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(pr, pr, c.w, 10).rotateZ(-Math.PI / 2), steel);
    rod.position.set(0, c.h, 0);
    const bevel = new THREE.Mesh(new THREE.ConeGeometry(pr, pr * 3, 10).rotateZ(-Math.PI / 2), steel);
    bevel.position.set(c.w / 2 + pr * 1.5, c.h, 0);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, c.h, 12), steel);
    pole.position.set(back, c.h / 2, 0);
    const clamp = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 8), steel);
    clamp.position.set(back, c.h, 0);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.015, 24), steel);
    plate.position.set(back, 0.0075, 0);
    this.group.add(rod, bevel, pole, clamp, plate, earthCable([
      new THREE.Vector3(back - 0.1, 0.012, 0), new THREE.Vector3(back - 0.3, 0.008, 0.05), new THREE.Vector3(back - 0.55, 0.008, -0.02),
    ]));
  }
}
