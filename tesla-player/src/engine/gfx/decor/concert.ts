import * as THREE from 'three';
import { GFX_PALETTE, mixCss } from '../palette';
import { GfxDecor, matte } from './decor';

/** A concert stage: the deck the coils stand on, the pit, a curtain, the truss with its lamps off, monitors. */
export class GfxConcertDecor extends GfxDecor {
  readonly background = GFX_PALETTE.decor.concert.background;
  readonly fog = 0.025;

  constructor() {
    super();
    // the stage's deck is the floor the coils stand on; the pit in front, lower
    const deck = this.add(new THREE.Mesh(new THREE.BoxGeometry(11, 0.6, 6), matte({ color: GFX_PALETTE.decor.concert.deck, roughness: 0.6 })), 0, -0.3, -0.5);
    deck.receiveShadow = false;
    this.floorOf(40, matte({ color: GFX_PALETTE.decor.concert.pit })).position.y = -0.6;
    const folds = this.tex(512, 64, (g, w, h) => {
      for (let x = 0; x < w; x++) {
        const v = 0.5 + 0.5 * Math.sin(x / 9) * Math.sin(x / 23 + 1);
        g.fillStyle = mixCss(GFX_PALETTE.decor.concert.curtainDark, GFX_PALETTE.decor.concert.curtainLight, v);
        g.fillRect(x, 0, 1, h);
      }
    }, [2, 1]);
    this.add(new THREE.Mesh(new THREE.PlaneGeometry(13, 7), matte({ map: folds, roughness: 1 })), 0, 3.2, -3.4);
    // the truss overhead, its lamps off
    const alu = matte({ color: GFX_PALETTE.metal.zinc, metalness: 0.8, roughness: 0.35, envMapIntensity: 0.4 });
    for (const z of [-0.2, 0.2]) for (const y of [4.4, 4.8]) { const t = this.add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 11, 8), alu), 0, y, z - 1.4); t.rotation.z = Math.PI / 2; }
    for (let x = -5.4; x <= 5.4; x += 0.4) { const d = this.add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.57, 6), alu), x, 4.6, -1.4); d.rotation.x = 0.78; }
    for (const x of [-3.6, -1.2, 1.2, 3.6]) { const l = this.add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.35, 16), matte({ color: GFX_PALETTE.decor.concert.lamp, metalness: 0.4 })), x, 4.15, -1.4); l.rotation.x = 0.5; }
    for (const x of [-3.8, 3.8]) { const m = this.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 0.45), matte({ color: GFX_PALETTE.decor.concert.monitor })), x, 0.18, 2.1); m.rotation.x = -0.4; }
  }
}
