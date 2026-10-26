import type { CoilSpec } from '@/model/coils/spec';
import { PhyArcLoad, PhyCoil, type BangResult } from './physics';

/** short: too short for the top to reach its breakout, no arc, nothing heard. */
export type BangFate = 'short' | 'air' | 'ocd' | 'strike';

export interface BangPoint {
  /** Energy into the arcs per bang (J), a strike's dump included. */
  e: number;
  /** The arc's channel (m). */
  l: number;
  fate: BangFate;
}

export interface CoilResponse {
  at(pulseUs: number, hz: number): BangPoint;
  /** The shortest pulse (µs) whose bangs end on the OCD (a strike included) at this rate; Infinity: none. */
  ocdFrom(hz: number): number;
  /** The shortest pulse (µs) whose arcs strike the ground at this rate; Infinity: none. */
  strikeFrom(hz: number): number;
  /** The shortest pulse whose bang makes an arc (µs): under it, the top never reaches its breakout. */
  arcFrom(hz: number): number;
}

/** What a response is made of: on its grid, each point's arc energy (J) and channel (m); by rate, its thresholds (µs). */
export interface ResponseData {
  e: number[][];
  l: number[][];
  ocd: number[];
  strike: number[];
  arc: number[];
}

/** Where responses are kept between sessions, by their sheet's key (the page gives one; none in a worker, in tests). */
export interface ResponseStore {
  get(key: string): ResponseData | undefined;
  set(key: string, data: ResponseData): void;
}

/**
 * What a real coil does with a pulse at a note, in the steady state of that
 * note (its bangs following each other at the note's rate): the energy its
 * arcs take, the channel they grow, and how the bang ends (in the air, cut by
 * the OCD, or a strike on the ground). The middle arc of the model, the
 * sheet's bus, its ground mat and ring.
 *
 * Read many times a second (the simulation, the synth): worked out once per
 * sheet on a grid of pulses × note rates (~0.2 s, some 650 bangs), then
 * interpolated. Kept by sheet: the latest few in memory, and in `store`
 * across sessions; a worker that worked one out hands its data over (`seed`).
 */
export class PhyResponse implements CoilResponse {
  /** Note rates of the grid (Hz), from the lowest bass to the top of the keyboard. */
  static readonly RATES = [27.5, 40, 55, 80, 110, 160, 220, 320, 440, 640, 880, 1300, 1760, 2600, 4200];
  /** Pulses of the grid (µs). */
  static readonly PULSES = [2, 4, 6, 8, 10, 13, 16, 20, 25, 30, 36, 43, 50, 60, 70, 80, 95, 110, 130, 150, 175, 200, 240, 290, 350, 420, 500];
  /** Kept between sessions: set by the page. */
  static store: ResponseStore | null = null;
  /** The latest used, oldest first (a Map keeps its insertion order). */
  private static readonly cache = new Map<string, PhyResponse>();
  private static readonly KEEP = 32;

  private readonly logRates = PhyResponse.RATES.map(Math.log);

  private constructor(private readonly d: ResponseData) {}

  /** A sheet's key: the same sheet, the same response. */
  static keyOf(spec: CoilSpec): string {
    return JSON.stringify(spec);
  }

  /** A sheet's response, worked out on first use and kept while the sheet stays the same. */
  static of(spec: CoilSpec): PhyResponse {
    const hit = PhyResponse.cached(spec);
    if (hit) return hit;
    const key = PhyResponse.keyOf(spec), data = PhyResponse.compute(spec);
    PhyResponse.store?.set(key, data);
    return PhyResponse.keep(key, new PhyResponse(data));
  }

  /** A sheet's response when it is already worked out (here or in the store); null: it isn't. */
  static cached(spec: CoilSpec): PhyResponse | null {
    const key = PhyResponse.keyOf(spec);
    const hit = PhyResponse.cache.get(key);
    if (hit) return PhyResponse.keep(key, hit);
    const stored = PhyResponse.store?.get(key);
    return stored ? PhyResponse.keep(key, new PhyResponse(stored)) : null;
  }

  /** A response worked out elsewhere (a worker): kept as if worked out here. */
  static seed(key: string, data: ResponseData): PhyResponse {
    PhyResponse.store?.set(key, data);
    return PhyResponse.keep(key, new PhyResponse(data));
  }

