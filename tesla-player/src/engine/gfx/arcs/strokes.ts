import * as THREE from 'three';

/** A generator of numbers in [0, 1): Math.random, or a seeded one for the tests. */
export type Rnd = () => number;

const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);

/** A normal draw (mean 0, deviation 1): Box–Muller. */
export function gauss(rnd: Rnd): number {
  let u = 0;
  while (u === 0) u = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

/** d turned by theta, in an azimuth at random. */
export function turn(d: THREE.Vector3, theta: number, rnd: Rnd): THREE.Vector3 {
  const u = new THREE.Vector3().crossVectors(Math.abs(d.y) < 0.9 ? Y : X, d).normalize(), v = new THREE.Vector3().crossVectors(d, u);
  const phi = rnd() * 2 * Math.PI, s = Math.sin(theta);
  return d.clone().multiplyScalar(Math.cos(theta)).addScaledVector(u, s * Math.cos(phi)).addScaledVector(v, s * Math.sin(phi)).normalize();
}

/** A direction at random in a cone (uniform on its cap). */
export const inCone = (axis: THREE.Vector3, half: number, rnd: Rnd): THREE.Vector3 => turn(axis, Math.acos(1 - rnd() * (1 - Math.cos(half))), rnd);

/** Each segment's middle moved aside at random by a share of its length, halved again, down to minSeg; its ends kept as they are. */
function zigzag(a: THREE.Vector3, b: THREE.Vector3, rough: number, minSeg: number, rnd: Rnd): THREE.Vector3[] {
  let pts = [a, b];
  const along = new THREE.Vector3();
  for (let pass = 0; pass < 9; pass++) {
    const next = [pts[0]];
    let split = false;
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1], p1 = pts[i], l = p0.distanceTo(p1);
      if (l > minSeg) {
        along.subVectors(p1, p0).normalize();
        const side = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).cross(along).normalize();
        next.push(new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5).addScaledVector(side, (rnd() - 0.5) * 2 * rough * l));
        split = true;
      }
      next.push(p1);
    }
    pts = next;
    if (!split) break;
  }
  return pts;
}

/** A polyline with its every segment zigzagged. */
export function refine(pts: readonly THREE.Vector3[], rough: number, minSeg: number, rnd: Rnd): THREE.Vector3[] {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) out.push(...zigzag(pts[i - 1], pts[i], rough, minSeg, rnd).slice(1));
  return out;
}

/** Short streamers rising from the mat around a strike's spot, toward the channel coming down (size: the jump's scale, m). */
export function groundStreamers(at: THREE.Vector3, size: number, rnd: Rnd = Math.random): THREE.Vector3[][] {
  const out: THREE.Vector3[][] = [];
  const n = 3 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const a = rnd() * 2 * Math.PI, r = size * (0.5 + 2 * rnd());
    const from = new THREE.Vector3(at.x + r * Math.cos(a), at.y, at.z + r * Math.sin(a));
    // up, leaning toward the spot
    const d = new THREE.Vector3((at.x - from.x) * 0.6 + (rnd() - 0.5) * size, size * (1.2 + rnd()), (at.z - from.z) * 0.6 + (rnd() - 0.5) * size).normalize();
    out.push(zigzag(from, from.clone().addScaledVector(d, size * (0.5 + 1.2 * rnd())), 0.25, size * 0.25, rnd));
  }
  return out;
}

/** A grounded point's brush where a strike lands on it: a few short streamers around its axis (toward the channel). */
export function pointBrush(at: THREE.Vector3, axis: THREE.Vector3, size: number, rnd: Rnd = Math.random): THREE.Vector3[][] {
  const out: THREE.Vector3[][] = [];
  const n = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const d = inCone(axis.clone().normalize(), (55 * Math.PI) / 180, rnd);
    out.push(zigzag(at, at.clone().addScaledVector(d, size * (0.4 + 0.9 * rnd())), 0.25, size * 0.2, rnd));
  }
  return out;
}
