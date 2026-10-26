import type { CoilSpec } from '@/model/coils/spec';
import type { PhyArcLoad } from './arc-load';
import { PRIMARY_TUNE, STEADY_BANGS, STRIKE_HOLD, TAU, Z_SEC } from './constants';
import { PhyRod } from './rod';

/**
 * What a DRSSTC does with one pulse of the interrupter (a "bang"), from its
 * sheet. The bridge drives the primary at ±V in step with its current (UD2.7):
 * every half period adds energy, the secondary takes its share through the
 * coupling, the arcs and the copper burn some. The OCD stops the bridge at its
 * threshold, the end of the pulse too; then the diodes give the energy back to
 * the bus while the arcs still take theirs (the ring-down).
 *
 * The arc load is computed, not fitted: it grows from the outlet point once
 * the top passes its breakout, at most at a hot channel's speed, towards the
 * length the top's voltage can hold (V − V_breakout over the channel's
 * gradient). It costs the streamer zone redone every half period (Manley) and
 * the channel's Joule losses; its capacitance pulls the secondary's tune
 * down. The channel cools in ~1 ms: at a note's rate the next bang starts
 * from what is left of it. An arc that reaches the ground (the mat, or a
 * scene's grounded things) is a strike: the secondary's energy goes at once
 * into the channel, the top collapses, the primary is left almost alone and
 * the OCD trips soon after; the struck path stays conductive ~10 ms and the
 * next bangs take it again.
 *
 * Three arc corners frame what the literature measures (growth speed,
 * capacitance per metre, hot channel gradient); 'milieu' is the reference.
 * Everything is SI inside (m, s, A, V, F, H, J).
 */

export interface TankOptions {
  /** Bus voltage (V); the nominal one when absent. */
  vbus?: number;
  /** Factor on L1: a primary tap moved in or out. */
  tap?: number;
  /** Another point than the sheet's; null: none. */
  rod?: PhyRod | null;
  /** Several points (a scene's) in place of the sheet's; their capacitances add up. */
  rods?: readonly PhyRod[];
}

export interface BangResult {
  /** When the OCD tripped (s), null when it did not. */
  ocdAt: number | null;
  Ipk: number;
  /** Energy drawn from the bus while driving, energy the arcs took (J). */
  eIn: number;
  eArc: number;
  /** The arc's channel at the end (m), the longest when there are several; the top's highest voltage (V), the lowest working frequency (Hz). */
  l: number;
  /** Each arc's channel at the end (m), in the order of the load's sources. */
  ls: number[];
  vMax: number;
  fMin: number;
  /** With trace: [µs, primary peak current A, channel m]. */
  pts: [number, number, number][];
  struck: boolean;
  strikeAt: number | null;
  /** The energy that went into the strike (J). */
  eStrike: number;
  /** Which arc struck; null: none. */
  struckArc: number | null;
}

/** The coupled modes of a tank: their angular frequencies, the low mode's share of energy in the primary, its energy per primary current² (J/A²). */
interface Modes { wl: number; wh: number; r: number; aE: number }

/**
 * The two coupled circuits of a coil, from its sheet: what one bang does at
 * a setting, and the steady state of a note.
 */
export class PhyTank {
  readonly vbus: number;
  /** The voltage the bridge applies (V). */
  readonly Vd: number;
  readonly L1: number;
  readonly C1: number;
  readonly L2: number;
  /** The secondary's top capacitance, the points' included (F). */
  readonly C2: number;
  readonly cPin: number;
  readonly k: number;
  readonly Z0: number;
  /** Share of the low mode's energy in the primary. */
  readonly r: number;
  /** The coupled modes (Hz); the low one is where the UD2.7 locks. */
  readonly fl: number;
  readonly fh: number;
  readonly halfUs: number;
  /** Primary current gained per half period (A), the secondary's share taken; and without it (the Ampère file's bound). */
  readonly dI: number;
  readonly dIfree: number;
  /** The worst current after an OCD trip: threshold + two "free" steps (A). */
  readonly worst: number;
  private readonly wl: number;

