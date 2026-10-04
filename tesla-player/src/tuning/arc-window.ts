import { summarize, type ArcMeter, type ArcStats, type Measurement } from '@/vision/arc-meter';
import { downsampleHeat, type HeatPayload } from './heat';

/**
 * One measurement window (a note of a trial, a run of the free meter): the
 * per-frame lengths and the arc silhouette. Frames flagged `moved` count in
 * `frames` but stay out of the statistics and the silhouette.
 */
export class ArcWindow {
  readonly lengths: number[] = [];
  frames = 0;
  unstable = 0;
  /** Frames whose arc reached the edge of the picture or the zone's wall. */
  edges = 0;
  private readonly acc: Uint32Array;

  constructor(private readonly meter: ArcMeter) {
    this.acc = new Uint32Array(meter.crop.w * meter.crop.h);
  }

  /** Must run before the meter's next `measureCrop`: the silhouette is read from its `keep` mask. */
  add(m: Measurement): void {
    this.frames++;
    if (!m.stable) this.unstable++;
    if (m.moved) return;
    this.lengths.push(m.L);
    if (m.edge) this.edges++;
    if (m.L > 0) {
      const k = this.meter.keep, acc = this.acc;
      for (let i = 0; i < k.length; i++) if (k[i]) acc[i]++;
    }
  }

  stats(): ArcStats { return summarize(this.lengths); }

  get unstableRate(): number { return this.frames ? this.unstable / this.frames : 0; }

  /** Of the frames with an arc, the share cut short by a limit: the length is then a floor, not a measure. */
  get edgeRate(): number {
    let arcs = 0;
    for (const L of this.lengths) if (L > 0) arcs++;
    return arcs ? this.edges / arcs : 0;
  }

  heat(): HeatPayload {
    const c = this.meter.crop, g = this.meter.geom;
    return downsampleHeat(this.acc, c.w, c.h, { x0: c.x0, y0: c.y0, breakout: g.breakout, wall: g.wall, roiRadius: g.roiRadius, excludeBelowY: g.excludeBelowY ?? null, dirDeg: g.dirDeg }, this.frames);
  }
}

/**
 * Cuts a free-running stream of frames into runs of the coil, for when nothing
 * tells the meter when the coil fires. A run opens on the first frame with an
 * arc and closes `gapMs` after the last one; the silent frames in between belong
 * to it (they make its hit rate), the silent tail does not.
 */
export class RunSegmenter<T> {
  private tail: T[] = [];
  private lastArcAt = 0;
  private open = false;

  constructor(readonly gapMs = 1500) {}

  get active(): boolean { return this.open; }

  /** `frames` are the ones to append to the open run, in order, the tail held back so far included. */
  push(frame: T, arc: boolean, now: number): { started: boolean; frames: T[]; ended: boolean } {
    if (!this.open) {
      if (!arc) return { started: false, frames: [], ended: false };
      this.open = true;
      this.lastArcAt = now;
      return { started: true, frames: [frame], ended: false };
    }
    if (arc) {
      const frames = this.tail.length ? [...this.tail, frame] : [frame];
      this.tail = [];
      this.lastArcAt = now;
      return { started: false, frames, ended: false };
    }
    if (now - this.lastArcAt > this.gapMs) {
      this.close();
      return { started: false, frames: [], ended: true };
    }
    this.tail.push(frame);
    return { started: false, frames: [], ended: false };
  }

  /** Ends the open run now, dropping its silent tail. */
  close(): void {
    this.open = false;
    this.tail = [];
  }
}
