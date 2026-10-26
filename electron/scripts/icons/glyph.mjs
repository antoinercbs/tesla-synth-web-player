// The Tesla Player glyph (♫) on a 512 grid, y down: on the left a Tesla coil
// (donut toroid, wound secondary, a note head as its base, a spark off the toroid),
// and ONE discharge that leaves the toroid, crosses as the beam and comes down as
// the right note's stem, with the same irregular rhythm all the way.
//
// Shapes are { pts } polygons, { ell } ellipses and { ring } ellipses with a hole.
// Every outline runs clockwise, ring holes counter-clockwise: filled with the
// nonzero rule, overlaps never punch holes, only the ring holes stay empty.

export const f = (n) => +n.toFixed(1);

const P = (pts) => ({ pts });
const E = (cx, cy, rx, ry, rot) => ({ ell: [cx, cy, rx, ry, rot] });
const R = (cx, cy, rxo, ryo, rxi, ryi, rot = 0, idy = 0) => ({ ring: [cx, cy, rxo, ryo, rxi, ryi, rot, idy] });

// rightmost point of a rotated ellipse (where a stem attaches, as in engraved notation)
function rightmost(cx, cy, rx, ry, rotDeg) {
  const t = (rotDeg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const W = Math.sqrt(rx * rx * c * c + ry * ry * s * s);
  return [cx + W, cy + ((rx * rx - ry * ry) * s * c) / W];
}

// an ellipse as two arcs; sweep 1 = clockwise on screen, 0 = counter-clockwise
export function ellD(cx, cy, rx, ry, rot, sweep = 1) {
  const t = (rot * Math.PI) / 180, ux = rx * Math.cos(t), uy = rx * Math.sin(t);
  const p1 = `${f(cx - ux)} ${f(cy - uy)}`, p2 = `${f(cx + ux)} ${f(cy + uy)}`;
  return `M${p1}A${rx} ${ry} ${rot} 1 ${sweep} ${p2}A${rx} ${ry} ${rot} 1 ${sweep} ${p1}Z`;
}
export function ringD([cx, cy, rxo, ryo, rxi, ryi, rot = 0, idy = 0], dx = 0, dy = 0) {
  return ellD(cx + dx, cy + dy, rxo, ryo, rot, 1) + ellD(cx + dx, cy + dy + idy, rxi, ryi, rot, 0);
}

export function bbox(shapes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const sh of shapes) {
    if (sh.pts) sh.pts.forEach(([x, y]) => add(x, y));
    else {
      const [cx, cy, rx, ry, rot] = sh.ell || [sh.ring[0], sh.ring[1], sh.ring[2], sh.ring[3], sh.ring[6] || 0];
      const t = (rot * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
      const W = Math.hypot(rx * c, ry * s), H = Math.hypot(rx * s, ry * c);
      add(cx - W, cy - H); add(cx + W, cy + H);
    }
  }
  return { x0, y0, x1, y1 };
}

// positive = clockwise on screen (y down)
const area2 = (pts) => pts.reduce((s, [x, y], i) => { const [u, v] = pts[(i + 1) % pts.length]; return s + x * v - u * y; }, 0);
const cw = (pts) => (area2(pts) < 0 ? [...pts].reverse() : pts);

// outline of a thick polyline (per-vertex half-widths), mitred, bevelled past `limit`
function thick(line, hs, limit = 2.2) {
  const nrm = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return [dy / l, -dx / l]; };
  const side = (sgn) => {
    const out = [];
    line.forEach((p, i) => {
      const h = hs[i] * sgn;
      const n0 = i > 0 ? nrm(line[i - 1], p) : null, n1 = i < line.length - 1 ? nrm(p, line[i + 1]) : null;
      if (!n0 || !n1) { const n = n0 || n1; out.push([p[0] + n[0] * h, p[1] + n[1] * h]); return; }
      const m = [n0[0] + n1[0], n0[1] + n1[1]], ml = Math.hypot(...m), mu = [m[0] / ml, m[1] / ml];
      const len = 1 / (mu[0] * n1[0] + mu[1] * n1[1]);
      if (len > limit) out.push([p[0] + n0[0] * h, p[1] + n0[1] * h], [p[0] + n1[0] * h, p[1] + n1[1] * h]);
      else out.push([p[0] + mu[0] * h * len, p[1] + mu[1] * h * len]);
    });
    return out;
  };
  return cw([...side(1), ...side(-1).reverse()]);
}

// the secondary coil: solid ends, a band of windings (bars + gaps) between
function coilColumn(x0, x1, yTop, yBot, { wTop, wBot, bar, gap }) {
  const out = [cw([[x0, yTop], [x1, yTop], [x1, wTop], [x0, wTop]])];
  let y = wTop + gap;
  for (; y + bar <= wBot; y += bar + gap) out.push(cw([[x0, y], [x1, y], [x1, y + bar], [x0, y + bar]]));
  out.push(cw([[x0, y], [x1, y], [x1, yBot], [x0, yBot + 5]]));
  return out.map(P);
}

/**
 * @param {'fine'|'coarse'|'none'} detail  'fine' ≥ 64 px; 'coarse' for the sidebar and
 *   32–48 px icons (fewer, bolder turns that survive the downscale); 'none' for
 *   16–24 px (plain column, no toroid hole)
 */
export function glyph(detail) {
  const T = [150, 146], tor = [74, 31], cwid = 46;
  const cx0 = T[0] - cwid / 2, cx1 = T[0] + cwid / 2;
  const out = [];
  // the toroid's hole, centred: reads as a donut
  out.push(detail !== 'none' ? R(T[0], T[1], tor[0], tor[1], 33, 10.5) : E(T[0], T[1], tor[0], tor[1], 0));
  // the coil stands on a note head
  const W = rightmost(0, 0, 62, 45, -20);
  const yb = 392;
  out.push(E(cx1 - W[0], yb - W[1], 62, 45, -20));
  const turns = detail === 'coarse' ? { bar: 15, gap: 10 } : { bar: 7, gap: 6 };
  out.push(...(detail !== 'none'
    ? coilColumn(cx0, cx1, T[1] + 14, yb, { wTop: T[1] + 44, wBot: yb - 60, ...turns })
    : [P(cw([[cx0, T[1] + 14], [cx1, T[1] + 14], [cx1, yb], [cx0, yb + 5]]))]));

  const h2 = [344, 398, 62, 45, -20];
  const [rx, ry] = rightmost(...h2);
  const xs = rx - 17; // stem centre line
  const line = [
    [T[0] + tor[0] - 10, T[1] + 2], [232, 132], [252, 148], [279, 124], [298, 140], [326, 118], [346, 132],
    [xs - 6, 112], [xs + 10, 120], // the turn: beam becomes stem
    [xs - 5, 160], [xs + 9, 198], [xs - 7, 236], [xs + 7, 274], [xs - 5, 310], [xs + 5, 348], [xs, ry - 4],
  ];
  const hs = [10, 10.5, 11, 12, 12.5, 13.5, 14.5, 15.5, 16.5, 17, 17, 17, 17, 17, 17, 17];
  out.push(P(thick(line, hs, 3)));
  // one filament off the toroid's left rim, heading up-left, tapering to a point
  out.push(P(thick(
    [[T[0] - 50, T[1] - 16], [T[0] - 72, T[1] - 26], [T[0] - 82, T[1] - 46], [T[0] - 104, T[1] - 54], [T[0] - 114, T[1] - 76], [T[0] - 132, T[1] - 84]],
    [12, 10.5, 8.5, 6.5, 4, 0.9], 3.5)));
  return [...out, E(...h2)];
}