  /** The grid and the thresholds of a sheet: the costly part, done once a sheet. */
  static compute(spec: CoilSpec): ResponseData {
    const coil = new PhyCoil(spec), m = coil.tank();
    const a = new PhyArcLoad('milieu', coil.sheetRod.breakout().mid, coil.strikeLength());
    const run = (us: number, hz: number): BangResult => m.steady(a, us * 1e-6, hz);
    const E = PhyResponse.RATES.map((hz) => PhyResponse.PULSES.map((us) => run(us, hz)));
    return {
      e: E.map((row) => row.map((o) => o.eArc)),
      l: E.map((row) => row.map((o) => o.l)),
      ocd: PhyResponse.RATES.map((hz, r) => PhyResponse.threshold(E[r].map((o) => o.ocdAt != null), (us) => run(us, hz).ocdAt != null)),
      strike: PhyResponse.RATES.map((hz, r) => PhyResponse.threshold(E[r].map((o) => o.struck), (us) => run(us, hz).struck)),
      // the arc's onset, found as finely: the grid's steps would blur it over a few µs
      arc: PhyResponse.RATES.map((hz, r) => PhyResponse.threshold(E[r].map((o) => o.eArc > 0), (us) => run(us, hz).eArc > 0)),
    };
  }

  private static keep(key: string, r: PhyResponse): PhyResponse {
    PhyResponse.cache.delete(key);
    PhyResponse.cache.set(key, r);
    if (PhyResponse.cache.size > PhyResponse.KEEP) PhyResponse.cache.delete(PhyResponse.cache.keys().next().value as string);
    return r;
  }

  /** Its data, for a store or another thread. */
  toData(): ResponseData {
    return this.d;
  }

  private static edges(grid: readonly number[], v: number): [number, number, number] {
    if (v <= grid[0]) return [0, 0, 0];
    const last = grid.length - 1;
    if (v >= grid[last]) return [last, last, 0];
    let i = 1;
    while (grid[i] < v) i++;
    return [i - 1, i, (v - grid[i - 1]) / (grid[i] - grid[i - 1])];
  }

  /** The first pulse where `hit` holds, to 1 µs, from the grid's row; Infinity when it holds nowhere on it. */
  private static threshold(row: readonly boolean[], hit: (us: number) => boolean): number {
    const P = PhyResponse.PULSES;
    const k = row.indexOf(true);
    if (k < 0) return Infinity;
    if (k === 0) return P[0];
    let lo = P[k - 1], hi = P[k];
    while (hi - lo > 1) {
      const mid = (lo + hi) / 2;
      if (hit(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  // bound: the figures pass them around as functions of the rate
  readonly ocdFrom = (hz: number): number => this.along(this.d.ocd, hz);
  readonly strikeFrom = (hz: number): number => this.along(this.d.strike, hz);
  readonly arcFrom = (hz: number): number => this.along(this.d.arc, hz);

  readonly at = (pulseUs: number, hz: number): BangPoint => {
    if (!(pulseUs > 0) || !(hz > 0) || pulseUs < this.arcFrom(hz)) return { e: 0, l: 0, fate: 'short' };
    const arc = this.d.arc, P = PhyResponse.PULSES;
    const [r0, r1, wr] = this.rateEdges(hz);
    const [p0, p1, wp] = PhyResponse.edges(P, pulseUs);
    // along a rate's row; past the grid's longest pulse the arc saturates: held there. Just past
    // the onset, from nothing at the onset itself, not from a grid point that has no arc
    const row = (r: number, g: number[][]): number => {
      if (pulseUs < arc[r]) return 0;
      const hi = g[r][p1];
      if (p1 !== p0 && P[p0] < arc[r]) return hi * Math.min(1, (pulseUs - arc[r]) / (P[p1] - arc[r]));
      const lo = g[r][p0];
      return lo + (hi - lo) * wp;
    };
    const lerp = (g: number[][]) => row(r0, g) + (row(r1, g) - row(r0, g)) * wr;
    const fate: BangFate = pulseUs >= this.strikeFrom(hz) ? 'strike' : pulseUs >= this.ocdFrom(hz) ? 'ocd' : 'air';
    return { e: lerp(this.d.e), l: lerp(this.d.l), fate };
  };

  private rateEdges(hz: number): [number, number, number] {
    return PhyResponse.edges(this.logRates, Math.log(Math.max(1, hz)));
  }

  // a threshold between two rates: interpolated on log rate, Infinity on either side keeps it out
  private along(row: readonly number[], hz: number): number {
    const [i, j, w] = this.rateEdges(hz);
    if (!Number.isFinite(row[i]) || !Number.isFinite(row[j])) return w < 0.5 ? row[i] : row[j];
    return row[i] + (row[j] - row[i]) * w;
  }
}
