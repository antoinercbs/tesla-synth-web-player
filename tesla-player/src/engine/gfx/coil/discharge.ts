import * as THREE from 'three';
import { GfxArcField, type ArcFrom } from '../arcs/field';
import { ENERGY_TINTS, GfxSparkBuffer, LOOKS, STRIKE_LOOK } from '../arcs/spark-buffer';
import { groundStreamers, pointBrush } from '../arcs/strokes';
import type { GfxCoil, GfxCoilHost } from './coil';

type V3 = THREE.Vector3;

/** The share of an image the eye holds its bangs together (ms). */
const SEEN_MS = 20;

/** A strike's path still hot: the next bangs take it again, and the hot air lifts it; on a grounded point, its axis. */
interface Lock { base: V3[]; feet: V3[][]; frames: number; rise: number; riseRate: number; len0: number; point: V3 | null }

/**
 * One coil's arcs from image to image: the bangs of the last 20 ms grown in
 * its field from each of its tubes (or its crown), each paler as there are
 * more; or a strike, one bright channel that lasts and rises like a Jacob's
 * ladder, its spot on the mat or a grounded point's brush where it lands; and
 * the faint brush discharges where the metal is not smooth.
 */
export class GfxDischarge {
  /** Where its strike lands in this image; null: none. */
  hit: V3 | null = null;
  /** This image's channels, for a picture traced over them (the tour's phone): the leaks and streamers left out. */
  readonly drawn: V3[][] = [];
  /** A buffer per look (LOOKS), each with its own material (its bangs set its opacity). */
  private readonly sparks: GfxSparkBuffer[];
  /** This image's spots and hot cores. */
  private readonly marks = new THREE.Group();
  /** Each source's last bang's main channel, for the next one. */
  private readonly paths: (V3[] | null)[];
  private lock: Lock | null = null;
  // after a burst of strikes, a few bangs in the air (the channel broken, the air stirred)
  private calm = 0;

  constructor(private readonly coil: GfxCoil, private readonly host: GfxCoilHost) {
    this.sparks = host.shared.looks.map((m, j) => new GfxSparkBuffer(m.clone(), j >= STRIKE_LOOK ? 6 : 3));
    coil.group.add(...this.sparks.map((b) => b.mesh), this.marks);
    this.paths = Array.from({ length: Math.max(1, coil.body.tubes.length) }, () => null);
  }

  /** Whether a strike is drawn now. */
  get striking(): boolean {
    return !!this.lock;
  }

  /** This image's arcs; how many bangs it holds. */
  draw(): number {
    this.clear();
    this.hit = null;
    // each bang the paler as there are more of them, less than in proportion: the eye adds them up
    const bangs = this.grow(), pale = bangs ** -0.45, energy = Math.max(0, Math.min(1, this.coil.state.energy ?? 0.5));
    for (let j = 0; j < STRIKE_LOOK; j++) {
      this.sparks[j].opacity(LOOKS[j].opacity * pale);
      this.sparks[j].tint(ENERGY_TINTS[j][0], ENERGY_TINTS[j][1], energy);
    }
    for (const b of this.sparks) b.flush();
    return bangs;
  }

  dispose(): void {
    this.clear();
    for (const b of this.sparks) b.dispose();
  }

  private clear(): void {
    this.drawn.length = 0;
    for (const m of [...this.marks.children]) {
      this.marks.remove(m);
      (m as THREE.Mesh).geometry.dispose();
    }
    for (const b of this.sparks) b.clear();
  }

