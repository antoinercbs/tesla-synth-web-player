import * as THREE from 'three';
import { GFX_PALETTE } from '../palette';
import type { GfxShared } from '../shared';

/**
 * How far a coil's arcs reach, drawn around its tip: a dashed circle that
 * faces the camera (a sprite), its radius the reach. The coil sheet shows it
 * beside its ontime ruler; a stage has no use for it.
 */
export class GfxReachRing {
  readonly sprite: THREE.Sprite;

  constructor(shared: GfxShared) {
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: shared.reachTex, color: GFX_PALETTE.reach, transparent: true, opacity: 0.35, depthWrite: false,
    }));
    this.sprite.visible = false;
  }

  place(tip: THREE.Vector3, reach: number, shown: boolean): void {
    this.sprite.visible = shown && reach > 0;
    if (!this.sprite.visible) return;
    this.sprite.position.copy(tip);
    this.sprite.scale.setScalar(reach * 2);
  }

  dispose(): void {
    this.sprite.removeFromParent();
    this.sprite.material.dispose();
  }
}
