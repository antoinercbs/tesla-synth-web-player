/** How a coil's bangs end at a step, the worst of them: 0 none fired (or no sheet, or no arc), then these. */
export const BANG_AIR = 1, BANG_OCD = 2, BANG_STRIKE = 3;

/** A coil along the song, one entry per step. */
export class DevTrack {
  /** The duty its notes ask for together, and the duty it fires (fractions). */
  readonly dutyAsked: Float32Array;
  readonly duty: Float32Array;
  /** What the max duty scaled every note by (1: untouched). */
  readonly factor: Float32Array;
  /** The longest pulse fired, and the longest asked for (µs). */
  readonly pulseUs: Float32Array;
  readonly askedUs: Float32Array;
  /** Its notes silenced for lack of a voice. */
  readonly skipped: Uint8Array;
  /** Where the OCD cuts the bangs of the notes it fires (µs, the lowest): Infinity when it doesn't, or the coil has no sheet. */
  readonly ocdUs: Float32Array;
  /** How its bangs end, the worst of them: BANG_AIR, BANG_OCD, BANG_STRIKE, 0 none. */
  readonly bang: Uint8Array;
  /** Where a note starts that its coil never makes heard: all its pulses too short for an arc. */
  readonly silent: Uint8Array;
  /** The power its arcs take (W) and their channel (m). */
  readonly powerW: Float32Array;
  readonly arcM: Float32Array;
  /** The bangs it fires a second that make an arc: its sounding notes' frequencies, added up. */
  readonly bangHz: Float32Array;
  /** When each of its notes was first silenced (ms), in order: "so far" counts. */
  readonly firstCuts: number[] = [];

  constructor(readonly coilIndex: number, steps: number) {
    this.dutyAsked = new Float32Array(steps);
    this.duty = new Float32Array(steps);
    this.factor = new Float32Array(steps).fill(1);
    this.pulseUs = new Float32Array(steps);
    this.askedUs = new Float32Array(steps);
    this.skipped = new Uint8Array(steps);
    this.ocdUs = new Float32Array(steps).fill(Infinity);
    this.bang = new Uint8Array(steps);
    this.silent = new Uint8Array(steps);
    this.powerW = new Float32Array(steps);
    this.arcM = new Float32Array(steps);
    this.bangHz = new Float32Array(steps);
  }

  /** Its longest pulse over the song (µs). */
  get peakUs(): number {
    return this.pulseUs.reduce((m, us) => Math.max(m, us), 0);
  }

  /** How many of its notes were silenced for lack of a voice up to `ms`. */
  cutsSoFar(ms: number): number {
    let lo = 0;
    let hi = this.firstCuts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.firstCuts[mid] <= ms) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}
