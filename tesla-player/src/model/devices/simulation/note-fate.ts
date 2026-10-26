import type { MidiNote } from '@/model/midi/analyze';
import type { DevTrack } from './track';

export type FateKind = 'cut' | 'short' | 'strike' | 'ocd' | 'reduced' | 'ok';
/** The kinds from the worst: a note counts in the first that befell it. */
export const FATE_KINDS: readonly FateKind[] = ['cut', 'short', 'strike', 'ocd', 'reduced', 'ok'];
/** A moment of the song a view points at (a note's start), and how that note fared. */
export type LoadMark = [number, FateKind];

/** What became of one of a coil's notes between its note-on and its note-off. */
export class DevNoteFate {
  /** The smallest factor the max duty scaled it by (1: never). */
  minFactor = 1;
  /** The longest pulse it fired while held (µs): its velocity, the chords, the limits; 0 when none. */
  peakUs = 0;
  /** When it was silenced for lack of a voice (ms). */
  readonly cuts: [number, number][] = [];
  /** When its bangs ended on the OCD in the air, and when they struck the ground mat (ms). */
  readonly ocd: [number, number][] = [];
  readonly strikes: [number, number][] = [];
  /**
   * It had a voice while held, and no pulse made an arc: under the 4 µs the
   * board fires, or (a coil with a sheet) too short for the top to break out.
   * It isn't heard.
   */
  silent = false;

  /** index: its index in analysis.notes. */
  constructor(readonly index: number, readonly note: MidiNote) {}

  /**
   * How it fared: cut for lack of a voice, too short for any arc (not heard),
   * its arcs striking the ground mat, its bangs cut by the OCD, reduced by the
   * max duty, or untouched.
   */
  get kind(): FateKind {
    if (this.cuts.length) return 'cut';
    if (this.silent) return 'short';
    if (this.strikes.length) return 'strike';
    if (this.ocd.length) return 'ocd';
    return this.minFactor < 0.995 ? 'reduced' : 'ok';
  }

  /** Silenced at the step at `t` (stepMs long), on its coil's track. */
  cutAt(t: number, stepMs: number, track: DevTrack): void {
    const last = this.cuts[this.cuts.length - 1];
    if (last && Math.abs(last[1] - t) < 1e-6) last[1] = t + stepMs;
    else {
      if (!this.cuts.length) track.firstCuts.push(t);
      this.cuts.push([t, t + stepMs]);
    }
  }

  /** Its bangs ended on the OCD, or struck, at the step at `t`. */
  bangAt(fate: 'ocd' | 'strike', t: number, stepMs: number): void {
    const list = fate === 'strike' ? this.strikes : this.ocd;
    // the step joins the last stretch when it follows it
    const last = list[list.length - 1];
    if (last && Math.abs(last[1] - t) < 1e-6) last[1] = t + stepMs;
    else list.push([t, t + stepMs]);
  }
}
