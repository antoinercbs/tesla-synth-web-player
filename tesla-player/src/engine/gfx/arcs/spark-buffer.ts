import * as THREE from 'three';
import { GFX_PALETTE } from '../palette';

/**
 * The sparks of one coil, redrawn many times a second: thin tubes of three
 * sides written straight into one preallocated buffer per look (the streamers'
 * core, halo and glow, a strike's), one draw each, instead of a mesh per spark.
 * Each tube tapers: its radius and its brightness (a vertex colour, times the
 * look's) go from its root to its end.
 */
export class GfxSparkBuffer {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  // a brightness a byte, indices on 16 bits (under 65 536 vertices): what goes to the GPU every image
  private col: Uint8Array;
  private idx: Uint16Array;
  private nv = 0;
  private ni = 0;
  private readonly t = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly b = new THREE.Vector3();

  /** sides: 3 for a thin spark, more for a wide glow whose facets would show. */
  constructor(material: THREE.Material, private readonly sides = 3, private readonly maxVerts = 40000) {
    this.pos = new Float32Array(maxVerts * 3);
    this.col = new Uint8Array(maxVerts * 3);
    this.idx = new Uint16Array(maxVerts * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3, true).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(this.idx, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
  }

  clear(): void {
    this.nv = 0;
    this.ni = 0;
  }

  /** A polyline as a tube: radius r0 and brightness i0 at its start, r1 and i1 at its end. */
  tube(pts: readonly THREE.Vector3[], r0: number, r1 = r0, i0 = 1, i1 = i0): void {
    const SIDES = this.sides;
    if (pts.length < 2 || this.nv + pts.length * SIDES > this.maxVerts) return;
    const first = this.nv, last = pts.length - 1;
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(last, i + 1)];
      this.t.subVectors(p1, p0).normalize();
      // any side of the tangent: the ring's orientation does not show on a thin spark
      this.n.set(0, 1, 0).cross(this.t);
      if (this.n.lengthSq() < 1e-6) this.n.set(1, 0, 0).cross(this.t);
      this.n.normalize();
      this.b.crossVectors(this.t, this.n);
      const f = i / last, r = r0 + (r1 - r0) * f, lit = i0 + (i1 - i0) * f;
      for (let k = 0; k < SIDES; k++) {
        const a = (k / SIDES) * Math.PI * 2, c = Math.cos(a) * r, sn = Math.sin(a) * r;
        const o = this.nv * 3;
        this.pos[o] = pts[i].x + this.n.x * c + this.b.x * sn;
        this.pos[o + 1] = pts[i].y + this.n.y * c + this.b.y * sn;
        this.pos[o + 2] = pts[i].z + this.n.z * c + this.b.z * sn;
        this.col[o] = this.col[o + 1] = this.col[o + 2] = Math.min(255, lit * 255 + 0.5);
        this.nv++;
      }
    }
    for (let i = 0; i < last; i++) {
      for (let k = 0; k < SIDES; k++) {
        const a = first + i * SIDES + k, b = first + i * SIDES + ((k + 1) % SIDES);
        const c = a + SIDES, d = b + SIDES;
        this.idx.set([a, c, b, b, c, d], this.ni);
        this.ni += 6;
      }
    }
  }

  opacity(v: number): void {
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = v;
  }

  tint(a: THREE.Color, b: THREE.Color, t: number): void {
    (this.mesh.material as THREE.MeshBasicMaterial).color.lerpColors(a, b, t);
  }

  flush(): void {
    const g = this.mesh.geometry;
    // only what this image wrote goes to the GPU: the whole buffers, 25 times a second on a stage,
    // took more of the page's time than anything else
    for (const a of [g.attributes.position as THREE.BufferAttribute, g.attributes.color as THREE.BufferAttribute]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.nv * 3);
      a.needsUpdate = true;
    }
    g.index!.clearUpdateRanges();
    g.index!.addUpdateRange(0, this.ni);
    g.index!.needsUpdate = true;
    g.setDrawRange(0, this.ni);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/**
 * The sparks' looks, in their buffers' order: a near white core, a violet
 * halo, a wide faint glow; a strike's whiter and wider. Radius: times the
 * spark's; at least `min` screen pixels, so that a stage seen from afar keeps
 * its sparks.
 */
export const LOOKS = [
  { opacity: 0.9, r: 1, min: 0.6 },
  { opacity: 0.28, r: 2.6, min: 1.8 },
  { opacity: 0.07, r: 7, min: 4.5 },
  { opacity: 1, r: 1, min: 0.9 },
  { opacity: 0.45, r: 2.6, min: 2.6 },
  { opacity: 0.1, r: 5.5, min: 6 },
].map((l, i) => ({ ...l, color: GFX_PALETTE.spark.looks[i] }));
export const STRIKE_LOOK = 3;
/** The streamers' looks, from a weak bang (violet) to a strong one (white): LOOKS' colours in between. */
export const ENERGY_TINTS = GFX_PALETTE.spark.energy.map(([lo, hi]) => [new THREE.Color(lo), new THREE.Color(hi)]);
