import * as THREE from 'three';
import type { SceneTable } from '@/model/coils/scene-data';
import { GFX_PALETTE } from '../palette';
import { GfxProp } from './prop';

/** A workshop table: a thick top on four square legs, a stretcher low between them. */
export class GfxTable extends GfxProp<SceneTable> {
  readonly kind = 'table';

  constructor(t: SceneTable) {
    super(t);
    const top = new THREE.MeshStandardMaterial({ color: GFX_PALETTE.wood, roughness: 0.8 });
    const legs = new THREE.MeshStandardMaterial({ color: GFX_PALETTE.metal.blackSteel, roughness: 0.6, metalness: 0.3 });
    const th = Math.min(0.04, t.h * 0.2), leg = Math.min(0.05, t.w * 0.1, t.d * 0.1), inset = leg;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(t.w, th, t.d), top);
    slab.position.y = t.h - th / 2;
    this.group.add(slab);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(leg, t.h - th, leg), legs);
      m.position.set(sx * (t.w / 2 - inset), (t.h - th) / 2, sz * (t.d / 2 - inset));
      this.group.add(m);
    }
    for (const sz of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(t.w - 2 * inset, leg * 0.6, leg * 0.6), legs);
      m.position.set(0, Math.min(0.15, t.h * 0.2), sz * (t.d / 2 - inset));
      this.group.add(m);
    }
  }
}
