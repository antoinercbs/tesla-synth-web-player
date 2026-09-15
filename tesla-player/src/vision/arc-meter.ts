/**
 * Arc-length meter: measures how far a Tesla-coil arc reaches from its breakout
 * point, frame after frame, from a camera that does not move.
 *
 * Pure TypeScript on typed arrays (no OpenCV.js). Everything runs on a CROP of
 * the frame around the measurement zone (the zone plus the decor the alignment
 * looks at), so the cost is bounded by the zone size, not the camera resolution.
 * The pipeline is a 1:1 port of the Python prototype validated on the club's
 * three test videos (see docs/tuning.md):
 *
 *  1. ALIGN    integer translation of the frame onto the background, by masked
 *              normalised cross-correlation of gradient features over the decor
 *              AROUND the zone (the arc itself never biases it). The phone is meant
 *              to be at rest: this is a safety net and a drift alarm (`moved`).
 *  2. DIFF     d = max over RGB of (frame − background)⁺. The background is captured
 *              with the coil OFF and the camera still, right before the tone.
 *  3. TOP-HAT  white top-hat with a 9×9 square: keeps thin bright filaments (the
 *              arc), drops diffuse illumination and slow exposure drift.
 *  4. THRESH   per-pixel thr = max(K·σ, C·|∇bg|, FLOOR). σ is the temporal noise of
 *              the coil-off capture measured on the DARK side of the distribution
 *              (p20 − p5), so arcs can never inflate it; the gradient term makes
 *              static edges tolerant to residual misalignment.
 *  5. CHAIN    dilate the mask by GAP px, flood-fill from the root disk around the
 *              breakout, keep only what is connected to it AND contains a strong
 *              seed (an arc core is near saturation, an edge residue is not).
 *              L = the farthest kept pixel from the breakout.
 *
 * Coordinates in the public API are WORK pixels of the full (downscaled) frame.
 */

export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Where to look: all in work-pixel coordinates of the full frame. */
export interface ArcGeometry {
  width: number;
  height: number;
  /** Breakout point (top of the toroid where arcs start). */
  breakout: Point;
  /** Radius of the measurement disk around the breakout. */
  roiRadius: number;
  /** Rows at or below this y are ignored (excludes the coil base / LEDs). Null = none. */
  excludeBelowY?: number | null;
  /** Extra rectangular exclusions (a lit window, a lamp). */
  excludeRects?: Rect[];
  /**
   * Direction the arcs leave the breakout in, degrees in screen coordinates
   * (0 = right, −90 = up). When set, the zone is the HALF-disk on that side: a
   * single breakout point only ever throws arcs one way. Null = full disk.
   */
  dirDeg?: number | null;
}

export interface ArcMeterParams {
  /** Noise multiplier of the per-pixel threshold. */
  kSigma: number;
  /** Gradient-of-background multiplier (tolerated residual misalignment, px). */
  cGrad: number;
  /** Absolute floor of the threshold (0..255 scale). */
  floor: number;
  /** Top-hat window (odd). Filaments thinner than this survive. */
  tophat: number;
  /** Bridging gap between mask fragments, px. */
  gapPx: number;
  /** Root disk radius as a fraction of roiRadius (min 4 px). */
  rootFrac: number;
  /** Absolute top-hat level a detection must reach somewhere to count. */
  seed: number;
  /** ...and relative to the local threshold. */
  seedRel: number;
  /** Alignment search radius, px. */
  searchPx: number;
  /** Alignment confidence (NCC) under which a frame is flagged unstable. */
  confMin: number;
  /** Shift beyond which the camera is considered MOVED since the background. */
  movedPx: number;
  /** Decor radius (× roiRadius) the alignment and the crop extend to. */
  decorFactor: number;
  /**
   * A pixel counts as arc only if its top-hat response is at least this fraction
   * of its difference to the background: a thin channel keeps ≈ 100 % of its
   * brightness through the top-hat, ground lit up by a strike keeps only its
   * texture (a small fraction of a large, smooth difference).
   */
  thinRatio: number;
}

