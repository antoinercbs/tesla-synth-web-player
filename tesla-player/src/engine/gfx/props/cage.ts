import * as THREE from 'three';
import type { SceneCage } from '@/model/coils/scene-data';
import { GFX_PALETTE } from '../palette';
import { GfxProp } from './prop';

/** A Faraday cage: a welded mesh on four walls and a roof, on a frame of square tube, the floor left open. */
export class GfxCage extends GfxProp<SceneCage> {
  readonly kind = 'cage';

  /** cell: the shared mesh cell (GfxShared.cageCell), cloned per panel for its own repeat. */
  constructor(c: SceneCage, cell: THREE.Texture) {
    super(c);
    const steel = new THREE.MeshStandardMaterial({ color: GFX_PALETTE.metal.steel, metalness: 0.7, roughness: 0.4 }), e = 0.025;
    const panel = (w: number, h: number, at: THREE.Vector3, ry: number, rx = 0) => {
      const map = cell.clone();
      map.repeat.set(w / 0.04, h / 0.04);
      map.needsUpdate = true;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({
        color: GFX_PALETTE.wire, map, transparent: true, alphaTest: 0.35, depthWrite: false, metalness: 0.7, roughness: 0.45, side: THREE.DoubleSide,
      }));
      m.position.copy(at);
      m.rotation.set(rx, ry, 0, 'YXZ');
      this.group.add(m);
    };
    panel(c.w, c.h, new THREE.Vector3(0, c.h / 2, c.d / 2), 0);
    panel(c.w, c.h, new THREE.Vector3(0, c.h / 2, -c.d / 2), 0);
    panel(c.d, c.h, new THREE.Vector3(c.w / 2, c.h / 2, 0), Math.PI / 2);
    panel(c.d, c.h, new THREE.Vector3(-c.w / 2, c.h / 2, 0), Math.PI / 2);
    panel(c.w, c.d, new THREE.Vector3(0, c.h, 0), 0, -Math.PI / 2);
    // its frame's edges
    const edge = (len: number, at: THREE.Vector3, axis: 'x' | 'y' | 'z') => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(axis === 'x' ? len : e, axis === 'y' ? len : e, axis === 'z' ? len : e), steel);
      m.position.copy(at);
      this.group.add(m);
    };
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) edge(c.h, new THREE.Vector3((sx * c.w) / 2, c.h / 2, (sz * c.d) / 2), 'y');
    for (const y of [e / 2, c.h]) for (const sz of [-1, 1]) edge(c.w, new THREE.Vector3(0, y, (sz * c.d) / 2), 'x');
    for (const y of [e / 2, c.h]) for (const sx of [-1, 1]) edge(c.d, new THREE.Vector3((sx * c.w) / 2, y, 0), 'z');
  }
}
