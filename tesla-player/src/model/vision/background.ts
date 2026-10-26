import type { ArcMeterParams } from '@/model/vision/arc-meter';
import { VisFilters } from './filters';

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
export class VisBackgroundBuilder {
  private frames: Uint8ClampedArray[] = [];
  constructor(readonly width: number, readonly height: number, readonly maxFrames = 32) {}

  get count(): number { return this.frames.length; }
  get full(): boolean { return this.frames.length >= this.maxFrames; }

  /** Copies a crop-sized RGBA frame (the caller reuses its buffer). */
  add(rgba: Uint8ClampedArray): void {
    if (this.full) return;
    if (rgba.length !== this.width * this.height * 4) throw new Error('VisBackgroundBuilder: frame size mismatch');
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
    if (n < 2) throw new Error('VisBackgroundBuilder: need at least 2 frames');
    const w = this.width, h = this.height, npx = w * h;
    const rgb = new Float32Array(npx * 3);
    const spread = new Float32Array(npx);
    const scratch = new Float32Array(n);
    for (let i = 0; i < npx; i++) {
      let sp = 0;
      for (let c = 0; c < 3; c++) {
        for (let k = 0; k < n; k++) scratch[k] = this.frames[k][i * 4 + c];
        VisFilters.sortSmall(scratch, n);
        const p20 = VisFilters.sortedPercentile(scratch, n, 0.2);
        const p5 = VisFilters.sortedPercentile(scratch, n, 0.05);
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
    const sigmaBl = VisFilters.blur3(VisFilters.blur3(sigma, w, h), w, h);

    const gray = new Float32Array(npx);
    for (let i = 0; i < npx; i++) gray[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
    const grad = VisFilters.gradMag(gray, w, h);
    const gd = new Float32Array(npx), tmp = new Float32Array(npx);
    VisFilters.minMaxSquare(grad, w, h, 5, true, gd, tmp);
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