  constructor(readonly spec: CoilSpec, opts: TankOptions = {}) {
    this.vbus = opts.vbus ?? spec.vbus;
    const w2 = TAU * spec.f2;
    const cTop = spec.C2 ?? 1 / (w2 * Z_SEC);
    this.L2 = 1 / (w2 * w2 * cTop);
    const rod = opts.rod === undefined ? PhyRod.ofSheet(spec) : opts.rod;
    // JavaTC does not count the point: it adds to the top's capacitance
    this.cPin = opts.rods ? opts.rods.reduce((c, p) => c + p.capacitance, 0) : rod ? rod.capacitance : 0;
    this.C2 = cTop + this.cPin;
    this.L1 = (spec.L1 ?? 1 / ((TAU * spec.f2 * PRIMARY_TUNE) ** 2 * spec.c1)) * (opts.tap ?? 1);
    this.C1 = spec.c1;
    this.k = spec.k;
    const tk = PhyTank.modes(this.L1, this.C1, this.L2, this.C2, this.k);
    this.wl = tk.wl;
    this.r = tk.r;
    this.fl = tk.wl / TAU;
    this.fh = tk.wh / TAU;
    this.Vd = spec.bridge === 'full' ? this.vbus : this.vbus / 2;
    this.Z0 = Math.sqrt(this.L1 / this.C1);
    const halfS = Math.PI / tk.wl;
    this.halfUs = halfS * 1e6;
    this.dI = ((2 * this.Vd * tk.r) / (Math.PI * this.L1)) * halfS;
    this.dIfree = (2 * this.Vd) / this.Z0;
    this.worst = spec.ocd + 2 * this.dIfree;
  }

  /** The coupled modes: det([[1/C1 − ω²L1, −ω²M], [−ω²M, 1/C2 − ω²L2]]) = 0; r from the low mode's shape. */
  private static modes(L1: number, C1: number, L2: number, C2: number, k: number): Modes {
    const M = k * Math.sqrt(L1 * L2);
    const a = L1 * L2 - M * M, b = -(L1 / C2 + L2 / C1), c = 1 / (C1 * C2);
    const disc = Math.sqrt(b * b - 4 * a * c);
    const wl2 = (-b - disc) / (2 * a), wh2 = (-b + disc) / (2 * a);
    const q2 = (1 / C1 - wl2 * L1) / (wl2 * M);
    const e1 = 1 / (2 * C1), e2 = (q2 * q2) / (2 * C2);
    const r = e1 / (e1 + e2);
    return { wl: Math.sqrt(wl2), wh: Math.sqrt(wh2), r, aE: L1 / (2 * r) };
  }

  /** The MMC's voltage for a primary current (V). */
  vMmc(i: number): number {
    return i / (this.wl * this.C1);
  }