  private grow(): number {
    const coil = this.coil, st = coil.state, field = coil.field;
    if (!st.on || st.reach <= 0 || !field) {
      this.lock = null;
      this.paths.fill(null);
      return 1;
    }
    const { shared, things } = this.host, b = coil.body, rnd = Math.random, k = b.big ? 1.8 : 1, px = this.host.pixelAt(coil.firstTip);
    const nSrc = Math.max(1, b.tubes.length), reachOf = (j: number) => st.reaches?.[j] ?? st.reach;
    const srcOf = (j: number): ArcFrom | undefined => b.tubes[j];
    // under the mat, or the floor
    const groundY = coil.mat?.y ?? 0;
    // brightest and widest at its root, where all its current passes; thinner and paler toward its end
    const add = (pts: V3[], strike: boolean, width = 1, bright?: number) => {
      if (width >= 0.5) this.drawn.push(pts);
      const r0 = (strike ? 0.0055 : 0.0018) * k * width, lit = bright ?? (strike ? Math.min(1, 0.6 + 0.4 * width) : Math.min(1, 0.4 + 0.6 * width));
      for (let j = 0; j < 3; j++) {
        const at = strike ? STRIKE_LOOK + j : j, look = LOOKS[at];
        const r = Math.max(r0 * look.r, look.min * px), end = strike ? r : Math.max(r0 * look.r * 0.45, look.min * px * 0.7);
        this.sparks[at].tube(pts, r, end, lit, strike ? lit : lit * 0.25);
      }
    };
    // where a strike lands: a spot of light on the ground, a hot core in it, short streamers rising around it
    const landing = (at: V3, size: number) => {
      this.hit = at.clone();
      const disc = new THREE.Mesh(new THREE.CircleGeometry(size * 1.6 * (0.85 + 0.3 * rnd()), 28), shared.spot);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(at.x, groundY + 0.002, at.z);
      const core = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.006 * k, 1.5 * px), 10, 8), shared.hit);
      core.scale.y = 0.45;
      core.position.set(at.x, groundY + 0.002, at.z);
      this.marks.add(disc, core);
      for (const pts of groundStreamers(new THREE.Vector3(at.x, groundY, at.z), size, rnd)) add(pts, false, 0.35);
    };
    // on a grounded point: a hot core on its tip, and its own brush toward the channel
    const pointLanding = (at: V3, dir: V3, size: number) => {
      this.hit = at.clone();
      const core = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.005 * k, 1.5 * px), 10, 8), shared.hit);
      core.position.copy(at);
      this.marks.add(core);
      for (const pts of pointBrush(at, dir, size, rnd)) add(pts, false, 0.35);
    };
    // a few faint brush discharges where the metal is not smooth: mostly a bevel's edges, now and then
    // along a tube or on the topload's rim
    const leaks = () => {
      const n = Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) {
        const where = rnd(), t = b.tubes[Math.floor(rnd() * b.tubes.length)];
        let from: V3, out: V3;
        if (t && where < 0.65) {
          from = t.tip.clone().addScaledVector(t.axis, -0.01 * k * rnd());
          out = t.axis.clone().add(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(2.4));
        } else if (t && where < 0.85) {
          from = t.base.clone().addScaledVector(t.axis, t.len * (0.25 + 0.7 * rnd()));
          out = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).cross(t.axis);
        } else {
          const p = field.crown(rnd() * 2 * Math.PI);
          from = p.tip;
          out = p.axis.clone().addScaledVector(b.up, 0.3 + 0.4 * rnd());
        }
        out.normalize();
        const l = 0.008 * k + 0.025 * k * rnd() * rnd();
        const mid = from.clone().addScaledVector(out, l * 0.5).add(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(l * 0.5));
        add([from, mid, from.clone().addScaledVector(out, l)], false, 0.22, 0.25 + 0.2 * rnd());
      }
    };
    const streamers = (len: number, thin = 1) => {
      for (let j = 0; j < nSrc; j++) for (const sp of field.grow({ reach: len, strike: 'air', from: srcOf(j) }, rnd).sparks) add(sp.pts, false, sp.width * thin);
    };
    const rate = st.bangHz ?? 0;
    const bangs = Math.max(1, Math.min(this.host.bangsCap(), Math.round((rate * SEEN_MS) / 1000)));
    leaks();

    if (this.lock && st.strike === 'strike') {
      // the hot channel rises from bang to bang, both feet held (the tube, the ground); stretched too far, it breaks
      const lock = this.lock;
      lock.rise += lock.riseRate;
      const n = lock.base.length, rise = lock.rise;
      const pts = lock.base.map((q, i) => (i === 0 || i === n - 1 ? q.clone()
        : q.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.006, rise * Math.sin((Math.PI * i) / (n - 1)) * (0.85 + 0.3 * rnd()), (rnd() - 0.5) * 0.006))));
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
      if (len > lock.len0 * 1.35 || --lock.frames <= 0) {
        this.lock = null;
        // a ring takes the next bangs at once: hardly a pause
        this.calm = lock.point ? Math.floor(rnd() * 2) : 3 + Math.floor(rnd() * 6);
      } else {
        add(pts, true);
        // its feet flicker where they touch
        for (const foot of lock.feet) {
          add(foot.map((q, i) => (i === foot.length - 1 ? q : q.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.004, 0, (rnd() - 0.5) * 0.004)))), true, 0.35);
        }
        if (lock.point) pointLanding(pts[n - 1], lock.point, GfxArcField.jumpHeight(st.reach));
        else landing(pts[n - 1], GfxArcField.jumpHeight(st.reach));
        streamers(st.reach * 0.12, 0.7);
        return 1;
      }
    }
    if (st.strike === 'air') this.lock = null;
    if (this.calm > 0) this.calm--;
    else if (st.strike === 'strike') {
      // the simulation's strike, from the source nearest the ground: on the ring's point nearest its tip
      // (else the ring's tube, where it is nearest), a counter-point's tip, the mesh where it is nearest, or on
      // the ground under its arcs' way out, not farther out than its tip is high
      const targets = coil.targets, j = st.strikeFrom ?? targets.reduce((best, t, i) => (t.gap < targets[best].gap ? i : best), 0);
      const reach = reachOf(j), onto = targets[j]?.onto;
      let from = srcOf(j), aim: V3, point: V3 | null = null;
      const tip = from ? from.tip.clone() : b.top.clone();
      const cp = onto === 'counter' ? coil.counterNear(tip) : null, mesh = onto === 'cage' ? things.nearestMesh([tip.x, tip.y, tip.z]) : null;
      if (cp) {
        aim = cp.tip;
        point = cp.tip.clone().sub(cp.back).normalize();
      } else if (mesh) {
        aim = new THREE.Vector3(...mesh.at);
        point = new THREE.Vector3(...mesh.normal);
      } else if (onto === 'ring' && b.ring) {
        const r = b.ring;
        let best = -1;
        r.tips.forEach((q, i) => { if (best < 0 || q.distanceTo(tip) < r.tips[best].distanceTo(tip)) best = i; });
        if (best >= 0) {
          aim = r.tips[best];
          point = r.dirs[best];
        } else {
          const toward = new THREE.Vector3(tip.x - r.center.x, 0, tip.z - r.center.z).normalize();
          const on = r.center.clone().addScaledVector(toward, r.R);
          point = tip.clone().sub(on).normalize();
          aim = on.addScaledVector(point, r.a);
        }
      } else {
        const axis = from ? from.axis : new THREE.Vector3(1, 0, 0);
        const flat = new THREE.Vector3(axis.x, 0, axis.z);
        if (flat.lengthSq() < 1e-4) flat.set(Math.cos(rnd() * 6.28), 0, Math.sin(rnd() * 6.28));
        flat.normalize();
        const out = Math.min(reach * (0.2 + 0.25 * rnd()), (tip.y - groundY) * (0.25 + 0.35 * rnd()), coil.mat ? coil.mat.half * 0.7 : Infinity);
        const sideways = new THREE.Vector3(-flat.z, 0, flat.x).multiplyScalar((rnd() - 0.5) * 0.5 * out);
        aim = new THREE.Vector3(tip.x + flat.x * out + sideways.x, groundY, tip.z + flat.z * out + sideways.z);
      }
      // the crown strikes from its rim, on the side of what it strikes
      if (!from) from = field.crown(Math.atan2(aim.z - b.top.z, aim.x - b.top.x));
      const grown = field.grow({ reach, strike: 'strike', target: aim, onto: point ? 'point' : 'mat', from }, rnd);
      const hit = grown.sparks.find((sp) => sp.strike && sp.width >= 1);
      if (hit && grown.landing) {
        const pts = hit.pts;
        add(pts, true);
        const feet = grown.sparks.filter((sp) => sp.strike && sp !== hit).map((sp) => sp.pts);
        for (const foot of feet) add(foot, true, 0.35);
        if (point) pointLanding(grown.landing, point, GfxArcField.jumpHeight(reach));
        else landing(grown.landing, GfxArcField.jumpHeight(reach));
        // what had started to grow elsewhere dies at once
        for (const sp of grown.sparks) if (!sp.strike) add(sp.pts.slice(0, Math.max(2, Math.ceil(sp.pts.length * 0.3))), false, sp.width * 0.6);
        let len0 = 0;
        for (let i = 1; i < pts.length; i++) len0 += pts[i].distanceTo(pts[i - 1]);
        // a burst of strikes at the same place: 0.2 to 0.6 s, until the hot air lifts and breaks it
        this.lock = { base: pts.map((q) => q.clone()), feet, frames: 5 + Math.floor(rnd() * 10), rise: 0, riseRate: 0.015 + 0.01 * rnd(), len0, point };
        this.paths.fill(null);
        return 1;
      }
    }
    // in the air: this image's bangs from each source, each finding what the air still holds of its last one's path
    const keep = GfxArcField.pathHeld(rate), per = Math.max(1, Math.round(bangs / nSrc));
    for (let j = 0; j < nSrc; j++) {
      const reach = reachOf(j);
      if (reach <= 0) continue;
      for (let n = 0; n < per; n++) {
        const grown = field.grow({ reach: reach * (0.8 + 0.35 * rnd()), strike: 'air', memory: this.paths[j], keep, from: srcOf(j) }, rnd);
        for (const sp of grown.sparks) add(sp.pts, false, sp.width);
        if (grown.main.length && b.tubes.length) this.paths[j] = grown.main;
      }
    }
    return per * nSrc;
  }
}
