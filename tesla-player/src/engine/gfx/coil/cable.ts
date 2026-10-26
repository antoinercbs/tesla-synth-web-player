import * as THREE from 'three';
import { css, GFX_PALETTE } from '../palette';

/** An earth cable's green and yellow, along a tube (u: its length). */
function earthTexture(length: number): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 32;
  cv.height = 4;
  const cx = cv.getContext('2d');
  if (cx) {
    cx.fillStyle = css(GFX_PALETTE.earth.green);
    cx.fillRect(0, 0, 32, 4);
    cx.fillStyle = css(GFX_PALETTE.earth.yellow);
    cx.fillRect(0, 0, 14, 4);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(Math.max(1, length / 0.035), 1);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** An earth cable along a few points: a thin tube striped green and yellow. */
export function earthCable(points: THREE.Vector3[]): THREE.Mesh {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += points[i].distanceTo(points[i - 1]);
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.Mesh(
    new THREE.TubeGeometry(curve, Math.max(16, points.length * 12), 0.003, 6, false),
    new THREE.MeshStandardMaterial({ map: earthTexture(length), roughness: 0.55 }),
  );
}
