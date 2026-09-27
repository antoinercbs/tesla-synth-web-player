import {
  CUSTOM_PROGRAM_MAX,
  CUSTOM_PROGRAM_MIN,
  ENVELOPE_STEP_COUNT,
  RELEASE_STEP,
  programSteps,
  stepsAmplitude,
  type EnvStep,
} from '@/sysex/envelopes';

/** Where a step's handle sits on the held-note curve: it reaches `amp` at `t`. */
export interface ChainPoint {
  step: number;
  t: number;
  amp: number;
}

/**
 * The first pass over the steps from note-on, as the firmware plays them while
 * the note is held: 0 → next → … until a step repeats (sustain on itself, or a
 * loop back) or the chain jumps to the release.
 */
export interface StepChain {
  points: ChainPoint[];
  /** The step that holds until note-off, when the chain ends on a self-loop. */
  sustain: number | null;
  /** The step the chain jumps back to, when it loops. */
  loopTo: number | null;
  loopSteps: Set<number>;
  /** Steps a held note ever plays (the release always counts). */
  reachable: Set<number>;
}

export function walkChain(steps: readonly EnvStep[]): StepChain {
  const points: ChainPoint[] = [];
  const seenAt = new Map<number, number>();
  let cur = 0;
  let t = 0;
  let sustain: number | null = null;
  let loopTo: number | null = null;
  while (cur !== RELEASE_STEP && !seenAt.has(cur)) {
    seenAt.set(cur, points.length);
    t += Math.max(0, steps[cur].durMs);
    points.push({ step: cur, t, amp: steps[cur].amp });
    const next = steps[cur].next;
    if (next === cur) {
      sustain = cur;
      break;
    }
    if (seenAt.has(next)) {
      loopTo = next;
      break;
    }
    cur = next;
  }
  const loopSteps = new Set<number>();
  if (loopTo != null) for (let i = seenAt.get(loopTo)!; i < points.length; i++) loopSteps.add(points[i].step);
  const reachable = new Set(points.map((p) => p.step));
  reachable.add(RELEASE_STEP);
  return { points, sustain, loopTo, loopSteps, reachable };
}

export type StepRole = 'attack' | 'decay' | 'sustain' | 'loop' | 'unused' | 'release';

/** A replayed or held first step is named for that, not as the attack. */
export function stepRole(step: number, chain: StepChain): StepRole {
  if (step === RELEASE_STEP) return 'release';
  if (!chain.reachable.has(step)) return 'unused';
  if (chain.loopSteps.has(step)) return 'loop';
  if (chain.sustain === step) return 'sustain';
  if (step === 0) return 'attack';
  return 'decay';
}

/** Highest multiplier a held note reaches (never below the nominal 1). */
export function peakAmplitude(steps: readonly EnvStep[]): number {
  return walkChain(steps).points.reduce((m, p) => Math.max(m, p.amp), 1);
}

export function firstFreeProgram(taken: Iterable<number>): number | null {
  const used = new Set(taken);
  for (let p = CUSTOM_PROGRAM_MIN; p <= CUSTOM_PROGRAM_MAX; p++) if (!used.has(p)) return p;
  return null;
}

export function cloneSteps(steps: readonly EnvStep[]): EnvStep[] {
  return steps.map((s) => ({ ...s }));
}

/** What a new envelope starts from: the firmware's piano (P1). */
export function starterSteps(): EnvStep[] {
  return normalizeSteps(programSteps(1));
}

/* ---------------------------------------------------------------------------
 * The editor's view of an envelope: steps in playing order, what a held note
 * does after the last one, and the release. Every firmware table maps onto it
 * without changing the sound (steps the chain never reaches are dropped), and
 * back onto a table where step i leads to step i+1.
 * ------------------------------------------------------------------------- */
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
export const MAX_PHASES = ENVELOPE_STEP_COUNT - 1;

