import { VisBackgroundBuilder, type Background } from './background';
import { VisFilters, type NccRef } from './filters';

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

/** A vertical wall behind the breakout: the zone is the side of x = `x` that `side` points to. */
export interface Wall {
  x: number;
  side: 1 | -1;
}

/**
 * Where to look: all in work-pixel coordinates of the full frame. The zone is
 * the whole frame, cut by whichever limits are set. The app sets a wall and a
 * floor (a breakout pin throws its arcs to one side); the disk is the
 * prototype's zone, kept for the replays and the records saved with it.
 */
export interface ArcGeometry {
  width: number;
  height: number;
  /** Breakout point (the tip of the pin the arcs leave from). */
  breakout: Point;
  wall?: Wall | null;
  /** Rows at or below this y are ignored (excludes the coil base / LEDs / the ground). Null = none. */
  excludeBelowY?: number | null;
  /** Extra rectangular exclusions (a lit window, a lamp). */
  excludeRects?: Rect[];
  /** Radius of a measurement disk around the breakout. Null = no limit but the frame. */
  roiRadius?: number | null;
  /**
   * With a disk: direction the arcs leave the breakout in, degrees in screen
   * coordinates (0 = right, −90 = up); the zone is the HALF-disk on that side.
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
  /** Root disk radius as a fraction of roiRadius (min 4 px)... */
  rootFrac: number;
  /** ...and without a disk, in px: it must not grow with the zone, or it swallows short arcs. */
  rootPx: number;
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
  /** Decor radius (× roiRadius) the alignment and the crop extend to... */
  decorFactor: number;
  /** ...and without a disk, the band behind the wall and below the floor, px. */
  decorPx: number;
  /**
   * A pixel counts as arc only if its top-hat response is at least this fraction
   * of its difference to the background: a thin channel keeps ≈ 100 % of its
   * brightness through the top-hat, ground lit up by a strike keeps only its
   * texture (a small fraction of a large, smooth difference).
   */
  thinRatio: number;
}

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
  /**
   * The arc reaches a limit, so L may be short of the real length: the edge of
   * the picture, or the zone's wall / disk. Reaching the floor is not one (a strike).
   */
  edge: 'frame' | 'zone' | null;
}

