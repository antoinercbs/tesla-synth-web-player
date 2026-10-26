import * as THREE from 'three';
import { CEILING } from '@/model/coils/scene-data';
import { disposeTree } from '../dispose';
import { css, GFX_PALETTE } from '../palette';

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat?: [number, number]): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');
  if (g) draw(g, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.anisotropy = 4;
  return t;
}

/** A flat colour with grains: concrete, stone. */
export function grain(g: CanvasRenderingContext2D, w: number, h: number, base: string, amount: number, n: number): void {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    g.fillStyle = css(GFX_PALETTE.decor.speck, Math.random() * amount);
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

/** A surface that does not shine, and takes none of the room's reflection. */
export const matte = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, envMapIntensity: 0, ...o });

/**
 * A place the coils stand in, for the 3D views. Fixed: its textures are
 * drawn once, it brings no light of its own (the hall's and the arcs' light
 * it), so it costs almost nothing a frame. Centred on the stage's origin, x
 * across, z toward the audience.
 */
export abstract class GfxDecor {
  readonly group = new THREE.Group();
  abstract readonly background: number;
  /** The haze's density (FogExp2); 0: none. */
  abstract readonly fog: number;
  /** Where a hung coil's base is (m). */
  readonly ceiling: number = CEILING;
  private readonly textures: THREE.Texture[] = [];

  dispose(): void {
    this.group.removeFromParent();
    disposeTree(this.group);
    for (const t of this.textures) t.dispose();
  }

  /** A texture drawn on a canvas, freed with it. */
  protected tex(...a: Parameters<typeof canvasTexture>): THREE.CanvasTexture {
    const t = canvasTexture(...a);
    this.textures.push(t);
    return t;
  }

  /** A piece of it, there. */
  protected add<T extends THREE.Object3D>(m: T, x = 0, y = 0, z = 0): T {
    m.position.set(x, y, z);
    this.group.add(m);
    return m;
  }

  /** A square floor (or, turned over, a ceiling) of that side. */
  protected floorOf(size: number, material: THREE.Material): THREE.Mesh {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
    f.rotation.x = -Math.PI / 2;
    return this.add(f);
  }
}