export function toShape(steps: readonly EnvStep[]): EnvShape {
  const chain = walkChain(steps);
  const phases = chain.points.map(({ step }) => ({ amp: steps[step].amp, durMs: steps[step].durMs, ntau: steps[step].ntau }));
  const end: HeldEnd =
    chain.sustain != null
      ? { kind: 'hold' }
      : chain.loopTo != null
        ? { kind: 'loop', from: chain.points.findIndex((p) => p.step === chain.loopTo) }
        : { kind: 'release' };
  const r = steps[RELEASE_STEP];
  return { phases, end, release: { durMs: r.durMs, ntau: r.ntau } };
}

export function toSteps(shape: EnvShape): EnvStep[] {
  const last = shape.phases.length - 1;
  const end = shape.end.kind === 'loop' && (last < 1 || shape.end.from >= last) ? { kind: 'hold' as const } : shape.end;
  const lastNext = end.kind === 'hold' ? last : end.kind === 'loop' ? end.from : RELEASE_STEP;
  const steps: EnvStep[] = [];
  for (let i = 0; i < RELEASE_STEP; i++) {
    if (i <= last) steps.push({ ...shape.phases[i], next: i < last ? i + 1 : lastNext });
    else steps.push({ ...shape.phases[last], durMs: 0, next: i }); // never reached: parked on itself
  }
  steps.push({ amp: 0, durMs: shape.release.durMs, ntau: shape.release.ntau, next: RELEASE_STEP });
  return steps;
}

/** The same sound, laid out the way the editor writes it (step i → i+1). */
export function normalizeSteps(steps: readonly EnvStep[]): EnvStep[] {
  return toSteps(toShape(steps));
}

const roundAmp = (a: number): number => Math.round(a * 100) / 100;
const roundDur = (ms: number): number => (ms < 10 ? Math.round(ms * 10) / 10 : Math.round(ms));

/**
 * A new step at `tMs` of the held note: the step under it is cut in two there,
 * so the curve keeps its points; past the last step, a new last one. Null when
 * the envelope is full.
 */
export function splitAt(shape: EnvShape, tMs: number): EnvShape | null {
  if (shape.phases.length >= MAX_PHASES || !(tMs > 0)) return null;
  const steps = toSteps(shape);
  const phases = shape.phases.map((p) => ({ ...p }));
  let acc = 0;
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    if (tMs < acc + p.durMs) {
      const before = tMs - acc;
      phases.splice(i, 0, { amp: roundAmp(stepsAmplitude(steps, tMs, null)), durMs: roundDur(before), ntau: p.ntau });
      p.durMs = roundDur(p.durMs - before);
      const end: HeldEnd = shape.end.kind === 'loop' && shape.end.from > i ? { kind: 'loop', from: shape.end.from + 1 } : shape.end;
      return { ...shape, phases, end };
    }
    acc += p.durMs;
  }
  const last = phases[phases.length - 1];
  phases.push({ amp: last.amp, durMs: roundDur(Math.max(1, tMs - acc)), ntau: last.ntau });
  return { ...shape, phases };
}

export function appendPhase(shape: EnvShape): EnvShape {
  if (shape.phases.length >= MAX_PHASES) return shape;
  const last = shape.phases[shape.phases.length - 1];
  return { ...shape, phases: [...shape.phases, { amp: last.amp, durMs: 200, ntau: last.ntau }] };
}

/** A loop keeps covering the steps it did; with fewer than 2 steps left it becomes a hold. */
export function removePhase(shape: EnvShape, index: number): EnvShape {
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
export function withEnd(shape: EnvShape, kind: HeldEndKind): EnvShape {
  if (kind !== 'loop') return { ...shape, end: { kind } };
  if (shape.phases.length < 2) return shape;
  const from = shape.end.kind === 'loop' ? shape.end.from : shape.phases.length >= 3 ? 1 : 0;
  return { ...shape, end: { kind: 'loop', from } };
}

export function sameSteps(a: readonly EnvStep[], b: readonly EnvStep[]): boolean {
  return (
    a.length === ENVELOPE_STEP_COUNT &&
    b.length === ENVELOPE_STEP_COUNT &&
    a.every((s, i) => s.next === b[i].next && s.amp === b[i].amp && s.durMs === b[i].durMs && s.ntau === b[i].ntau)
  );
}
