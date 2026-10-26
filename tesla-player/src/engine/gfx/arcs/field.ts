import * as THREE from 'three';
import type { PhyGroundedProp } from '@/model/coils/staging';
import { gauss, inCone, refine, turn, type Rnd } from './strokes';

/**
 * The shape of a coil's sparks, grown in the field of its top: Matsuyama,
 * Fujimoto & Chiba's real-time method (The Visual Computer 22, 2006), the
 * field worked out once, then a leader that walks on it, each step's direction
 * drawn among a few with a weight (E·d)^η as in the dielectric breakdown model
 * (Niemeyer, Pietronero & Wiesmann, PRL 52, 1984), without solving Laplace at
 * every step.
 *
 * The field: the topload as a ring of charges, each outlet tube as a line of
 * them, and their images under the ground mat (held at 0 V), read from a grid
 * worked out once per coil; the arcs leave each tube's tip, or the topload's
 * rim when it has none (the crown); the channel growing adds its own, summed at each
 * step (one point in eight and every live tip), at the potential it has left.
 * η = 3: the fractal dimension of long laboratory sparks (≈ 1.7 projected,
 * Sañudo et al. 1995); branches at 43° ± 12°, measured on streamers in air
 * (Nijdam et al., APL 92, 2008); a tip whose field falls far under the
 * strongest one's stops (the screening). The detail at a few centimetres:
 * each step broken by midpoint displacement.
 *
 * A strike lands as one does on a grounded plane: a few centimetres above it
 * the channel jumps straight down, splits into a few feet that touch it side
 * by side, and short streamers rise from the plane around the spot. Or on a
 * grounded ring's point: the channel jumps the last centimetres to it, and
 * the point answers with a brush of its own (a counter-point's the same, a
 * cage's mesh where it is hit). The
 * ring is in the field: its charge, along it and on its points, keeps it at
 * 0 V; a counter-point's along its rod.
 *
 * Kept from one bang to the next: the last main channel attracts the next
 * one as long as the air has not come back (an assumption, 5 ms: coilers see
 * the paths change at every bang under ~60 a second), as Kim & Lin do for the
 * leaders that take a channel again (Pacific Graphics 2004).
 *
 * In metres, y up. The points it gives may be the geometry's own vectors (a
 * tube's tip, a ring's point): read them, never change them.
 */

type V3 = THREE.Vector3;

/** Where a coil's arcs leave: a tube's tip, its axis (unit, pointing out), its base on the topload, its length. */
export interface ArcSource { tip: V3; axis: V3; base: V3; len: number }

/** Where these arcs leave: a tube's tip or a point of the crown, and their way out. */
export interface ArcFrom { tip: V3; axis: V3 }

/** What a coil's field is made of, in the scene's frame. */
export interface ArcGeometry {
  /** Its outlet tubes; none: the arcs leave the crown. */
  tubes: readonly ArcSource[];
  /** The topload: its centre, its ring's radius and its outer radius (m), its axis (unit, from the base through it: down for a hung coil). */
  top: V3;
  ringR: number;
  topR: number;
  up: V3;
  /** The ground mat's height (m). */
  matY: number;
  /** A grounded ring around the coil: its centre, its tube's centre line and radius (m), its points' tips. */
  ring?: { center: V3; R: number; a: number; tips: readonly V3[] } | null;
  /** A grounded counter-point: its rod from its back on the pole to its tip. */
  counter?: { tip: V3; back: V3 } | null;
  /** The scene's grounded mesh: its Faraday cages, its knights' mail. */
  mesh?: readonly PhyGroundedProp[];
}

export interface Spark {
  pts: V3[];
  /** 1 the main streamer, less its branches. */
  width: number;
  strike: boolean;
}

export interface GrowOptions {
  /** How far the sparks go (m). */
  reach: number;
  /** 'strike': the main streamer lands on the ground (the simulation says so); 'air': none reaches it. */
  strike: 'air' | 'strike';
  /** Where a strike lands: on the mat, or on a ring's point (or its tube). */
  target?: V3;
  onto?: 'mat' | 'point';
  /** Where these arcs leave; none: the first tube, else the crown at random. */
  from?: ArcFrom;
  /** The last bang's main channel and how much of it the air still holds (0..1). */
  memory?: V3[] | null;
  keep?: number;
}

/** One bang's sparks, its main channel (for the next one), where a strike landed. */
export interface Grown { sparks: Spark[]; main: V3[]; landing: V3 | null }

