import { CalRoles } from '@/model/calib/roles';
import { BIN_MS, type CalibNote } from './types';

/** A coil's notes as the searches take them: frequencies, levels, the bins each sounds in, weights; the register its crossover moves in. */
export class CalNotes {
  readonly n: number;
  readonly hz: Float64Array;
  readonly lvl: Float64Array;
  readonly b0: Int32Array;
  readonly b1: Int32Array;
  readonly w: Float64Array;
  /** The register its crossover moves in (Hz). */
  readonly fLo: number;
  readonly fHi: number;

  private constructor(mine: readonly CalibNote[], bins: number) {
    const n = mine.length;
    this.n = n;
    this.hz = new Float64Array(n);
    this.lvl = new Float64Array(n);
    this.b0 = new Int32Array(n);
    this.b1 = new Int32Array(n);
    this.w = new Float64Array(n);
    mine.forEach((x, i) => {
      this.hz[i] = x.hz;
      this.lvl[i] = x.lvl;
      this.b0[i] = Math.min(bins - 2, Math.floor(x.startMs / BIN_MS));
      this.b1[i] = Math.min(bins - 2, Math.floor(x.endMs / BIN_MS));
      this.w[i] = Math.max(1, x.durMs);
    });
    const logs = mine.map((x) => Math.log(x.hz));
    const w = Array.from(this.w);
    this.fLo = Math.exp(CalRoles.weightedQuantile(logs, w, 0.02)) / 1.03;
    this.fHi = Math.exp(CalRoles.weightedQuantile(logs, w, 0.98)) * 1.03;
  }

  /** The notes of the channels in `mask`, over `bins`; null: none. */
  static of(notes: readonly CalibNote[], mask: number, bins: number): CalNotes | null {
    const mine = notes.filter((n) => mask & (1 << n.ch));
    return mine.length ? new CalNotes(mine, bins) : null;
  }
}
