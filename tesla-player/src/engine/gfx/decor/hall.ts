import * as THREE from 'three';
import { css, GFX_PALETTE } from '../palette';
import { GfxDecor } from './decor';

/** No scene: the dark hall, its floor a little glossy where the arcs shine, fading into the dark around the stage. */
export class GfxHallDecor extends GfxDecor {
  readonly background = GFX_PALETTE.decor.hall.background;
  readonly fog = 0.035;

  constructor() {
    super();
    // no scene: the dark hall, its floor a little glossy where the arcs shine, fading into the dark around the stage
    const hall = this.tex(256, 256, (g) => {
      const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      r.addColorStop(0, css(GFX_PALETTE.decor.hall.centre));
      r.addColorStop(0.5, css(GFX_PALETTE.decor.hall.middle));
      r.addColorStop(1, css(GFX_PALETTE.decor.hall.edge));
      g.fillStyle = r;
      g.fillRect(0, 0, 256, 256);
    });
    // no reflection of the room on it: at a grazing angle it would draw a grey horizon
    const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.MeshStandardMaterial({ map: hall, roughness: 0.55, metalness: 0, envMapIntensity: 0 }));
    floor.rotation.x = -Math.PI / 2;
    this.group.add(floor);
  }
}
