/** What the geometry reads of the view and the file, live. */
export interface RollViewport {
  scrollX(): number;
  scrollY(): number;
  /** px per beat */
  zoom(): number;
  ticksPerBeat(): number;
  beatsPerBar(): number;
  /** The snapping step, in ticks; 0: none. */
  grid(): number;
}

/**
 * Where things are on the piano roll: ticks across (after the keyboard), pitches
 * down (under the bar ruler), through the scroll and the zoom.
 */
export class RollGeometry {
  static readonly KEY_H = 11;
  static readonly KB_W = 46;
  static readonly RULER_H = 24;

  constructor(private readonly v: RollViewport) {}

  get zoom(): number {
    return this.v.zoom();
  }

  get grid(): number {
    return this.v.grid();
  }

  get beat(): number {
    return this.v.ticksPerBeat();
  }

  get bar(): number {
    return this.v.beatsPerBar() * this.v.ticksPerBeat();
  }

  get pxPerTick(): number {
    return this.v.zoom() / this.v.ticksPerBeat();
  }

  xOf(tick: number): number {
    return RollGeometry.KB_W + tick * this.pxPerTick - this.v.scrollX();
  }

  tickAt(x: number): number {
    return (x - RollGeometry.KB_W + this.v.scrollX()) / this.pxPerTick;
  }

  yOf(pitch: number): number {
    return RollGeometry.RULER_H + (127 - pitch) * RollGeometry.KEY_H - this.v.scrollY();
  }

  pitchAt(y: number): number {
    return Math.min(127, Math.max(0, 127 - Math.floor((y - RollGeometry.RULER_H + this.v.scrollY()) / RollGeometry.KEY_H)));
  }

  /** A tick on the grid, unless `free` (Alt) or no grid. */
  snap(tick: number, free: boolean): number {
    const g = this.grid;
    return Math.max(0, free || !g ? Math.round(tick) : Math.round(tick / g) * g);
  }

  /** "bar.beat", from 1. */
  barLabel(tick: number): string {
    const bar = this.bar;
    return `${Math.floor(tick / bar) + 1}.${Math.floor((tick % bar) / this.beat) + 1}`;
  }
}