export const DEFAULT_PARAMS: ArcMeterParams = {
  kSigma: 5,
  cGrad: 2,
  floor: 16,
  tophat: 9,
  gapPx: 3,
  rootFrac: 0.18,
  seed: 60,
  seedRel: 2,
  searchPx: 24,
  confMin: 0.3,
  movedPx: 6,
  decorFactor: 1.6,
  thinRatio: 0.5,
};

export interface Shift {
  dx: number;
  dy: number;
  /** Masked NCC at the best shift, −1..1. */
  conf: number;
}

export interface Measurement {
  /** Arc length: farthest kept pixel from the breakout (work px). 0 = no arc. */
  L: number;
  /** Tip of the arc (full-frame work px), null when no arc. */
  tip: Point | null;
  /** Kept arc pixels. */
  area: number;
  /** Above-threshold pixels NOT connected to the breakout (a health indicator). */
  stray: number;
  /** Sum of top-hat over the kept pixels. */
  energy: number;
  shift: Shift;
  /** False when the alignment confidence is below confMin. */
  stable: boolean;
  /** True when the shift exceeds movedPx: the phone moved since the background. */
  moved: boolean;
}

/** Crop rectangle (full-frame work px) the meter operates on. */
export interface Crop {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

/* ----------------------------------------------------------------------------
 * Small image kernels (all on flat row-major arrays)
 * -------------------------------------------------------------------------- */

/** RGBA → luma (Rec.601), Float32. */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, n: number, out?: Float32Array): Float32Array {
  const g = out ?? new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    g[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  }
  return g;
}

/** 3×3 binomial blur ([1 2 1]/4 separable), replicate borders. */
export function blur3(src: Float32Array, w: number, h: number, out?: Float32Array, tmp?: Float32Array): Float32Array {
  const t = tmp ?? new Float32Array(src.length);
  const o = out ?? new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) {
      const l = x > 0 ? src[r + x - 1] : src[r];
      const rr = x < w - 1 ? src[r + x + 1] : src[r + x];
      t[r + x] = (l + 2 * src[r + x] + rr) * 0.25;
    }
  }
  for (let y = 0; y < h; y++) {
    const up = y > 0 ? (y - 1) * w : 0;
    const dn = y < h - 1 ? (y + 1) * w : y * w;
    const r = y * w;
    for (let x = 0; x < w; x++) o[r + x] = (t[up + x] + 2 * t[r + x] + t[dn + x]) * 0.25;
  }
  return o;
}

/** Sobel gradient magnitude / 4 (same normalisation as the prototype). */
export function gradMag(src: Float32Array, w: number, h: number, out?: Float32Array): Float32Array {
  const o = out ?? new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < w - 1 ? x + 1 : w - 1;
      const a = src[ym * w + xm], b = src[ym * w + x], c = src[ym * w + xp];
      const d = src[y * w + xm], f = src[y * w + xp];
      const g = src[yp * w + xm], hh = src[yp * w + x], i = src[yp * w + xp];
      const gx = (c + 2 * f + i) - (a + 2 * d + g);
      const gy = (g + 2 * hh + i) - (a + 2 * b + c);
      o[y * w + x] = Math.sqrt(gx * gx + gy * gy) * 0.25;
    }
  }
  return o;
}

/**
 * Running min/max of one line with a window of 2r+1 clamped at the borders
 * (van Herk / Gil-Werman: 3 comparisons per sample whatever the window).
 * `a` holds the n input samples; `g`, `hh` are scratch of length ≥ n; result in `out`.
 */
