/** Small image kernels on flat row-major arrays: the arc meter's pipeline (VisArcMeter). */
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

export class VisFilters {
  /** RGBA → luma (Rec.601), Float32. */
  static toGray(rgba: Uint8ClampedArray | Uint8Array, n: number, out?: Float32Array): Float32Array {
    const g = out ?? new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      g[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
    }
    return g;
  }

  /** 3×3 binomial blur ([1 2 1]/4 separable), replicate borders. */
  static blur3(src: Float32Array, w: number, h: number, out?: Float32Array, tmp?: Float32Array): Float32Array {
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
  static gradMag(src: Float32Array, w: number, h: number, out?: Float32Array): Float32Array {
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
  private static runMinMax1D(a: Float32Array, n: number, r: number, isMax: boolean, out: Float32Array, g: Float32Array, hh: Float32Array): void {
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
  static minMaxSquare(src: Float32Array, w: number, h: number, win: number, isMax: boolean, out: Float32Array, tmp: Float32Array): Float32Array {
    const r = win >> 1;
    const n = Math.max(w, h);
    const a = new Float32Array(n), o = new Float32Array(n), g = new Float32Array(n), hh = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) a[x] = src[row + x];
      VisFilters.runMinMax1D(a, w, r, isMax, o, g, hh);
      for (let x = 0; x < w; x++) tmp[row + x] = o[x];
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) a[y] = tmp[y * w + x];
      VisFilters.runMinMax1D(a, h, r, isMax, o, g, hh);
      for (let y = 0; y < h; y++) out[y * w + x] = o[y];
    }
    return out;
  }

  /** White top-hat: src − open(src) with a win×win square. */
  static tophat(src: Float32Array, w: number, h: number, win: number, out: Float32Array, tmpA: Float32Array, tmpB: Float32Array): Float32Array {
    VisFilters.minMaxSquare(src, w, h, win, false, tmpA, tmpB); // erosion → tmpA
    VisFilters.minMaxSquare(tmpA, w, h, win, true, tmpB, out); // dilation → tmpB (= opening)
    for (let i = 0; i < src.length; i++) {
      const v = src[i] - tmpB[i];
      out[i] = v > 0 ? v : 0;
    }
    return out;
  }

  /** Binary dilation by a (2r+1)² square. */
  static dilateBinary(src: Uint8Array, w: number, h: number, r: number, out: Uint8Array, tmp: Uint8Array): Uint8Array {
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
  static downscale(src: Float32Array, w: number, h: number, f: number, out?: Float32Array): { data: Float32Array; w: number; h: number } {
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

  static nccRef(ref: Float32Array, xs: Int32Array, ys: Int32Array, w: number): NccRef {
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
  static maskedNcc(r: NccRef, cur: Float32Array, w: number, h: number, dx: number, dy: number): number {
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
  static sortSmall(values: Float32Array, n: number): void {
    for (let i = 1; i < n; i++) {
      const v = values[i];
      let j = i - 1;
      while (j >= 0 && values[j] > v) { values[j + 1] = values[j]; j--; }
      values[j + 1] = v;
    }
  }

  /** Linear-interpolated percentile of an already sorted prefix of length n. */
  static sortedPercentile(sorted: Float32Array, n: number, p: number): number {
    const pos = p * (n - 1);
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
}
