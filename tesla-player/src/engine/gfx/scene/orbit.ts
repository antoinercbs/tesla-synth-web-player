import * as THREE from 'three';
import type { GfxCoil } from '../coil/coil';

/** A camera on a stand, level and facing −z (see GfxOrbit.aim). */
export interface OrbitAim {
  /** The point seen where `at` says. */
  p: THREE.Vector3;
  /** Where it is seen, and the floor under it: fractions of the view from its top left. */
  at: { x: number; y: number };
  floor: number;
  /** The vertical field of view (deg). */
  fov: number;
}

/**
 * The camera, around what it frames: turned by a drag, slid with the right
 * or middle button, brought nearer or farther by the wheel. A lone coil is
 * framed with its arcs; a stage, from the audience. Or held on a stand (aim):
 * a phone filming a coil.
 */
export class GfxOrbit {
  readonly camera = new THREE.PerspectiveCamera(34, 1, 0.05, 80);
  readonly target = new THREE.Vector3();
  yaw = -0.6;
  pitch = 0.18;
  dist = 3;
  /** What it frames: a stage's width and height (m); null: a lone coil. */
  private framed: { span: number; height: number } | null = null;
  private aimed: OrbitAim | null = null;
  // the view's height (px), kept from the last resize: reading the element's would lay the page out again, many times an image
  private viewH = 1;

  /** The size of a screen pixel at a point (m). */
  pixelAt(p: THREE.Vector3): number {
    return (2 * this.camera.position.distanceTo(p) * Math.tan((this.camera.fov * Math.PI) / 360)) / this.viewH;
  }

  resize(w: number, h: number): void {
    this.viewH = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fit();
    this.applyAim();
  }

  /**
   * Held on a stand from now on, level (its axis horizontal) and facing −z: `p`
   * seen at `at`, the floor (y = 0) under it at `floor`, both as fractions of
   * the view. Its distance and height follow from the two, whatever the view's shape.
   */
  aim(a: OrbitAim): void {
    this.aimed = { ...a, p: a.p.clone() };
    this.applyAim();
  }

  /** Frame them all: a lone coil and its arcs, or the stage from the audience. */
  frame(coils: readonly GfxCoil[]): void {
    if (!coils.length || this.aimed) return;
    const height = Math.max(...coils.map((c) => c.body.height), 1), low = Math.min(...coils.map((c) => c.body.low));
    if (coils.length === 1) {
      this.framed = null;
      const c0 = coils[0].body, sc = coils[0].sc, reach = coils[0].state.reach;
      // a lone tube at its front: the coil and its arcs on that side; else the coil in the middle. Hung, seen
      // from below, its arcs under it
      const lone = c0.tubes.length === 1 && !(sc.tubes?.[0]?.center) && !c0.ring && !c0.hung;
      const bottom = c0.hung ? low - reach * 0.6 : low;
      this.target.set(sc.x + (lone ? c0.width * 0.4 * Math.cos(sc.azimuth) : 0), bottom + (height - bottom) * 0.45, (sc.z ?? 0) + (lone ? c0.width * 0.4 * Math.sin(sc.azimuth) : 0));
      this.dist = Math.max(height - bottom, c0.width + reach * 0.8, c0.outer * 1.15) * 2.1;
      if (c0.hung) this.pitch = -0.08;
    } else {
      // each coil with its arcs, on the side its tubes point to
      const xs = coils.flatMap(({ sc, body }) => {
        const w = body.outer, out = (sc.reach ?? 0) * 0.9 * Math.cos(sc.azimuth);
        return [sc.x - w + Math.min(0, out), sc.x + w + Math.max(0, out)];
      });
      const zs = coils.map(({ sc }) => sc.z ?? 0);
      const lo = Math.min(...xs), hi = Math.max(...xs);
      this.framed = { span: hi - lo, height: height - low };
      this.target.set((lo + hi) / 2, low + (height - low) * 0.5, (Math.min(...zs) + Math.max(...zs)) / 2);
      this.yaw = 0;
      this.pitch = 0.1;
      this.fit();
    }
  }

  /** The camera where it is now. */
  place(): void {
    const { target: t, dist: d, pitch, yaw } = this;
    this.camera.position.set(t.x + d * Math.cos(pitch) * Math.sin(yaw), t.y + d * Math.sin(pitch), t.z + d * Math.cos(pitch) * Math.cos(yaw));
    this.camera.lookAt(t);
  }

  /** Turned from a pose, by a drag of so many pixels. */
  turn(from: { yaw: number; pitch: number }, dx: number, dy: number): void {
    this.yaw = from.yaw - dx * 0.008;
    this.pitch = Math.max(-0.1, Math.min(1.2, from.pitch + dy * 0.006));
  }

  /** Slid from a target, by a drag of so many pixels: what was under the hand stays under it. */
  pan(from: THREE.Vector3, dx: number, dy: number): void {
    const k = this.pixelAt(this.target), m = this.camera.matrixWorld;
    this.target.copy(from).addScaledVector(new THREE.Vector3().setFromMatrixColumn(m, 0), -dx * k).addScaledVector(new THREE.Vector3().setFromMatrixColumn(m, 1), dy * k);
  }

  /** Nearer or farther, a tenth a notch. */
  zoom(deltaY: number): void {
    this.dist = Math.max(0.6, Math.min(40, this.dist * (1 + Math.sign(deltaY) * 0.1)));
  }

  /** On the floor, the screen's right and the way away from the viewer. */
  floorAxes(): { right: THREE.Vector3; away: THREE.Vector3 } {
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).setY(0).normalize();
    return { right, away: new THREE.Vector3(0, 1, 0).cross(right).normalize() };
  }

  // a point of the plane facing the camera at depth d is seen at ±1 (the view's edges) d·tan(fov/2) from its axis
  private applyAim(): void {
    const a = this.aimed;
    if (!a) return;
    const cam = this.camera, t = Math.tan((a.fov * Math.PI) / 360);
    cam.fov = a.fov;
    cam.updateProjectionMatrix();
    const nx = 2 * a.at.x - 1, ny = 1 - 2 * a.at.y, d = a.p.y / (2 * t * (a.floor - a.at.y));
    this.framed = null;
    this.yaw = 0;
    this.pitch = 0;
    this.dist = d;
    this.target.set(a.p.x - nx * d * t * cam.aspect, a.p.y - ny * d * t, a.p.z);
  }

  /** The stage's distance: its width and height in the view, whatever its shape. */
  private fit(): void {
    if (!this.framed) return;
    const v = Math.tan(((this.camera.fov / 2) * Math.PI) / 180), hz = v * this.camera.aspect;
    this.dist = Math.max((this.framed.span * 0.55 + 0.6) / hz, (this.framed.height * 0.75) / v);
  }
}