function runMinMax1D(a: Float32Array, n: number, r: number, isMax: boolean, out: Float32Array, g: Float32Array, hh: Float32Array): void {
  const w = 2 * r + 1;
  if (isMax) {
    for (let i = 0; i < n; i++) g[i] = i % w === 0 ? a[i] : (g[i - 1] > a[i] ? g[i - 1] : a[i]);
    for (let i = n - 1; i >= 0; i--) hh[i] = (i % w === w - 1 || i === n - 1) ? a[i] : (hh[i + 1] > a[i] ? hh[i + 1] : a[i]);
    for (let i = 0; i < n; i++) {
      const hi = i + r >= n ? n - 1 : i + r;
      if (i < r) { out[i] = g[hi]; continue; }
      const p = hh[i - r], q = g[hi];
      out[i] = p > q ? p : q;
    }
  } else {
    for (let i = 0; i < n; i++) g[i] = i % w === 0 ? a[i] : (g[i - 1] < a[i] ? g[i - 1] : a[i]);
    for (let i = n - 1; i >= 0; i--) hh[i] = (i % w === w - 1 || i === n - 1) ? a[i] : (hh[i + 1] < a[i] ? hh[i + 1] : a[i]);
    for (let i = 0; i < n; i++) {
      const hi = i + r >= n ? n - 1 : i + r;
      if (i < r) { out[i] = g[hi]; continue; }
      const p = hh[i - r], q = g[hi];
      out[i] = p < q ? p : q;
    }
  }
}

/** Separable square min (erosion) or max (dilation) of a float image. */
export function minMaxSquare(src: Float32Array, w: number, h: number, win: number, isMax: boolean, out: Float32Array, tmp: Float32Array): Float32Array {
  const r = win >> 1;
  const n = Math.max(w, h);
  const a = new Float32Array(n), o = new Float32Array(n), g = new Float32Array(n), hh = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) a[x] = src[row + x];
    runMinMax1D(a, w, r, isMax, o, g, hh);
    for (let x = 0; x < w; x++) tmp[row + x] = o[x];
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) a[y] = tmp[y * w + x];
    runMinMax1D(a, h, r, isMax, o, g, hh);
    for (let y = 0; y < h; y++) out[y * w + x] = o[y];
  }
  return out;
}

/** White top-hat: src − open(src) with a win×win square. */
export function tophat(src: Float32Array, w: number, h: number, win: number, out: Float32Array, tmpA: Float32Array, tmpB: Float32Array): Float32Array {
  minMaxSquare(src, w, h, win, false, tmpA, tmpB); // erosion → tmpA
  minMaxSquare(tmpA, w, h, win, true, tmpB, out); // dilation → tmpB (= opening)
  for (let i = 0; i < src.length; i++) {
    const v = src[i] - tmpB[i];
    out[i] = v > 0 ? v : 0;
  }
  return out;
}

/** Binary dilation by a (2r+1)² square. */
export function dilateBinary(src: Uint8Array, w: number, h: number, r: number, out: Uint8Array, tmp: Uint8Array): Uint8Array {
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let run = r + 1; // distance to the last set pixel seen (forward pass)
    for (let x = 0; x < w; x++) { run = src[row + x] ? 0 : run + 1; tmp[row + x] = run <= r ? 1 : 0; }
    run = r + 1;
    for (let x = w - 1; x >= 0; x--) { run = src[row + x] ? 0 : run + 1; if (run <= r) tmp[row + x] = 1; }
  }
  for (let x = 0; x < w; x++) {
    let run = r + 1;
    for (let y = 0; y < h; y++) { run = tmp[y * w + x] ? 0 : run + 1; out[y * w + x] = run <= r ? 1 : 0; }
    run = r + 1;
    for (let y = h - 1; y >= 0; y--) { run = tmp[y * w + x] ? 0 : run + 1; if (run <= r) out[y * w + x] = 1; }
  }
  return out;
}

/** Box-average downscale by an integer factor. */
export function downscale(src: Float32Array, w: number, h: number, f: number, out?: Float32Array): { data: Float32Array; w: number; h: number } {
  const ow = Math.floor(w / f), oh = Math.floor(h / f);
  const o = out ?? new Float32Array(ow * oh);
  const inv = 1 / (f * f);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      let s = 0;
      for (let yy = 0; yy < f; yy++) {
        const row = (y * f + yy) * w + x * f;
        for (let xx = 0; xx < f; xx++) s += src[row + xx];
      }
      o[y * ow + x] = s * inv;
    }
  }
  return { data: o, w: ow, h: oh };
}

/**
 * Reference side of a masked NCC: zero-mean values and their norm over the mask,
 * computed once per background so each shift costs a single pass.
 */
export interface NccRef {
  xs: Int32Array;
  ys: Int32Array;
  z: Float32Array;
  norm: number;
}

