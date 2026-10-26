import * as THREE from 'three';
import { css, GFX_PALETTE } from '../palette';
import { GfxDecor, grain, matte } from './decor';

/** A coiler's lab: concrete floor, block walls, a warning sign, a bench in the shade. */
export class GfxLabDecor extends GfxDecor {
  readonly background = GFX_PALETTE.decor.lab.background;
  readonly fog = 0.03;

  constructor() {
    super();
    this.floorOf(16, matte({ map: this.tex(256, 256, (g, w, h) => grain(g, w, h, css(GFX_PALETTE.decor.lab.floor), 0.06, 2500), [7, 7]), roughness: 0.95 }));
    const blocks = this.tex(256, 128, (g, w, h) => {
      g.fillStyle = css(GFX_PALETTE.decor.lab.blocks);
      g.fillRect(0, 0, w, h);
      g.strokeStyle = css(GFX_PALETTE.decor.lab.mortar);
      g.lineWidth = 3;
      for (let y = 0; y <= h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      for (let y = 0; y < h; y += 32) for (let x = (y / 32) % 2 ? 32 : 0; x <= w; x += 64) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke(); }
    }, [4, 2]);
    this.add(new THREE.Mesh(new THREE.PlaneGeometry(16, 4.5), matte({ map: blocks })), 0, 2.25, -5);
    const side = this.add(new THREE.Mesh(new THREE.PlaneGeometry(16, 4.5), matte({ map: blocks })), -7, 2.25, 0);
    side.rotation.y = Math.PI / 2;
    // the warning sign on the back wall (the cages and fences are the scene's own accessories)
    const sign = this.tex(128, 128, (g) => {
      g.fillStyle = css(GFX_PALETTE.decor.lab.sign);
      g.beginPath(); g.moveTo(64, 10); g.lineTo(120, 112); g.lineTo(8, 112); g.closePath(); g.fill();
      g.strokeStyle = css(GFX_PALETTE.decor.lab.signInk); g.lineWidth = 7; g.stroke();
      g.fillStyle = css(GFX_PALETTE.decor.lab.signInk);
      g.beginPath(); g.moveTo(70, 38); g.lineTo(50, 74); g.lineTo(64, 74); g.lineTo(56, 100); g.lineTo(80, 62); g.lineTo(66, 62); g.closePath(); g.fill();
    });
    this.add(new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ map: sign, transparent: true })), 0, 1.6, -4.98);
    // the bench in the shade
    this.add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 0.8), matte({ color: GFX_PALETTE.wood })), -5, 0.45, -4.3);
    this.add(new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.3, 0.35), matte({ color: GFX_PALETTE.decor.lab.crate })), -5.3, 1.05, -4.3);
  }
}