  /**
   * One bang of length T (s). l0: the arc channel still hot at its start (each
   * arc's when there are several). hot: the path of a previous strike is still
   * conductive: the arc takes it as soon as the top passes the breakout.
   */
  bang(load: PhyArcLoad, T: number, l0: number | readonly number[] = 0, trace = false, hot = false): BangResult {
    const { L1, C1, L2, C2, k, Vd } = this, ocd = this.spec.ocd;
    const M = k * Math.sqrt(L1 * L2);
    const arcs = load.sources;
    let tk = PhyTank.modes(L1, C1, L2, C2, k);
    // the first half period, from rest
    let E = tk.aE * (((2 * Vd * tk.r) / (Math.PI * L1)) * (Math.PI / tk.wl) / 2) ** 2;
    const ls = arcs.map((_, j) => (hot ? 0 : typeof l0 === 'number' ? l0 : l0[j] ?? 0));
    let t = 0, on = true, ocdAt: number | null = null, eIn = 0, eArc = 0, Ipk = 0, vMax = 0, fMin = tk.wl / TAU;
    let struck = false, strikeAt: number | null = null, eStrike = 0, struckArc: number | null = null, rStruck = 0;
    const pts: [number, number, number][] = [];
    for (let i = 0; i < 60000; i++) {
      let w: number, I: number, vTop: number, pArc: number;
      if (!struck) {
        let lAll = 0;
        for (const l of ls) lAll += l;
        const Carc = load.cArc * lAll;
        tk = PhyTank.modes(L1, C1, L2, C2 + Carc, k);
        fMin = Math.min(fMin, tk.wl / TAU);
        w = tk.wl;
        I = Math.sqrt(E / tk.aE);
        vTop = Math.sqrt((2 * (1 - tk.r) * E) / (C2 + Carc));
        const grow = load.vGrow * (Math.PI / w / 8);
        for (let j = 0; j < arcs.length; j++) {
          const lEq = Math.max(0, (vTop - arcs[j].vb) / load.eArc);
          if (lEq > ls[j]) ls[j] = Math.min(lEq, ls[j] + grow);
        }
        const hit = arcs.findIndex((c, j) => c.strikeLen && (ls[j] >= c.strikeLen || (hot && vTop > c.vb)));
        if (hit >= 0) {
          // the strike: the secondary's energy goes at once into the channel
          struck = true;
          strikeAt = t;
          struckArc = hit;
          const eSec = (1 - tk.r) * E;
          eArc += eSec;
          eStrike += eSec;
          E -= eSec;
          ls[hit] = arcs[hit].strikeLen!;
          rStruck = load.rStrike * ls[hit];
          continue;
        }
        const f = w / TAU;
        pArc = 0;
        for (let j = 0; j < arcs.length; j++) {
          const l = ls[j], vb = arcs[j].vb, Cj = load.cArc * l;
          if (Cj <= 0) continue;
          const pZone = vTop > vb ? 4 * f * Cj * vb * (vTop - vb) : 0;
          const R = load.rLin * l, X = 1 / (w * Cj);
          // the channel carries current only above the breakout: it sees V − V_breakout
          const dv = Math.max(0, vTop - vb);
          pArc += pZone + (0.5 * dv * dv * R) / (R * R + X * X);
        }
      } else {
        // the primary almost alone (secondary shorted: L1·(1 − k²)); the secondary, driven through M, feeds the hot channel
        w = 1 / Math.sqrt(L1 * (1 - k * k) * C1);
        I = Math.sqrt((2 * E) / L1);
        vTop = 0;
        const v2 = w * M * I, i2 = v2 / Math.sqrt((w * L2) ** 2 + rStruck * rStruck);
        pArc = 0.5 * i2 * i2 * rStruck;
      }
      const dt = Math.PI / w / 8;
      Ipk = Math.max(Ipk, I);
      vMax = Math.max(vMax, vTop);
      if (on && I >= ocd) { on = false; ocdAt = t; }
      if (on && t >= T) on = false;
      const pCu = (w * E) / load.qCu, pDrive = (2 / Math.PI) * Vd * I;
      if (on) eIn += pDrive * dt;
      eArc += pArc * dt;
      if (struck) eStrike += pArc * dt;
      if (trace && i % 2 === 0) pts.push([t * 1e6, I, Math.max(...ls)]);
      E = Math.max(0, E + ((on ? pDrive : -pDrive) - pArc - pCu) * dt);
      t += dt;
      if (!on && E < 1e-4) break;
    }
    return { ocdAt, Ipk, eIn, eArc, l: Math.max(...ls), ls, vMax, fMin, pts, struck, strikeAt, eStrike, struckArc };
  }

  /** The steady state at a note of f Hz: bangs follow each other, the channel keeps part of its length. */
  steady(load: PhyArcLoad, T: number, f: number, trace = false): BangResult {
    let l0: number[] = [], hot = false, o: BangResult | null = null;
    for (let i = 0; i < STEADY_BANGS; i++) {
      o = this.bang(load, T, l0, trace && i === STEADY_BANGS - 1, hot);
      l0 = o.ls.map((l) => l * Math.exp(-1 / (f * load.tauC)));
      // a strike's path stays conductive longer than the hot core: the next bangs take it again
      hot = o.struck && Math.exp(-1 / (f * load.tauStrike)) > STRIKE_HOLD;
    }
    return o!;
  }

  /** The shortest ontime (µs) that reaches the OCD in the steady state at f Hz; null: never up to maxUs. */
  usefulOntime(load: PhyArcLoad, f: number, maxUs: number): number | null {
    let lo = 4, hi = maxUs;
    if (!this.steady(load, hi * 1e-6, f).ocdAt) return null;
    while (hi - lo > 1) {
      const mid = (lo + hi) / 2;
      if (this.steady(load, mid * 1e-6, f).ocdAt) hi = mid;
      else lo = mid;
    }
    return hi;
  }
}
