import * as THREE from 'three';
import { disposeTree } from '../dispose';
import type { GfxCoilBody } from './body';

/**
 * A standing coil's local ground mat under its tips, where its strikes land:
 * a welded mesh of 5 cm cells, its wires metal in the palette's line colour,
 * in a frame. Its size is assumed (a stage's mats smaller, to fit side by side).
 */
export class GfxGroundMat {
  readonly group = new THREE.Group();
  /** Its height (m). */
  readonly y = 0.004;
  /** Half its side, its centre (m). */
  readonly half: number;
  readonly x: number;
  readonly z: number;

  /** cell: the shared mesh cell (GfxShared.matCell), cloned for its own repeat. */
  constructor(body: GfxCoilBody, many: boolean, color: string, cell: THREE.Texture) {
    const tips = body.tubes.length ? body.tubes.map((t) => t.tip) : [body.top];
    const cx = tips.reduce((a, t) => a + t.x, 0) / tips.length, cz = tips.reduce((a, t) => a + t.z, 0) / tips.length;
    const spread = Math.max(...tips.map((t) => Math.hypot(t.x - cx, t.z - cz)), body.topR);
    const half = many ? Math.max(0.6, 0.6 * spread + 0.35 + 0.3) : Math.max(0.9, 0.75 * spread + 0.6 + 0.3);
    this.half = half;
    this.x = cx;
    this.z = cz;
    const cells = cell.clone();
    cells.repeat.set((half * 2) / 0.05, (half * 2) / 0.05);
    cells.needsUpdate = true;
    const wire = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color), map: cells, transparent: true, depthWrite: false, metalness: 0.7, roughness: 0.45, side: THREE.DoubleSide,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), wire);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(cx, this.y, cz);
    this.group.add(plane);
    const frameMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), metalness: 0.7, roughness: 0.45 });
    for (const [w, d, x, z] of [[half * 2, 0.008, 0, half], [half * 2, 0.008, 0, -half], [0.008, half * 2, half, 0], [0.008, half * 2, -half, 0]]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.008, d), frameMat);
      bar.position.set(cx + x, 0.006, cz + z);
      this.group.add(bar);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    disposeTree(this.group);
  }
}
