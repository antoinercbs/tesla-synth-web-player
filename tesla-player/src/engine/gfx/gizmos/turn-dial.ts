import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GfxGizmo, type HandleColors } from './gizmo';

/**
 * The turning dial around what is chosen, on the floor (or the table it
 * stands on): a wide ring notched every 15° (longer every 45° and 90°) that
 * the hand takes anywhere to point it there, and a pointer where it faces.
 */
export class GfxTurnDial extends GfxGizmo {
  constructor(colors: HandleColors, cx: number, y: number, cz: number, R: number, facing: number) {
    super(colors);
    const w = Math.max(0.03, R * 0.06), ticks: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 24; k++) {
      const len = k % 6 === 0 ? w * 2.2 : k % 3 === 0 ? w * 1.5 : w * 0.9, th = (k / 24) * Math.PI * 2;
      ticks.push(new THREE.PlaneGeometry(len, Math.max(0.004, w * 0.12)).rotateX(-Math.PI / 2).translate(R + w / 2 + len / 2, 0, 0).rotateY(-th));
    }
    const band = new THREE.Mesh(new THREE.RingGeometry(R - w / 2, R + w / 2, 96), this.material(colors.grip, 0.45));
    band.rotation.x = -Math.PI / 2;
    const notches = new THREE.Mesh(mergeGeometries(ticks)!, this.material(colors.bright));
    for (const t of ticks) t.dispose();
    const pointer = new THREE.Mesh(
      new THREE.PlaneGeometry(R - w, Math.max(0.006, w * 0.25)).rotateX(-Math.PI / 2).translate((R - w) / 2, 0, 0).rotateY(-facing),
      this.material(colors.chosen),
    );
    for (const m of [band, notches, pointer]) {
      m.position.set(cx, y + 0.014, cz);
      this.put(m, { kind: 'aim' });
    }
    const knob = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), this.material(colors.chosen));
    knob.position.set(cx + R * Math.cos(facing), y + 0.02, cz + R * Math.sin(facing));
    this.put(knob, { kind: 'aim' }, 8, 11);
  }
}
