import * as THREE from 'three';
import { GFX_PALETTE } from '../palette';
import { GfxDecor, matte } from './decor';

/** A cyclorama studio: the floor curving up into the back wall, no horizon. */
export class GfxCycloDecor extends GfxDecor {
  readonly background = GFX_PALETTE.decor.cyclo.background;
  readonly fog = 0;

  constructor() {
    super();
    // the colours along it, mixed in the linear space the vertex colours are in
    const foot = new THREE.Color(GFX_PALETTE.decor.cyclo.foot), top = new THREE.Color(GFX_PALETTE.decor.cyclo.top);
    // the floor curving up into the back wall: no horizon, nothing to place the eye but the coils
    const W = 18, R = 2.6, segs = 24, prof: [number, number][] = [[8, 0]];
    for (let i = 0; i <= segs; i++) { const a = (i / segs) * (Math.PI / 2); prof.push([-2.6 - R * Math.sin(a), R - R * Math.cos(a)]); }
    prof.push([-2.6 - R, 9]);
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    prof.forEach(([z, y], j) => {
      for (const x of [-W / 2, W / 2]) {
        pos.push(x, y, z);
        const c = foot.clone().lerp(top, Math.min(1, y / 6));
        col.push(c.r, c.g, c.b);
      }
      if (j) { const a = (j - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.group.add(new THREE.Mesh(geo, matte({ vertexColors: true, side: THREE.DoubleSide })));
  }
}
