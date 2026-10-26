import { DevOutput, type CoilDrive } from '@/model/devices/output';
import { SndLevelLaw } from '@/model/audio';
import type { CoilResponse } from '@/model/coils/response';
import { SndBang } from '@/model/coils/sound';
import type { CalNotes } from './notes';
import type { CalScratch } from './scratch';
import { CLEAN_TILT, type HwLimits, type Limits, type PadMeasures } from './types';

/** A clean setting found for a coil: its drive, its crossover's place in the register, what it does. */
export interface CalFit { drive: CoilDrive; tilt: number; cell: PadMeasures }

// the board's protection, kept at a distance
const HW_MARGIN = 0.9;

/**
 * A coil playing some of the song's notes, under its limits (and the board's
 * protection), heard through its sheet's physics when it has one (else the
 * synth's level law): what a drive does to its notes, and the drives the
 * Assistant proposes.
 */
export class CalCoil {
  /** The power the Assistant picks by default, a share of the coil. */
  static readonly DEFAULT_POWER = 0.8;

  constructor(
    readonly notes: CalNotes,
    readonly lim: Limits,
    readonly hw: HwLimits | null,
    readonly physics: CoilResponse | null,
    private readonly s: CalScratch,
  ) {}

  /** A drive as stored: a whole ontime, a duty to 0.01 %. */
  static round(drive: CoilDrive): CoilDrive {
    return { ontimeUs: Math.max(1, Math.round(drive.ontimeUs)), duty: Math.round(drive.duty * 1e4) / 1e4 };
  }

  get maxOntime(): number {
    return Math.min(this.hw ? this.hw.ontimeUs * HW_MARGIN : Infinity, this.lim.ontimeUs);
  }

  get maxDuty(): number {
    return Math.min(this.hw ? this.hw.duty * HW_MARGIN : Infinity, this.lim.duty);
  }

  /** The duty its notes ask for together in each bin, left in the scratch's values; how many bins sound. */
  demand(drive: CoilDrive): number {
    const { diff, vals } = this.s, cn = this.notes, out = new DevOutput(drive);
    diff.fill(0);
    const cap = DevOutput.cap(this.lim) ?? Infinity;
    const minOn = this.lim.minOntimeUs ?? 0;
    for (let i = 0; i < cn.n; i++) {
      const us = Math.min(out.requested(cn.hz[i], cn.lvl[i]), cap);
      if (us < 1) continue;
      const d = ((us + minOn) * cn.hz[i]) / 1e6;
      diff[cn.b0[i]] += d;
      diff[cn.b1[i] + 1] -= d;
    }
    let acc = 0, k = 0;
    for (let b = 0; b < vals.length; b++) {
      acc += diff[b];
      if (acc > 1e-12) vals[k++] = acc;
    }
    return k;
  }

  /** The duty its notes ask for together, `q` of the time they sound. */
  demandAt(drive: CoilDrive, q: number): number {
    return this.s.quantile(this.demand(drive), q);
  }

  /** The share of its notes' time whose lone pulse reaches the OCD (or a strike). */
  ocdShare(drive: CoilDrive): number {
    const physics = this.physics, cn = this.notes;
    if (!physics) return 0;
    const out = new DevOutput(drive, this.lim);
    let W = 0, over = 0;
    for (let i = 0; i < cn.n; i++) {
      W += cn.w[i];
      if (out.effective(cn.hz[i], cn.lvl[i]) >= physics.ocdFrom(cn.hz[i])) over += cn.w[i];
    }
    return W ? over / W : 0;
  }

  /** What a drive does to its notes, by the pads' measures. */
  assess(drive: CoilDrive): PadMeasures {
    const cn = this.notes, cap = DevOutput.cap(this.lim) ?? Infinity, asked = new DevOutput(drive), fired = new DevOutput(drive, this.lim);
    let W = 0, sum = 0, capped = 0;
    const ls = new Float64Array(cn.n);
    for (let i = 0; i < cn.n; i++) {
      ls[i] = this.noteLevel(fired, cn.hz[i], cn.lvl[i]);
      W += cn.w[i];
      sum += ls[i] * cn.w[i];
      if (asked.requested(cn.hz[i], cn.lvl[i]) > cap) capped += cn.w[i];
    }
    const mean = sum / W;
    let v = 0;
    for (let i = 0; i < cn.n; i++) v += (ls[i] - mean) ** 2 * cn.w[i];
    const count = this.demand(drive);
    let over = 0;
    for (let b = 0; b < count; b++) if (this.s.vals[b] > this.lim.duty + 1e-9) over++;
    return { level: mean, spread: Math.sqrt(v / W), capped: capped / W, busy: count ? over / count : 0, ocd: this.ocdShare(drive) };
  }

  /**
   * The clean drive at `power` (a share of the coil) with its crossover at `tilt`
   * in its register: the largest ontime (the duty following, the crossover held)
   * whose demand stays under the coil's max duty `q` of the time, and whose
   * bangs stay off the OCD as often.
   */
  cleanDrive(power: number, tilt: number, q: number): CoilDrive {
    const cn = this.notes;
    const fb = Math.exp(Math.log(cn.fHi) + tilt * (Math.log(cn.fLo) - Math.log(cn.fHi)));
    const budget = power * this.lim.duty;
    const driveOf = (o: number): CoilDrive => ({ ontimeUs: o, duty: Math.min(power * this.maxDuty, (o * fb) / 1e6) });
    let lo = 1, hi = Math.max(1, power * this.maxOntime);
    for (let k = 0; k < 18; k++) {
      const mid = (lo + hi) / 2;
      if (this.demandAt(driveOf(mid), q) <= budget && this.ocdShare(driveOf(mid)) <= 1 - q) lo = mid;
      else hi = mid;
    }
    return CalCoil.round(driveOf(lo));
  }

  /** The crossover that keeps its notes the most even, a little loudness traded for it. */
  bestClean(q: number): CalFit {
    let best: (CalFit & { score: number }) | null = null;
    for (const tilt of CLEAN_TILT) {
      const drive = this.cleanDrive(CalCoil.DEFAULT_POWER, tilt, q);
      const cell = this.assess(drive);
      const score = cell.spread - 0.25 * cell.level + 6 * cell.capped + 6 * cell.ocd;
      if (!best || score < best.score) best = { drive, tilt, cell, score };
    }
    return best!;
  }

  /** The loud drive: a share of the max ontime, a load of the max duty. */
  loudDrive(share: number, load: number): CoilDrive {
    return CalCoil.round({ ontimeUs: share * this.maxOntime, duty: load * this.maxDuty });
  }

  /**
   * A note's level as heard: its lone pulse through the synth's level law and the
   * rate's √f, in dB (−60 for a silent one). Used to compare coils and settings,
   * not as a sound pressure.
   */
  private noteLevel(out: DevOutput, hz: number, lvl: number): number {
    const p = out.effective(hz, lvl);
    if (this.physics) return SndBang.levelDb(this.physics, p, hz);
    return p > 0 ? 20 * Math.log10(SndLevelLaw.DEFAULT.level(p, hz)) + 10 * Math.log10(hz / 440) : -60;
  }
}