export function nccRef(ref: Float32Array, xs: Int32Array, ys: Int32Array, w: number): NccRef {
  const n = xs.length;
  const z = new Float32Array(n);
  let s = 0;
  for (let k = 0; k < n; k++) { z[k] = ref[ys[k] * w + xs[k]]; s += z[k]; }
  const m = n ? s / n : 0;
  let ss = 0;
  for (let k = 0; k < n; k++) { z[k] -= m; ss += z[k] * z[k]; }
  return { xs, ys, z, norm: Math.sqrt(ss) };
}

/** Masked NCC of `cur` (read at +dx,+dy, replicated borders) against a prepared reference. */
export function maskedNcc(r: NccRef, cur: Float32Array, w: number, h: number, dx: number, dy: number): number {
  const n = r.xs.length;
  if (n === 0 || r.norm === 0) return 0;
  let sb = 0, sbb = 0, sab = 0;
  const xmax = w - 1, ymax = h - 1;
  for (let k = 0; k < n; k++) {
    let x = r.xs[k] + dx, y = r.ys[k] + dy;
    if (x < 0) x = 0; else if (x > xmax) x = xmax;
    if (y < 0) y = 0; else if (y > ymax) y = ymax;
    const b = cur[y * w + x];
    sb += b; sbb += b * b; sab += r.z[k] * b;
  }
  const varB = sbb - (sb * sb) / n;
  if (varB <= 1e-9) return 0;
  return sab / (r.norm * Math.sqrt(varB) + 1e-6);
}

/** In-place insertion sort of the first n values (fastest for n ≤ 40). */
function sortSmall(values: Float32Array, n: number): void {
  for (let i = 1; i < n; i++) {
    const v = values[i];
    let j = i - 1;
    while (j >= 0 && values[j] > v) { values[j + 1] = values[j]; j--; }
    values[j + 1] = v;
  }
}