/** Crop rectangle (full-frame work px) the meter operates on. */
export interface Crop {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

const RIM_FRAME = 1, RIM_ZONE = 2;
/** Below this many decor pixels the alignment has nothing to hold on to: frames are taken as they come. */
const MIN_ALIGN_PX = 64;

export class VisArcMeter {
  static readonly DEFAULT_PARAMS: ArcMeterParams = {
    kSigma: 5,
    cGrad: 2,
    floor: 16,
    tophat: 9,
    gapPx: 3,
    rootFrac: 0.18,
    rootPx: 10,
    seed: 60,
    seedRel: 2,
    searchPx: 24,
    confMin: 0.3,
    movedPx: 6,
    decorFactor: 1.6,
    decorPx: 40,
    thinRatio: 0.5,
  };
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
  /** Zone pixels on a limit that cuts an arc short: RIM_FRAME or RIM_ZONE, else 0. */
  readonly rim: Uint8Array;
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
    this.params = { ...VisArcMeter.DEFAULT_PARAMS, ...params };
    const p = this.params;
    this.frameWidth = geom.width; this.frameHeight = geom.height;
    const r = geom.roiRadius ?? null;
    const wall = geom.wall ?? null;
    const excl = geom.excludeBelowY ?? null;
    let x0: number, y0: number, x1: number, y1: number;
    if (r != null) {
      const reach = Math.ceil(p.decorFactor * r + p.searchPx + p.tophat);
      x0 = Math.floor(geom.breakout.x - reach); y0 = Math.floor(geom.breakout.y - reach);
      x1 = Math.ceil(geom.breakout.x + reach) + 1; y1 = Math.ceil(geom.breakout.y + reach) + 1;
    } else {
      // the zone up to the frame's edges, plus the decor band behind the wall and below the floor
      x0 = 0; y0 = 0; x1 = geom.width; y1 = geom.height;
      if (wall) { if (wall.side > 0) x0 = Math.floor(wall.x - p.decorPx); else x1 = Math.ceil(wall.x + p.decorPx) + 1; }
      if (excl != null) y1 = Math.ceil(excl + p.decorPx);
    }
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(geom.width, x1); y1 = Math.min(geom.height, y1);
    this.crop = { x0, y0, w: Math.max(8, x1 - x0), h: Math.max(8, y1 - y0) };
    const w = this.crop.w, h = this.crop.h, n = w * h;
    this.width = w; this.height = h;
    this.bx = geom.breakout.x - x0; this.by = geom.breakout.y - y0;
    this.rootRadius = r != null ? Math.max(4, p.rootFrac * r) : Math.max(4, p.rootPx);
    this.roi = new Uint8Array(n); this.root = new Uint8Array(n); this.alignMask = new Uint8Array(n);
    this.rim = new Uint8Array(n);
    this.dist = new Float32Array(n);
    const rects = geom.excludeRects ?? [];
    const dir = geom.dirDeg == null ? null : { x: Math.cos((geom.dirDeg * Math.PI) / 180), y: Math.sin((geom.dirDeg * Math.PI) / 180) };
    const RIM = 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const fx = x + x0, fy = y + y0;
        const dd = Math.hypot(x - this.bx, y - this.by);
        this.dist[i] = dd;
        let inRoi = r == null || dd <= r;
        // half-disk: keep the arcs' side (with the root disk fully inside)
        if (dir && (x - this.bx) * dir.x + (y - this.by) * dir.y < -this.rootRadius) inRoi = false;
        if (wall && (fx - wall.x) * wall.side < 0) inRoi = false;
        if (excl != null && fy >= excl) inRoi = false;
        for (const q of rects) if (fx >= q.x0 && fx < q.x1 && fy >= q.y0 && fy < q.y1) inRoi = false;
        this.roi[i] = inRoi ? 1 : 0;
        this.root[i] = dd <= this.rootRadius ? 1 : 0;
        if (!inRoi) continue;
        // the limits that cut an arc short (the floor stops a strike: not one of them)
        if (fx < RIM || fy < RIM || fx >= geom.width - RIM || fy >= geom.height - RIM) this.rim[i] = RIM_FRAME;
        else if ((r != null && dd > r - RIM) || (wall && (fx - wall.x) * wall.side < RIM)) this.rim[i] = RIM_ZONE;
      }
    }
    const big = new Uint8Array(n), tmp = new Uint8Array(n);
    VisFilters.dilateBinary(this.roi, w, h, 7, big, tmp);
    for (let i = 0; i < n; i++) this.alignMask[i] = !big[i] && (r == null || this.dist[i] <= p.decorFactor * r) ? 1 : 0;
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
  backgroundBuilder(maxFrames = 32): VisBackgroundBuilder {
    return new VisBackgroundBuilder(this.width, this.height, maxFrames);
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
    VisFilters.blur3(gray, this.width, this.height, this.f1, this.f2);
    VisFilters.blur3(this.f1, this.width, this.height, this.f2, this.f3);
    VisFilters.gradMag(this.f2, this.width, this.height, out);
    for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(out[i]);
    return out;
  }

  setBackground(bg: Background): void {
    if (bg.width !== this.width || bg.height !== this.height) throw new Error('ArcMeter: background size mismatch');
    this.bg = bg;
    const feat = this.feature(bg.gray, new Float32Array(this.width * this.height));
    this.nccFull = VisFilters.nccRef(feat, this.alignXs, this.alignYs, this.width);
    const q = VisFilters.downscale(feat, this.width, this.height, 4);
    this.nccQ = VisFilters.nccRef(q.data, this.alignXsQ, this.alignYsQ, q.w);
  }

  /** Builds a background from the builder's coil-off frames and installs it. */
  buildBackground(builder: VisBackgroundBuilder): Background {
    const bg = builder.build(this.params, this.alignMask);
    this.setBackground(bg);
    return bg;
  }

  /**
   * Translation of the (crop-sized) frame onto the background: coarse at 1/4 res,
   * then fine ±3 px. Returns the masked NCC as confidence.
   */
  align(crop: Uint8ClampedArray): Shift {
    if (!this.nccFull || !this.nccQ || this.alignXs.length < MIN_ALIGN_PX) return { dx: 0, dy: 0, conf: 1 };
    const w = this.width, h = this.height;
    VisFilters.toGray(crop, w * h, this.gray);
    const feat = this.feature(this.gray, this.f3);
    const q = VisFilters.downscale(feat, w, h, 4, this.qbuf);
    const rs = Math.max(1, Math.round(this.params.searchPx / 4));
    let best = -2, bdx = 0, bdy = 0;
    for (let dy = -rs; dy <= rs; dy++) {
      for (let dx = -rs; dx <= rs; dx++) {
        const c = VisFilters.maskedNcc(this.nccQ, q.data, q.w, q.h, dx, dy);
        if (c > best) { best = c; bdx = dx; bdy = dy; }
      }
    }
    const cdx = bdx * 4, cdy = bdy * 4;
    best = -2;
    for (let dy = cdy - 3; dy <= cdy + 3; dy++) {
      for (let dx = cdx - 3; dx <= cdx + 3; dx++) {
        const c = VisFilters.maskedNcc(this.nccFull, feat, w, h, dx, dy);
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
    VisFilters.blur3(d, w, h, this.f1, this.f2);
    // 3. top-hat
    const top = VisFilters.tophat(this.f1, w, h, p.tophat, this.top, this.f2, this.f3);
    // 4. threshold inside the zone; a channel keeps most of its brightness through
    //    the top-hat, a lit surface only its texture
    const mask = this.mask, dBl = this.f1;
    for (let i = 0; i < n; i++) {
      mask[i] = this.roi[i] && top[i] > bg.thr[i] && top[i] >= p.thinRatio * dBl[i] ? 1 : 0;
    }
    let maskCount = 0;
    for (let i = 0; i < n; i++) maskCount += mask[i];
    // 5. bridge + flood fill from the root disk
    VisFilters.dilateBinary(mask, w, h, p.gapPx, this.bridged, this.tmpU);
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
    let area = 0, strong = false, energy = 0, L = 0, tipIdx = -1, rim = 0;
    for (let i = 0; i < n; i++) {
      if (!(mask[i] && visited[i])) continue;
      keep[i] = 1; area++; energy += top[i];
      if (this.rim[i] > rim) rim = this.rim[i];
      if (!this.root[i]) {
        const need = Math.max(p.seed, p.seedRel * bg.thr[i]);
        if (top[i] > need) strong = true;
      }
      if (this.dist[i] > L) { L = this.dist[i]; tipIdx = i; }
    }
    if (!strong || area === 0) {
      keep.fill(0);
      return { L: 0, tip: null, area: 0, stray: maskCount, energy: 0, shift: sh, stable, moved, edge: null };
    }
    const tip = tipIdx >= 0 ? { x: (tipIdx % w) + this.crop.x0, y: Math.floor(tipIdx / w) + this.crop.y0 } : null;
    const edge = rim === RIM_ZONE ? 'zone' : rim === RIM_FRAME ? 'frame' : null;
    return { L, tip, area, stray: maskCount - area, energy, shift: sh, stable, moved, edge };
  }
}
