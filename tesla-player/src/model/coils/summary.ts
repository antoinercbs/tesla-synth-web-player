import type { CoilSpec } from '@/model/coils/spec';
import { PhyArcLoad, PhyCoil, type ArcCorner, type BangResult, type PhyTank } from './physics';
import { PhyResponse } from './response';
import { MidNote } from '@/model/midi/note';

/** The note the sheet's figures are given at, unless one is chosen. */
export const REF_HZ = 220;

/**
 * The notes a coil's arcs are measured at in the list, the same for every coil
 * so that they compare: C1 to C7, the bass's longest, the top's shortest.
 */
const ARC_NOTES = [24, 36, 48, 57, 60, 72, 84, 96];

/** What a coil's card and sheet show of it, the middle arc unless told otherwise. */
export interface CoilSummary {
  model: PhyTank;
  /** At its max: the board's max ontime at the rate where its max duty is reached. */
  maxHz: number;
  /** In the air: the channel the arcs grow (m), the energy they take. */
  max: BangResult;
  /** Power into the arcs at its max (W): its loudness, against another coil's. */
  powerW: number;
  /** The arc's length that reaches the ground, mat or ring (m). */
  strikeLen: number;
  /**
   * At its max (the board's max ontime, less where its max duty imposes it), the
   * arcs as they'd grow in the air (m): in the bass, their longest; at C7.
   */
  arcs: { bass: number; treble: number };
  /** At the reference note (µs): no arc under it. */
  arcFrom: number;
  /** At the reference note (µs): from it the arcs strike the ground (the OCD trips with them); null: not up to its max. */
  strikeFrom: number | null;
}

/** What a coil's card and sheet show of it (CoilSummary), from its sheet. */
export class PhySummary {
  private static readonly cache = new Map<string, CoilSummary>();

  /** A sheet's summary, worked out once per sheet and arc. */
  static of(spec: CoilSpec, corner: ArcCorner = 'milieu'): CoilSummary {
    const key = `${corner}:${JSON.stringify(spec)}`;
    const hit = PhySummary.cache.get(key);
    if (hit) return hit;
    const out = PhySummary.compute(spec, corner);
    if (PhySummary.cache.size > 64) PhySummary.cache.clear();
    PhySummary.cache.set(key, out);
    return out;
  }

  private static compute(spec: CoilSpec, corner: ArcCorner): CoilSummary {
    const coil = new PhyCoil(spec), model = coil.tank();
    const a = new PhyArcLoad(corner, coil.sheetRod.breakout().mid);
    const maxHz = spec.board.duty / (spec.board.ontime * 1e-6);
    const max = model.steady(a, spec.board.ontime * 1e-6, maxHz);
    const ls = ARC_NOTES.map((n) => model.steady(a, coil.pulseUs(spec.board.ontime, MidNote.hz(n)) * 1e-6, MidNote.hz(n)).l);
    const r = PhyResponse.of(spec);
    const strike = r.strikeFrom(REF_HZ);
    return {
      model, maxHz, max, powerW: max.eArc * maxHz,
      strikeLen: coil.strikeLength(),
      arcs: { bass: Math.max(...ls), treble: ls[ls.length - 1] },
      arcFrom: r.arcFrom(REF_HZ),
      strikeFrom: Number.isFinite(strike) && strike <= spec.board.ontime ? strike : null,
    };
  }
}