const D2R = Math.PI / 180;
const GROW = {
  eta: 3,
  /** Directions tried per tip and step, in a cone of this half angle around its own. */
  tries: 5, half: 35 * D2R,
  /** Steps over the reach, how much of its direction a tip keeps at each. */
  steps: 40, keep: 0.6,
  /** Streamers from the tip, the fork chance per step, at 43° ± 12°. */
  seeds: 3, fork: 0.045, branch: 43 * D2R, branchSd: 12 * D2R, maxBranches: 14,
  /** A tip under this share of the strongest one's field stops. */
  screen: 0.12,
  /** The channel's charge, and the potential left at the end of the arc (share of the top's). */
  chanQ: 0.008, v0: 0.3,
  /** The last channel's pull, per unit it is still held; a strike's landing point's, a share of the electrodes' charge. */
  memoryQ: 0.032, strikePull: 1.2,
  /** How much a strike's main streamer turns toward its landing point at each step, more as it comes down. */
  strikeSteer: 0.35,
  /** A strike's last jump, straight down: this share of the reach above the mat, within those bounds (m); its feet, at most. */
  jump: 0.07, jumpMin: 0.05, jumpMax: 0.16, feet: 3,
};
/** How long the air keeps a channel's path for the next bang (s): an assumption, see above. */
const PATH_MEMORY_S = 5e-3;
const CONE = 0.96, CONE_EL = -0.35;

/** A point charge: where, how much. */
type Charge = [number, number, number, number];

/** The field of point charges and of their images under the mat (Coulomb, softened at 1 cm), added to `out`; matY null: no images. */
function chargesField(p: V3, charges: readonly Charge[], matY: number | null, out: V3): V3 {
  for (const c of charges) {
    for (let m = 0; m < (matY == null ? 1 : 2); m++) {
      const cy = m ? 2 * matY! - c[1] : c[1], q = m ? -c[3] : c[3];
      const dx = p.x - c[0], dy = p.y - cy, dz = p.z - c[2];
      const r2 = dx * dx + dy * dy + dz * dz + 1e-4, k = q / (r2 * Math.sqrt(r2));
      out.x += k * dx; out.y += k * dy; out.z += k * dz;
    }
  }
  return out;
}

/** The streamers' cone from a source: its axis's azimuth, ~20° under the horizontal; an upright tube's own axis. */
function coneOf(axis: V3): V3 {
  const flat = new THREE.Vector3(axis.x, 0, axis.z);
  if (flat.length() < 0.25) return axis.clone().normalize();
  flat.normalize();
  return new THREE.Vector3(flat.x * Math.cos(CONE_EL), Math.sin(CONE_EL), flat.z * Math.cos(CONE_EL)).normalize();
}

interface Branch { pts: V3[]; d: V3; s: number; live: boolean; gen: number; reach: number }

/** A coil's field, on a grid around its top as far as its arcs go: worked out when the coil is placed; its bangs grow in it. */
export class GfxArcField {
  /** The electrodes' charge (the ring's left out): the scale of the channel's and of a strike's pull. */
  readonly charge: number;
  /** Two unit vectors square to the topload's axis: its plane. */
  private readonly plane: [V3, V3];
  private readonly x0: number;
  private readonly y0: number;
  private readonly z0: number;
  private readonly h: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly nz: number;
  private readonly e: Float32Array;

  /** How high above the mat a strike's channel makes its last jump, for a reach (m). */
  static jumpHeight(reach: number): number {
    return Math.min(GROW.jumpMax, Math.max(GROW.jumpMin, GROW.jump * reach));
  }

  /** How much of the last bang's path the next one finds, at a bang rate (bangs a second). */
  static pathHeld(bangHz: number): number {
    return bangHz > 0 ? Math.exp(-1 / (bangHz * PATH_MEMORY_S)) : 0;
  }

