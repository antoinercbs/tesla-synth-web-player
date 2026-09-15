import type { Point } from '@/vision/arc-meter';

/**
 * Accumulated arc silhouette ("heat"): how often each cell of the measurement
 * crop was part of a detected arc during a note / a trial. Built on the phone
 * from the meter's kept-pixel masks, downsampled to a small grid and shipped
 * as base64 so it can be streamed live and stored with the trial.
 */
export interface HeatPayload {
  /** Grid size in cells. */
  w: number;
  h: number;
  /** Work pixels per cell (square). */
  cell: number;
  /** Work-px position of the grid origin (the crop origin). */
  x0: number;
  y0: number;
  /** Zone, in work px, for drawing. */
  breakout: Point;
  roiRadius: number;
  excludeBelowY: number | null;
  /** Arc direction (degrees, screen coords) when the zone is a half-disk. */
  dirDeg?: number | null;
  /** Frames accumulated. */
  frames: number;
  /** Peak mean count per cell (what 255 stands for). */
  max: number;
  /** Base64 of w×h bytes, 0..255 = mean count / max. */
  data: string;
}

/** Longest grid side sent over the wire. */
export const HEAT_MAX_CELLS = 64;

export function encodeBytes(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x2000) s += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  return btoa(s);
}

export function decodeBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * Downsamples a per-pixel count accumulator (crop-sized) to ≤ maxCells cells on
 * its longest side. Each cell holds the MEAN count of its pixels, normalised to
 * the peak, so a thin arc and a thick one compare fairly.
 */
export function downsampleHeat(
  acc: Uint32Array | Float32Array,
  width: number,
  height: number,
  geom: { x0: number; y0: number; breakout: Point; roiRadius: number; excludeBelowY: number | null; dirDeg?: number | null },
  frames: number,
  maxCells = HEAT_MAX_CELLS,
): HeatPayload {
  const cell = Math.max(1, Math.ceil(Math.max(width, height) / maxCells));
  const w = Math.ceil(width / cell), h = Math.ceil(height / cell);
  const sums = new Float32Array(w * h), counts = new Float32Array(w * h);
  for (let y = 0; y < height; y++) {
    const cy = Math.floor(y / cell);
    for (let x = 0; x < width; x++) {
      const k = cy * w + Math.floor(x / cell);
      sums[k] += acc[y * width + x];
      counts[k] += 1;
    }
  }
  let max = 0;
  for (let k = 0; k < sums.length; k++) { sums[k] /= counts[k] || 1; if (sums[k] > max) max = sums[k]; }
  const bytes = new Uint8Array(w * h);
  if (max > 0) for (let k = 0; k < bytes.length; k++) bytes[k] = Math.round((255 * sums[k]) / max);
  return { w, h, cell, x0: geom.x0, y0: geom.y0, breakout: geom.breakout, roiRadius: geom.roiRadius, excludeBelowY: geom.excludeBelowY, dirDeg: geom.dirDeg ?? null, frames, max, data: encodeBytes(bytes) };
}

/**
 * Sums several heats of the SAME geometry (the notes of one trial) into one,
 * weighting each by its own peak so the merged image is in mean-count units too.
 */
export function mergeHeats(heats: HeatPayload[]): HeatPayload | null {
  const valid = heats.filter((h) => h && h.w > 0 && h.h > 0);
  if (!valid.length) return null;
  const ref = valid[0];
  const same = valid.filter((h) => h.w === ref.w && h.h === ref.h && h.cell === ref.cell && h.x0 === ref.x0 && h.y0 === ref.y0);
  const acc = new Float32Array(ref.w * ref.h);
  let frames = 0;
  for (const h of same) {
    const bytes = decodeBytes(h.data);
    const scale = h.max / 255;
    for (let k = 0; k < acc.length && k < bytes.length; k++) acc[k] += bytes[k] * scale;
    frames += h.frames;
  }
  let max = 0;
  for (let k = 0; k < acc.length; k++) if (acc[k] > max) max = acc[k];
  const out = new Uint8Array(acc.length);
  if (max > 0) for (let k = 0; k < acc.length; k++) out[k] = Math.round((255 * acc[k]) / max);
  return { ...ref, frames, max, data: encodeBytes(out) };
}

/** A colour ramp for the heat: transparent → deep violet → cyan → white. */
export function heatColor(v: number): [number, number, number, number] {
  // v in 0..1
  if (v <= 0) return [0, 0, 0, 0];
  if (v < 0.35) { const t = v / 0.35; return [Math.round(60 + 60 * t), Math.round(20 + 30 * t), Math.round(120 + 80 * t), Math.round(120 + 100 * t)]; }
  if (v < 0.75) { const t = (v - 0.35) / 0.4; return [Math.round(120 - 50 * t), Math.round(50 + 174 * t), Math.round(200 + 55 * t), 235]; }
  const t = (v - 0.75) / 0.25;
  return [Math.round(70 + 185 * t), Math.round(224 + 31 * t), 255, 255];
}
