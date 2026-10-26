import { SndEnvPrograms, type EnvStep } from '@/model/sysex/envelopes';
import { SndEnvelope } from '@/model/envelopes/envelope';

export interface EnvPhase {
  amp: number;
  durMs: number;
  ntau: number;
}
export type HeldEnd = { kind: 'hold' } | { kind: 'loop'; from: number } | { kind: 'release' };
export type HeldEndKind = HeldEnd['kind'];
export interface EnvShape {
  phases: EnvPhase[];
  end: HeldEnd;
  release: { durMs: number; ntau: number };
}
/** The release takes the 8th of the firmware's steps. */
export const MAX_PHASES = SndEnvPrograms.STEP_COUNT - 1;

/**
 * The editor's view of an envelope: steps in playing order, what a held note
 * does after the last one, and the release. Every firmware table maps onto it
 * without changing the sound (steps the chain never reaches are dropped), and
 * back onto a table where step i leads to step i+1. Each change gives a new
 * shape, the one it was made from left as it was.
 */
export class SndEnvShape {
  private static roundAmp(a: number): number {
    return Math.round(a * 100) / 100;
  }

  private static roundDur(ms: number): number {
    return (ms < 10 ? Math.round(ms * 10) / 10 : Math.round(ms));
  }

  constructor(readonly shape: EnvShape) {}

  /** The firmware's table: step i leads to step i+1. */
  steps(): EnvStep[] {
    const shape = this.shape, last = shape.phases.length - 1;
    const end = shape.end.kind === 'loop' && (last < 1 || shape.end.from >= last) ? { kind: 'hold' as const } : shape.end;
    const lastNext = end.kind === 'hold' ? last : end.kind === 'loop' ? end.from : SndEnvPrograms.RELEASE_STEP;
    const steps: EnvStep[] = [];
    for (let i = 0; i < SndEnvPrograms.RELEASE_STEP; i++) {
      if (i <= last) steps.push({ ...shape.phases[i], next: i < last ? i + 1 : lastNext });
      else steps.push({ ...shape.phases[last], durMs: 0, next: i }); // never reached: parked on itself
    }
    steps.push({ amp: 0, durMs: shape.release.durMs, ntau: shape.release.ntau, next: SndEnvPrograms.RELEASE_STEP });
    return steps;
  }

  /**
   * A new step at `tMs` of the held note: the step under it is cut in two there,
   * so the curve keeps its points; past the last step, a new last one. Null when
   * the envelope is full.
   */
  splitAt(tMs: number): EnvShape | null {
    const shape = this.shape;
    if (shape.phases.length >= MAX_PHASES || !(tMs > 0)) return null;
    const steps = this.steps();
    const phases = shape.phases.map((p) => ({ ...p }));
    let acc = 0;
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i];
      if (tMs < acc + p.durMs) {
        const before = tMs - acc;
        phases.splice(i, 0, { amp: SndEnvShape.roundAmp(new SndEnvelope(steps).amplitude(tMs, null)), durMs: SndEnvShape.roundDur(before), ntau: p.ntau });
        p.durMs = SndEnvShape.roundDur(p.durMs - before);
        const end: HeldEnd = shape.end.kind === 'loop' && shape.end.from > i ? { kind: 'loop', from: shape.end.from + 1 } : shape.end;
        return { ...shape, phases, end };
      }
      acc += p.durMs;
    }
    const last = phases[phases.length - 1];
    phases.push({ amp: last.amp, durMs: SndEnvShape.roundDur(Math.max(1, tMs - acc)), ntau: last.ntau });
    return { ...shape, phases };
  }

  appendPhase(): EnvShape {
    const shape = this.shape;
    if (shape.phases.length >= MAX_PHASES) return shape;
    const last = shape.phases[shape.phases.length - 1];
    return { ...shape, phases: [...shape.phases, { amp: last.amp, durMs: 200, ntau: last.ntau }] };
  }

  /** A loop keeps covering the steps it did; with fewer than 2 steps left it becomes a hold. */
  removePhase(index: number): EnvShape {
    const shape = this.shape;
    if (shape.phases.length <= 1) return shape;
    const phases = shape.phases.filter((_, i) => i !== index);
    let end = shape.end;
    if (end.kind === 'loop') {
      const from = end.from > index ? end.from - 1 : end.from;
      end = phases.length < 2 ? { kind: 'hold' } : { kind: 'loop', from: Math.min(from, phases.length - 2) };
    }
    return { ...shape, phases, end };
  }

  /** A new loop skips the attack when there is enough to loop over. */
  withEnd(kind: HeldEndKind): EnvShape {
    const shape = this.shape;
    if (kind !== 'loop') return { ...shape, end: { kind } };
    if (shape.phases.length < 2) return shape;
    const from = shape.end.kind === 'loop' ? shape.end.from : shape.phases.length >= 3 ? 1 : 0;
    return { ...shape, end: { kind: 'loop', from } };
  }
}