  constructor(readonly geo: ArcGeometry, reach: number) {
    const up = geo.up, e1 = new THREE.Vector3().crossVectors(Math.abs(up.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0), up).normalize();
    this.plane = [e1, new THREE.Vector3().crossVectors(up, e1)];
    const [, e2] = this.plane, charges: Charge[] = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * 2 * Math.PI, p = geo.top.clone().addScaledVector(e1, geo.ringR * Math.cos(a)).addScaledVector(e2, geo.ringR * Math.sin(a));
      charges.push([p.x, p.y, p.z, 1]);
    }
    for (const t of geo.tubes) {
      for (let i = 1; i <= 6; i++) {
        const p = t.base.clone().addScaledVector(t.axis, (t.len * i) / 6);
        charges.push([p.x, p.y, p.z, 0.35]);
      }
    }
    const pot = (p: V3, cs: readonly Charge[]) => cs.reduce((s, c) => s + c[3] / Math.max(0.01, Math.hypot(p.x - c[0], p.y - c[1], p.z - c[2]))
      - c[3] / Math.max(0.01, Math.hypot(p.x - c[0], p.y - (2 * geo.matY - c[1]), p.z - c[2])), 0);
    // a grounded ring: its charge, along it and on its points, of the size that holds it at 0 V where
    // it faces the coil
    if (geo.ring) {
      const { center, R, a, tips } = geo.ring;
      const ring: Charge[] = Array.from({ length: 36 }, (_, i) => {
        const t = (i / 36) * 2 * Math.PI;
        return [center.x + R * Math.cos(t), center.y, center.z + R * Math.sin(t), 1];
      });
      for (const p of tips) ring.push([p.x, p.y, p.z, 1]);
      const t = Math.PI / 36, probe = new THREE.Vector3(center.x + (R - a) * Math.cos(t), center.y, center.z + (R - a) * Math.sin(t));
      const q = -pot(probe, charges) / pot(probe, ring);
      for (const c of ring) charges.push([c[0], c[1], c[2], q]);
    }
    // a counter-point too: along its rod, held at 0 V at its tip
    if (geo.counter) {
      const { tip, back } = geo.counter;
      const rod: Charge[] = Array.from({ length: 6 }, (_, i) => { const p = back.clone().lerp(tip, i / 5); return [p.x, p.y, p.z, 1]; });
      const q = -pot(tip, charges) / pot(tip.clone().addScaledVector(tip.clone().sub(back).normalize(), 0.02), rod);
      for (const c of rod) charges.push([c[0], c[1], c[2], q]);
    }
    // each piece of mesh (a cage's walls and roof, a knight's mail): a few charges on it, held at 0 V where it is nearest the topload
    for (const m of geo.mesh ?? []) {
      const pts: Charge[] = m.samples().map((q) => [q[0], q[1], q[2], 1]);
      const probe = new THREE.Vector3(...m.nearest([geo.top.x, geo.top.y, geo.top.z]).at);
      const q = -pot(probe, charges) / pot(probe, pts);
      for (const c of pts) charges.push([c[0], c[1], c[2], q]);
    }
    // potential 1 where the arcs leave
    const k = 1 / pot(geo.tubes[0]?.tip ?? this.crown(0).tip, charges);
    for (const c of charges) c[3] *= k;
    this.charge = charges.reduce((t, c) => t + Math.max(0, c[3]), 0);

