import * as THREE from 'three';
import { LOOKS } from './arcs/spark-buffer';
import { css, GFX_PALETTE } from './palette';

/** A canvas drawn once, as a texture. */
function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  if (g) draw(g);
  return new THREE.CanvasTexture(cv);
}

/**
 * What a scene's coils and things share, made once: the sparks' looks (a
 * material per coil, cloned from these), a strike's hot core and its spot,
 * the cells of the wire meshes (cloned per mat or panel, for its own repeat).
 */
export class GfxShared {
  /** A strike's hot core. */
  readonly hit = GfxShared.glow(GFX_PALETTE.spark.core, 1);
  readonly looks = LOOKS.map((l) => GfxShared.glow(l.color, l.opacity, true));
  /** A strike's spot on the mat: a light spread on its surface, white at the heart, violet at the edge. */
  readonly spotTex = canvasTexture(128, (g) => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [at, c, a] of GFX_PALETTE.spark.spot) r.addColorStop(at, css(c, a));
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  });
  readonly spot = new THREE.MeshBasicMaterial({ map: this.spotTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  /** A ground mat's cell: its wires along two edges, the rest open. */
  readonly matCell = GfxShared.repeating(canvasTexture(64, (g) => {
    g.fillStyle = css(GFX_PALETTE.mask);
    g.fillRect(0, 0, 64, 5);
    g.fillRect(0, 0, 5, 64);
  }));
  /** A cage's cell: a welded mesh of 4 cm on a frame of square tube. */
  readonly cageCell = GfxShared.repeating(canvasTexture(32, (g) => {
    g.strokeStyle = css(GFX_PALETTE.wire);
    g.lineWidth = 2;
    g.strokeRect(1, 1, 30, 30);
  }));

  /** The arcs' reach around a tip: a dashed circle filling its sprite. */
  readonly reachTex = canvasTexture(256, (g) => {
    g.strokeStyle = css(0xffffff);
    g.lineWidth = 3;
    g.setLineDash([10, 9]);
    g.beginPath();
    g.arc(128, 128, 124, 0, Math.PI * 2);
    g.stroke();
  });

  static glow(color: number, opacity: number, vertexColors = false): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, vertexColors });
  }

  private static repeating(t: THREE.CanvasTexture): THREE.CanvasTexture {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  constructor() {
    this.matCell.anisotropy = 4;
    this.cageCell.colorSpace = THREE.SRGBColorSpace;
  }

  /** A tip's glow or corona: the spot's light on a sprite (one each: each flickers on its own). */
  tip(color: number, opacity: number): THREE.SpriteMaterial {
    return new THREE.SpriteMaterial({ map: this.spotTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  }

  /** One of these: freed with the scene, not with what uses it. */
  owns(m: THREE.Material): boolean {
    return m === this.hit || m === this.spot || this.looks.includes(m as THREE.MeshBasicMaterial);
  }

  dispose(): void {
    for (const m of [this.hit, this.spot, ...this.looks]) m.dispose();
    for (const t of [this.spotTex, this.matCell, this.cageCell, this.reachTex]) t.dispose();
  }
}