/** Linear-interpolated percentile of an already sorted prefix of length n. */
function sortedPercentile(sorted: Float32Array, n: number, p: number): number {
  const pos = p * (n - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/* ----------------------------------------------------------------------------
 * Background model
 * -------------------------------------------------------------------------- */

export interface Background {
  /** Crop size. */
  width: number;
  height: number;
  /** Per-channel p20 of the capture, RGB interleaved (3 floats per pixel). */
  rgb: Float32Array;
  gray: Float32Array;
  /** Per-pixel threshold map (already includes K·σ, C·|∇bg| and the floor). */
  thr: Float32Array;
  /** Median per-pixel noise σ over the decor (a scene-quality indicator). */
  sigmaMedian: number;
  frames: number;
}

/**
 * Accumulates coil-OFF frames (crop-sized) and builds the per-pixel background
 * + threshold map. Obtain one from `meter.backgroundBuilder()`.
 */
export class BackgroundBuilder {
  private frames: Uint8ClampedArray[] = [];
  constructor(readonly width: number, readonly height: number, readonly maxFrames = 32) {}

  get count(): number { return this.frames.length; }
  get full(): boolean { return this.frames.length >= this.maxFrames; }

  /** Copies a crop-sized RGBA frame (the caller reuses its buffer). */
  add(rgba: Uint8ClampedArray): void {
    if (this.full) return;
    if (rgba.length !== this.width * this.height * 4) throw new Error('BackgroundBuilder: frame size mismatch');
    this.frames.push(new Uint8ClampedArray(rgba));
  }

  reset(): void { this.frames = []; }

  /**
   * bg = p20 per channel (arc-proof even if a stray arc slipped in), σ from the
   * dark side (p20 − p5) / 0.80, capped at 4× the scene median so a single
   * flickering LED cannot punch a hole in the sensitivity.
   */
  build(params: ArcMeterParams, decorMask: Uint8Array): Background {
    const n = this.frames.length;
    if (n < 2) throw new Error('BackgroundBuilder: need at least 2 frames');
    const w = this.width, h = this.height, npx = w * h;
    const rgb = new Float32Array(npx * 3);
    const spread = new Float32Array(npx);
    const scratch = new Float32Array(n);
    for (let i = 0; i < npx; i++) {
      let sp = 0;
      for (let c = 0; c < 3; c++) {
        for (let k = 0; k < n; k++) scratch[k] = this.frames[k][i * 4 + c];
        sortSmall(scratch, n);
        const p20 = sortedPercentile(scratch, n, 0.2);
        const p5 = sortedPercentile(scratch, n, 0.05);
        rgb[i * 3 + c] = p20;
        const s = (p20 - p5) / 0.8;
        if (s > sp) sp = s;
      }
      spread[i] = sp;
    }
    const decor: number[] = [];
    for (let i = 0; i < npx; i++) if (decorMask[i]) decor.push(spread[i]);
    decor.sort((a, b) => a - b);
    const sigmaMedian = decor.length ? decor[decor.length >> 1] : 1;
    const cap = 4 * sigmaMedian + 1;
    const sigma = new Float32Array(npx);
    for (let i = 0; i < npx; i++) sigma[i] = spread[i] > cap ? cap : spread[i];
    const sigmaBl = blur3(blur3(sigma, w, h), w, h);

    const gray = new Float32Array(npx);
    for (let i = 0; i < npx; i++) gray[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
    const grad = gradMag(gray, w, h);
    const gd = new Float32Array(npx), tmp = new Float32Array(npx);
    minMaxSquare(grad, w, h, 5, true, gd, tmp);
    const thr = new Float32Array(npx);
    for (let i = 0; i < npx; i++) {
      const a = params.kSigma * sigmaBl[i], b = params.cGrad * gd[i];
      let t = a > b ? a : b;
      if (t < params.floor) t = params.floor;
      thr[i] = t;
    }
    return { width: w, height: h, rgb, gray, thr, sigmaMedian, frames: n };
  }
}

/* ----------------------------------------------------------------------------
 * The meter
 * -------------------------------------------------------------------------- */

export class ArcMeter {
  readonly params: ArcMeterParams;
  /** Full-frame size the geometry refers to. */
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** The crop everything runs on (full-frame work px). */
  readonly crop: Crop;
  /** Crop size shortcuts. */
  readonly width: number;
  readonly height: number;
  /** Breakout in crop coordinates. */
  readonly bx: number;
  readonly by: number;
  readonly rootRadius: number;
  /** Masks in crop coordinates: 1 inside the zone / the root disk / the decor. */
  readonly roi: Uint8Array;
  readonly root: Uint8Array;
  readonly alignMask: Uint8Array;
  readonly dist: Float32Array;
  /** Kept arc pixels of the last measurement, crop-sized (for the overlay). */
  readonly keep: Uint8Array;

  private bg: Background | null = null;
  private nccFull: NccRef | null = null;
  private nccQ: NccRef | null = null;
  private qw = 0; private qh = 0;
  private alignXs!: Int32Array; private alignYs!: Int32Array;
  private alignXsQ!: Int32Array; private alignYsQ!: Int32Array;
  // scratch
  private readonly cropBuf: Uint8ClampedArray;
  private readonly aligned: Uint8ClampedArray;
  private readonly gray: Float32Array;
  private readonly f1: Float32Array; private readonly f2: Float32Array; private readonly f3: Float32Array;
  private readonly qbuf: Float32Array;
  private readonly d: Float32Array; private readonly top: Float32Array;
  private readonly mask: Uint8Array; private readonly bridged: Uint8Array; private readonly tmpU: Uint8Array;
  private readonly visited: Uint8Array;
  private readonly queue: Int32Array;

  constructor(readonly geom: ArcGeometry, params: Partial<ArcMeterParams> = {}) {
    this.params = { ...DEFAULT_PARAMS, ...params };
    const p = this.params;
    this.frameWidth = geom.width; this.frameHeight = geom.height;
    const r = geom.roiRadius;
    const reach = Math.ceil(p.decorFactor * r + p.searchPx + p.tophat);
    const x0 = Math.max(0, Math.floor(geom.breakout.x - reach));
    const y0 = Math.max(0, Math.floor(geom.breakout.y - reach));
    const x1 = Math.min(geom.width, Math.ceil(geom.breakout.x + reach) + 1);
    const y1 = Math.min(geom.height, Math.ceil(geom.breakout.y + reach) + 1);
    this.crop = { x0, y0, w: Math.max(8, x1 - x0), h: Math.max(8, y1 - y0) };
    const w = this.crop.w, h = this.crop.h, n = w * h;
    this.width = w; this.height = h;
    this.bx = geom.breakout.x - x0; this.by = geom.breakout.y - y0;
    this.rootRadius = Math.max(4, p.rootFrac * r);
    this.roi = new Uint8Array(n); this.root = new Uint8Array(n); this.alignMask = new Uint8Array(n);
    this.dist = new Float32Array(n);
    const excl = geom.excludeBelowY ?? null;
    const rects = geom.excludeRects ?? [];
    const dir = geom.dirDeg == null ? null : { x: Math.cos((geom.dirDeg * Math.PI) / 180), y: Math.sin((geom.dirDeg * Math.PI) / 180) };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const fx = x + x0, fy = y + y0;
        const dd = Math.hypot(x - this.bx, y - this.by);
        this.dist[i] = dd;
        let inRoi = dd <= r;
        // half-disk: keep the arcs' side (with the root disk fully inside)
        if (dir && (x - this.bx) * dir.x + (y - this.by) * dir.y < -this.rootRadius) inRoi = false;
        if (excl != null && fy >= excl) inRoi = false;
        for (const q of rects) if (fx >= q.x0 && fx < q.x1 && fy >= q.y0 && fy < q.y1) inRoi = false;
        this.roi[i] = inRoi ? 1 : 0;
        this.root[i] = dd <= this.rootRadius ? 1 : 0;
      }
    }
    const big = new Uint8Array(n), tmp = new Uint8Array(n);
    dilateBinary(this.roi, w, h, 7, big, tmp);
    for (let i = 0; i < n; i++) this.alignMask[i] = !big[i] && this.dist[i] <= p.decorFactor * r ? 1 : 0;
    this.cropBuf = new Uint8ClampedArray(n * 4);
    this.aligned = new Uint8ClampedArray(n * 4);
    this.gray = new Float32Array(n);
    this.f1 = new Float32Array(n); this.f2 = new Float32Array(n); this.f3 = new Float32Array(n);
    this.qw = Math.floor(w / 4); this.qh = Math.floor(h / 4);
    this.qbuf = new Float32Array(this.qw * this.qh);
    this.d = new Float32Array(n); this.top = new Float32Array(n);
    this.mask = new Uint8Array(n); this.bridged = new Uint8Array(n); this.tmpU = new Uint8Array(n);
    this.visited = new Uint8Array(n); this.keep = new Uint8Array(n);
    this.queue = new Int32Array(n);
    this.buildAlignIndex();
  }

  get background(): Background | null { return this.bg; }
  get ready(): boolean { return this.bg != null; }

  /** A builder sized for this meter's crop. */
  backgroundBuilder(maxFrames = 32): BackgroundBuilder {
    return new BackgroundBuilder(this.width, this.height, maxFrames);
  }

  private buildAlignIndex(): void {
    const w = this.width, h = this.height;
    const xs: number[] = [], ys: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (this.alignMask[y * w + x]) { xs.push(x); ys.push(y); }
    this.alignXs = Int32Array.from(xs); this.alignYs = Int32Array.from(ys);
    const qx: number[] = [], qy: number[] = [];
    for (let y = 0; y < this.qh; y++) for (let x = 0; x < this.qw; x++) {
      if (this.alignMask[(y * 4 + 2) * w + x * 4 + 2]) { qx.push(x); qy.push(y); }
    }
    this.alignXsQ = Int32Array.from(qx); this.alignYsQ = Int32Array.from(qy);
  }

  /**
   * Extracts this meter's crop from a full-frame RGBA buffer (frameWidth ×
   * frameHeight). Returns an internal buffer valid until the next call.
   */
  cropFrom(full: Uint8ClampedArray): Uint8ClampedArray {
    const fw = this.frameWidth;
    if (full.length !== fw * this.frameHeight * 4) throw new Error('ArcMeter.cropFrom: full-frame size mismatch');
    const { x0, y0, w, h } = this.crop;
    const out = this.cropBuf;
    for (let y = 0; y < h; y++) {
      const src = ((y + y0) * fw + x0) * 4;
      out.set(full.subarray(src, src + w * 4), y * w * 4);
    }
    return out;
  }

  /** Alignment feature: sqrt(|∇(blurred gray)|) — compresses the few very bright edges. */
  private feature(gray: Float32Array, out: Float32Array): Float32Array {
    blur3(gray, this.width, this.height, this.f1, this.f2);
    blur3(this.f1, this.width, this.height, this.f2, this.f3);
    gradMag(this.f2, this.width, this.height, out);
    for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(out[i]);
    return out;
  }

  setBackground(bg: Background): void {
    if (bg.width !== this.width || bg.height !== this.height) throw new Error('ArcMeter: background size mismatch');
    this.bg = bg;
    const feat = this.feature(bg.gray, new Float32Array(this.width * this.height));
    this.nccFull = nccRef(feat, this.alignXs, this.alignYs, this.width);
    const q = downscale(feat, this.width, this.height, 4);
    this.nccQ = nccRef(q.data, this.alignXsQ, this.alignYsQ, q.w);
  }

  /** Builds a background from the builder's coil-off frames and installs it. */
  buildBackground(builder: BackgroundBuilder): Background {
    const bg = builder.build(this.params, this.alignMask);
    this.setBackground(bg);
    return bg;
  }

  /**
   * Translation of the (crop-sized) frame onto the background: coarse at 1/4 res,
   * then fine ±3 px. Returns the masked NCC as confidence.
   */
  align(crop: Uint8ClampedArray): Shift {
    if (!this.nccFull || !this.nccQ) return { dx: 0, dy: 0, conf: 1 };
    const w = this.width, h = this.height;
    toGray(crop, w * h, this.gray);
    const feat = this.feature(this.gray, this.f3);
    const q = downscale(feat, w, h, 4, this.qbuf);
    const rs = Math.max(1, Math.round(this.params.searchPx / 4));
    let best = -2, bdx = 0, bdy = 0;
    for (let dy = -rs; dy <= rs; dy++) {
      for (let dx = -rs; dx <= rs; dx++) {
        const c = maskedNcc(this.nccQ, q.data, q.w, q.h, dx, dy);
        if (c > best) { best = c; bdx = dx; bdy = dy; }
      }
    }
    const cdx = bdx * 4, cdy = bdy * 4;
    best = -2;
    for (let dy = cdy - 3; dy <= cdy + 3; dy++) {
      for (let dx = cdx - 3; dx <= cdx + 3; dx++) {
        const c = maskedNcc(this.nccFull, feat, w, h, dx, dy);
        if (c > best) { best = c; bdx = dx; bdy = dy; }
      }
    }
    return { dx: bdx, dy: bdy, conf: best };
  }

  /** The crop translated so it sits on the background (replicate borders). */
  private alignedFrame(crop: Uint8ClampedArray, shift: Shift): Uint8ClampedArray {
    const w = this.width, h = this.height, out = this.aligned;
    if (shift.dx === 0 && shift.dy === 0) { out.set(crop); return out; }
    const xmax = w - 1, ymax = h - 1;
    for (let y = 0; y < h; y++) {
      let sy = y + shift.dy; if (sy < 0) sy = 0; else if (sy > ymax) sy = ymax;
      for (let x = 0; x < w; x++) {
        let sx = x + shift.dx; if (sx < 0) sx = 0; else if (sx > xmax) sx = xmax;
        const s = (sy * w + sx) * 4, o = (y * w + x) * 4;
        out[o] = crop[s]; out[o + 1] = crop[s + 1]; out[o + 2] = crop[s + 2]; out[o + 3] = 255;
      }
    }
    return out;
  }

  /** Measure a FULL frame (the meter crops it). */
  measure(full: Uint8ClampedArray, shift?: Shift): Measurement {
    return this.measureCrop(this.cropFrom(full), shift);
  }

  /**
   * Measure a crop-sized frame: align (unless a shift is supplied), then detect.
   */
  measureCrop(crop: Uint8ClampedArray, shift?: Shift): Measurement {
    if (!this.bg) throw new Error('ArcMeter: no background');
    const p = this.params;
    const sh = shift ?? this.align(crop);
    const stable = sh.conf >= p.confMin;
    const moved = Math.abs(sh.dx) > p.movedPx || Math.abs(sh.dy) > p.movedPx;
    const frame = this.alignedFrame(crop, sh);
    const w = this.width, h = this.height, n = w * h, bg = this.bg;
    // 2. diff = max channel of (frame − bg)⁺
    const d = this.d;
    for (let i = 0, j = 0, k = 0; i < n; i++, j += 4, k += 3) {
      const a = frame[j] - bg.rgb[k], b = frame[j + 1] - bg.rgb[k + 1], c = frame[j + 2] - bg.rgb[k + 2];
      let m = a > b ? a : b; if (c > m) m = c;
      d[i] = m > 0 ? m : 0;
    }
    blur3(d, w, h, this.f1, this.f2);
    // 3. top-hat
    const top = tophat(this.f1, w, h, p.tophat, this.top, this.f2, this.f3);
    // 4. threshold inside the zone; a channel keeps most of its brightness through
    //    the top-hat, a lit surface only its texture
    const mask = this.mask, dBl = this.f1;
    for (let i = 0; i < n; i++) {
      mask[i] = this.roi[i] && top[i] > bg.thr[i] && top[i] >= p.thinRatio * dBl[i] ? 1 : 0;
    }
    let maskCount = 0;
    for (let i = 0; i < n; i++) maskCount += mask[i];
    // 5. bridge + flood fill from the root disk
    dilateBinary(mask, w, h, p.gapPx, this.bridged, this.tmpU);
    const visited = this.visited; visited.fill(0);
    const q = this.queue; let qh = 0, qt = 0;
    for (let i = 0; i < n; i++) if (this.root[i] && this.bridged[i]) { visited[i] = 1; q[qt++] = i; }
    while (qh < qt) {
      const i = q[qh++];
      const x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (!visited[j] && this.bridged[j]) { visited[j] = 1; q[qt++] = j; }
        }
      }
    }
    const keep = this.keep; keep.fill(0);
    let area = 0, strong = false, energy = 0, L = 0, tipIdx = -1;
    for (let i = 0; i < n; i++) {
      if (!(mask[i] && visited[i])) continue;
      keep[i] = 1; area++; energy += top[i];
      if (!this.root[i]) {
        const need = Math.max(p.seed, p.seedRel * bg.thr[i]);
        if (top[i] > need) strong = true;
      }
      if (this.dist[i] > L) { L = this.dist[i]; tipIdx = i; }
    }
    if (!strong || area === 0) {
      keep.fill(0);
      return { L: 0, tip: null, area: 0, stray: maskCount, energy: 0, shift: sh, stable, moved };
    }
    const tip = tipIdx >= 0 ? { x: (tipIdx % w) + this.crop.x0, y: Math.floor(tipIdx / w) + this.crop.y0 } : null;
    return { L, tip, area, stray: maskCount - area, energy, shift: sh, stable, moved };
  }
}

/* ----------------------------------------------------------------------------
 * Trial statistics
 * -------------------------------------------------------------------------- */

export interface ArcStats {
  frames: number;
  /** Fraction of frames with an arc. */
  hitRate: number;
  /** 90th percentile of the per-frame length (the trial's figure of merit). */
  p90: number;
  median: number;
  max: number;
}

/** Percentile with linear interpolation over a copy of the values. */
export function percentile(values: ArrayLike<number>, p: number): number {
  const n = values.length;
  if (n === 0) return 0;
  const a = Array.from(values).sort((x, y) => x - y);
  const pos = p * (n - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

export function summarize(lengths: ArrayLike<number>): ArcStats {
  const n = lengths.length;
  if (n === 0) return { frames: 0, hitRate: 0, p90: 0, median: 0, max: 0 };
  let hits = 0, max = 0;
  for (let i = 0; i < n; i++) { if (lengths[i] > 0) hits++; if (lengths[i] > max) max = lengths[i]; }
  return { frames: n, hitRate: hits / n, p90: percentile(lengths, 0.9), median: percentile(lengths, 0.5), max };
}