    // around the top, as far as the farthest tip and its arcs
    const far = geo.tubes.reduce((m, t) => Math.max(m, t.tip.distanceTo(geo.top)), geo.topR);
    const span = Math.max(0.6, far + reach * 1.35), h = Math.max(0.04, span / 18);
    const x0 = geo.top.x - span, z0 = geo.top.z - span, y0 = geo.matY;
    const nx = Math.ceil((2 * span) / h) + 1, nz = nx, ny = Math.ceil((geo.top.y - y0 + span) / h) + 1;
    const e = new Float32Array(nx * ny * nz * 3), p = new THREE.Vector3(), v = new THREE.Vector3();
    for (let kz = 0; kz < nz; kz++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      chargesField(p.set(x0 + i * h, y0 + j * h, z0 + kz * h), charges, geo.matY, v.set(0, 0, 0));
      const o = ((kz * ny + j) * nx + i) * 3;
      e[o] = v.x; e[o + 1] = v.y; e[o + 2] = v.z;
    }
    this.x0 = x0;
    this.y0 = y0;
    this.z0 = z0;
    this.h = h;
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.e = e;
  }

  /** A point of the crown (the topload's rim) at an angle, and the way its arcs leave: out, a little past the top. */
  crown(a: number): ArcFrom {
    const [e1, e2] = this.plane, out = e1.clone().multiplyScalar(Math.cos(a)).addScaledVector(e2, Math.sin(a));
    return { tip: this.geo.top.clone().addScaledVector(out, this.geo.topR), axis: out.clone().addScaledVector(this.geo.up, 0.15).normalize() };
  }

  /**
   * One bang's sparks. The main streamer goes as far as the reach; a strike's
   * is pulled to its landing point and ends on the mat or on the point; in the
   * air, a tip that comes down to the mat dies there.
   */
  grow(o: GrowOptions, rnd: Rnd = Math.random): Grown {
    const { matY, ring, counter, mesh } = this.geo, L = Math.max(0.02, o.reach), ds = L / GROW.steps;
    const src = o.from ?? this.geo.tubes[0] ?? this.crown(rnd() * 2 * Math.PI), tip = src.tip, axis = src.axis, cone = coneOf(axis);
    const target = o.target, striking = o.strike === 'strike' && !!target, toPoint = striking && o.onto === 'point';
    const branches: Branch[] = Array.from({ length: GROW.seeds }, (_, i) => ({
      pts: [tip],
      d: i === 0 ? (striking ? target!.clone().sub(tip).normalize() : axis.clone().addScaledVector(inCone(cone, CONE * 0.6, rnd), 1.2).normalize()) : inCone(cone, CONE, rnd),
      s: 0, live: true, gen: i === 0 ? 0 : 1, reach: i === 0 ? (striking ? 3 : 1) : 0.3 + 0.45 * rnd(),
    }));
    // the last channel pulls the next one; never near the tip, where the field would turn back
    const held = o.memory && (o.keep ?? 0) > 0.02 ? o.memory : null;
    const chan: Charge[] = held ? held.filter((q, i) => i % 3 === 0 && q.distanceTo(tip) > 0.08).map((q) => [q.x, q.y, q.z, -GROW.memoryQ * (o.keep ?? 0)]) : [];
    // a strike's landing point pulls its main streamer to it
    const pull: Charge[] = striking ? [[target!.x, target!.y + (toPoint ? 0 : 0.02), target!.z, -GROW.strikePull * this.charge]] : [];
    const far = striking ? target!.distanceTo(tip) : 1;
    const potLeft = (s: number) => GROW.chanQ * Math.max(0, 1 - (1 - GROW.v0) * (s / L));
    let strike: Branch | null = null, landing: V3 | null = null;
    const jumpH = GfxArcField.jumpHeight(L), e = new THREE.Vector3(), q = new THREE.Vector3();
    for (let step = 0; step < GROW.steps * 3 && !strike; step++) {
      const live = branches.filter((b) => b.live);
      if (!live.length) break;
      const charges = chan.concat(live.map((b) => { const p = b.pts[b.pts.length - 1]; return [p.x, p.y, p.z, potLeft(b.s)] as Charge; }));
      // each tip: a few directions around its own, weighed (E·d)^η
      const tries = live.map((b) => {
        const p = b.pts[b.pts.length - 1], dirs: V3[] = [], ws: number[] = [];
        let total = 0, best = 0;
        for (let k = 0; k < GROW.tries; k++) {
          const d = k === 0 ? b.d : turn(b.d, GROW.half * Math.sqrt(rnd()), rnd);
          q.copy(p).addScaledVector(d, ds * 0.5);
          this.sample(q, e.set(0, 0, 0));
          chargesField(q, charges, matY, e);
          // the landing point's pull without its image: at the mat's level, an image would cancel it
          if (b.gen === 0 && pull.length) chargesField(q, pull, null, e);
          const g = Math.max(0, e.dot(d)), w = g ** GROW.eta;
          dirs.push(d); ws.push(w); total += w; if (g > best) best = g;
        }
        return { b, p, dirs, ws, total, best };
      });
      const strongest = Math.max(...tries.map((t) => t.best));
      for (const t of tries) {
        const b = t.b;
        if (!(t.total > 0) || (t.best < GROW.screen * strongest && !(striking && b.gen === 0))) { b.live = false; continue; }
        let r = rnd() * t.total, d = t.dirs[t.dirs.length - 1];
        for (let k = 0; k < t.ws.length; k++) { r -= t.ws[k]; if (r <= 0) { d = t.dirs[k]; break; } }
        const p = t.p.clone().addScaledVector(d, ds * (0.7 + 0.6 * rnd()));
        b.d = b.d.clone().multiplyScalar(GROW.keep).addScaledVector(d, 1 - GROW.keep).normalize();
        // a strike's main streamer heads for its landing point, the more the nearer it gets
        if (striking && b.gen === 0) {
          const near = 1 - Math.max(0, Math.min(1, toPoint ? target!.distanceTo(p) / far : (p.y - matY) / (tip.y - matY)));
          b.d.addScaledVector(q.subVectors(target!, p).normalize(), GROW.strikeSteer * (0.3 + near)).normalize();
        }
        b.s += ds;
        // a strike near the mat: the last jump, straight down with a jolt or two; near the point, onto it
        if (striking && b.gen === 0 && (toPoint ? target!.distanceTo(p) <= jumpH : p.y <= matY + jumpH)) {
          const at = toPoint ? target! : new THREE.Vector3(p.x + (rnd() - 0.5) * 0.4 * jumpH, matY, p.z + (rnd() - 0.5) * 0.4 * jumpH);
          b.pts.push(p);
          for (let j = 1; j < 3; j++) {
            const f = j / 3;
            b.pts.push(new THREE.Vector3(p.x + (at.x - p.x) * f + (rnd() - 0.5) * 0.25 * jumpH, p.y + (at.y - p.y) * f, p.z + (at.z - p.z) * f + (rnd() - 0.5) * 0.25 * jumpH));
          }
          b.pts.push(at);
          landing = at;
          strike = b;
          break;
        }
        if (p.y <= matY + 0.015) {
          b.live = false;
          continue;
        }
        // one that reaches the grounded ring, or the counter-point's tip, or the mesh, ends on it
        if ((ring && (Math.hypot(Math.hypot(p.x - ring.center.x, p.z - ring.center.z) - ring.R, p.y - ring.center.y) < ring.a + 0.01
          || ring.tips.some((x) => x.distanceTo(p) < 0.02))) || (counter && counter.tip.distanceTo(p) < 0.03)
          || mesh?.some((m) => m.nearest([p.x, p.y, p.z]).gap < 0.02)) {
          b.pts.push(p);
          b.live = false;
          continue;
        }
        b.pts.push(p);
        if (b.pts.length % 8 === 0) chan.push([p.x, p.y, p.z, potLeft(b.s)]);
        if (b.s >= L * b.reach) b.live = false;
        // a fork, at 43° ± 12°
        if (b.gen < 2 && rnd() < GROW.fork && branches.length < GROW.maxBranches) {
          branches.push({
            pts: [p], d: turn(b.d, Math.max(10 * D2R, GROW.branch + GROW.branchSd * gauss(rnd)), rnd),
            s: b.s, live: true, gen: b.gen + 1, reach: Math.min(1, b.s / L + 0.15 + 0.3 * rnd()),
          });
        }
      }
    }
    const minSeg = Math.max(0.015, L / 60);
    const sparks: Spark[] = branches.filter((b) => b.pts.length > 1).map((b) => ({
      pts: refine(b.pts, 0.12, minSeg, rnd), width: b.gen === 0 ? 1 : b.gen === 1 ? 0.6 : 0.4, strike: b === strike,
    }));
    // its feet: from the channel's last stretch, a few thinner ones touching the mat beside the main one
    if (strike && landing && !toPoint) {
      const at: V3 = landing, low = strike.pts.filter((x) => x.y > matY + jumpH * 0.4 && x.y < matY + jumpH * 3.5);
      const n = Math.floor(rnd() * (GROW.feet + 1));
      for (let j = 0; j < n && low.length; j++) {
        const from = low[Math.floor(rnd() * low.length)], a = rnd() * 2 * Math.PI, r = jumpH * (0.4 + 1.1 * rnd());
        sparks.push({ pts: refine([from, new THREE.Vector3(at.x + r * Math.cos(a), matY, at.z + r * Math.sin(a))], 0.18, minSeg * 0.6, rnd), width: 0.35, strike: true });
      }
    }
    return { sparks, main: branches[0].pts.length > 4 ? branches[0].pts : [], landing };
  }

  /** The electrodes' field at p, from the grid (trilinear; held at its edges), added to `out`. */
  private sample(p: V3, out: V3): V3 {
    const fx = Math.min(this.nx - 1.001, Math.max(0, (p.x - this.x0) / this.h));
    const fy = Math.min(this.ny - 1.001, Math.max(0, (p.y - this.y0) / this.h));
    const fz = Math.min(this.nz - 1.001, Math.max(0, (p.z - this.z0) / this.h));
    const i = fx | 0, j = fy | 0, k = fz | 0, u = fx - i, v = fy - j, w = fz - k;
    for (let c = 0; c < 8; c++) {
      const di = c & 1, dj = (c >> 1) & 1, dk = (c >> 2) & 1;
      const wt = (di ? u : 1 - u) * (dj ? v : 1 - v) * (dk ? w : 1 - w), o = (((k + dk) * this.ny + (j + dj)) * this.nx + (i + di)) * 3;
      out.x += wt * this.e[o]; out.y += wt * this.e[o + 1]; out.z += wt * this.e[o + 2];
    }
    return out;
  }
}
