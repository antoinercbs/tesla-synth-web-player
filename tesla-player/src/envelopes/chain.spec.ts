import { describe, it, expect } from 'vitest';
import { programSteps, stepsAmplitude, type EnvStep } from '@/sysex/envelopes';
import {
  MAX_PHASES,
  appendPhase,
  firstFreeProgram,
  normalizeSteps,
  peakAmplitude,
  removePhase,
  sameSteps,
  splitAt,
  starterSteps,
  stepRole,
  toShape,
  toSteps,
  walkChain,
  withEnd,
  type EnvShape,
} from './chain';

const step = (amp: number, durMs: number, next: number, ntau = 1): EnvStep => ({ amp, durMs, next, ntau });
// attack → 1 ⇄ 2 loop, steps 3-6 never reached
const PULSE: EnvStep[] = [
  step(1, 6, 1), step(0.25, 90, 2), step(1, 90, 1),
  step(1, 0, 3), step(1, 0, 4), step(1, 0, 5), step(1, 0, 6),
  step(0, 60, 7),
];

describe('walkChain', () => {
  it('follows a piano to its sustain, with the handles at cumulated times', () => {
    const c = walkChain(programSteps(1)); // 0 (30 ms) → 1 (10 ms) → 2 sustains
    expect(c.points.map((p) => [p.step, p.t])).toEqual([[0, 30], [1, 40], [2, 3540]]);
    expect(c.sustain).toBe(2);
    expect(c.loopTo).toBeNull();
    expect([...c.reachable].sort()).toEqual([0, 1, 2, 7]);
  });

  it('spots a loop and the steps it goes through', () => {
    const c = walkChain(PULSE);
    expect(c.loopTo).toBe(1);
    expect([...c.loopSteps].sort()).toEqual([1, 2]);
    expect(c.sustain).toBeNull();
  });

  it('stops at the release when a step jumps to it (forced staccato)', () => {
    const s = starterSteps();
    s[1].next = 7;
    const c = walkChain(s);
    expect(c.points.map((p) => p.step)).toEqual([0, 1]);
    expect(c.reachable.has(2)).toBe(false);
  });
});

describe('stepRole', () => {
  it('names every column of the editor', () => {
    const c = walkChain(PULSE);
    expect([0, 1, 2, 3, 7].map((i) => stepRole(i, c))).toEqual(['attack', 'loop', 'loop', 'unused', 'release']);
    const piano = walkChain(programSteps(1));
    expect([1, 2].map((i) => stepRole(i, piano))).toEqual(['decay', 'sustain']);
    expect(stepRole(0, walkChain(programSteps(0)))).toBe('sustain'); // a single held step
    const fromFirst = toSteps(withEnd(removePhase(toShape(PULSE), 0), 'loop'));
    expect(stepRole(0, walkChain(fromFirst))).toBe('loop');
  });
});

describe('peakAmplitude', () => {
  it('reports the punch of P8/P9 and never less than the nominal', () => {
    expect(peakAmplitude(programSteps(9))).toBe(3);
    expect(peakAmplitude(programSteps(2))).toBe(1);
    // an unreachable step does not count
    const s = starterSteps();
    s[5].amp = 9;
    expect(peakAmplitude(s)).toBe(1);
  });
});

describe('firstFreeProgram', () => {
  it('takes the lowest free slot of 20-63', () => {
    expect(firstFreeProgram([])).toBe(20);
    expect(firstFreeProgram([20, 21, 23])).toBe(22);
    expect(firstFreeProgram(Array.from({ length: 44 }, (_, i) => 20 + i))).toBeNull();
  });
});

/** Same amplitude over time for held notes and for notes released at various points. */
function soundsAlike(a: readonly EnvStep[], b: readonly EnvStep[]): boolean {
  for (const releaseAt of [null, 5, 40, 250, 1200, 6000]) {
    for (let t = 0; t <= 9000; t += 7) {
      if (Math.abs(stepsAmplitude(a, t, releaseAt) - stepsAmplitude(b, t, releaseAt)) > 1e-9) return false;
    }
  }
  return true;
}

describe('toShape / toSteps', () => {
  it('reads the piano as 3 steps then a hold, and the release apart', () => {
    const s = toShape(programSteps(1));
    expect(s.phases.map((p) => p.durMs)).toEqual([30, 10, 3500]);
    expect(s.end).toEqual({ kind: 'hold' });
    expect(s.release).toEqual({ durMs: 10, ntau: 0.1 });
  });

  it('reads a loop with its first step, and a chain into the release as a one-shot', () => {
    expect(toShape(PULSE).end).toEqual({ kind: 'loop', from: 1 });
    const staccato = starterSteps();
    staccato[1].next = 7;
    expect(toShape(staccato)).toMatchObject({ end: { kind: 'release' }, phases: [{}, {}] });
  });

  it('keeps the sound of every firmware envelope and of odd hand-made tables', () => {
    for (let p = 0; p <= 19; p++) expect(soundsAlike(programSteps(p), normalizeSteps(programSteps(p)))).toBe(true);
    expect(soundsAlike(PULSE, normalizeSteps(PULSE))).toBe(true);
    // a chain that skips steps: 0 → 4 → 2 → back to 4
    const skipping = starterSteps();
    skipping[0].next = 4;
    skipping[4] = step(0.6, 50, 2, 2);
    skipping[2] = step(0.2, 80, 4, 1);
    const normalized = normalizeSteps(skipping);
    expect(soundsAlike(skipping, normalized)).toBe(true);
    expect(normalized.slice(0, 3).map((s) => s.next)).toEqual([1, 2, 1]);
  });

  it('writes step i → i+1, the end on the last step, and parks the unused ones', () => {
    const shape: EnvShape = { phases: [{ amp: 1, durMs: 5, ntau: 1 }, { amp: 0.5, durMs: 50, ntau: 1 }, { amp: 1, durMs: 50, ntau: 1 }], end: { kind: 'loop', from: 1 }, release: { durMs: 30, ntau: 2 } };
    const steps = toSteps(shape);
    expect(steps.map((s) => s.next)).toEqual([1, 2, 1, 3, 4, 5, 6, 7]);
    expect(steps[7]).toEqual({ amp: 0, durMs: 30, ntau: 2, next: 7 });
    expect(toSteps({ ...shape, end: { kind: 'release' } })[2].next).toBe(7);
    // a loop from the last step onto itself is a hold
    expect(toSteps({ ...shape, end: { kind: 'loop', from: 2 } })[2].next).toBe(2);
  });
});

describe('editing the shape', () => {
  const piano = (): EnvShape => toShape(programSteps(1));

  it('cuts the step under a double-click without moving the curve', () => {
    const before = piano();
    const after = splitAt(before, 1000)!;
    expect(after.phases).toHaveLength(4);
    expect(after.phases[2].durMs + after.phases[3].durMs).toBeCloseTo(3500, 0);
    const a = toSteps(before);
    const b = toSteps(after);
    expect(stepsAmplitude(b, 1000, null)).toBeCloseTo(stepsAmplitude(a, 1000, null), 2);
  });

  it('adds past the end, shifts a loop that starts later, and refuses a full envelope', () => {
    expect(splitAt(piano(), 9000)!.phases).toHaveLength(4);
    const loop = toShape(PULSE);
    expect(splitAt(loop, 3)!.end).toEqual({ kind: 'loop', from: 2 });
    let full = piano();
    while (full.phases.length < MAX_PHASES) full = appendPhase(full);
    expect(splitAt(full, 10)).toBeNull();
    expect(appendPhase(full)).toBe(full);
  });

  it('keeps a loop sensible when steps go away', () => {
    const loop = toShape(PULSE); // loop over steps 2-3
    const noAttack = removePhase(loop, 0); // the loop still covers the same two steps, now 1-2
    expect(noAttack.end).toEqual({ kind: 'loop', from: 0 });
    expect(removePhase(noAttack, 1).end).toEqual({ kind: 'hold' }); // a single step cannot loop
    expect(removePhase(toShape(programSteps(0)), 0).phases).toHaveLength(1); // never below one step
  });

  it('starts a new loop after the attack when it can', () => {
    expect(withEnd(piano(), 'loop').end).toEqual({ kind: 'loop', from: 1 });
    const two = removePhase(piano(), 2);
    expect(withEnd(two, 'loop').end).toEqual({ kind: 'loop', from: 0 });
    expect(withEnd(toShape(programSteps(0)), 'loop').end).toEqual({ kind: 'hold' }); // one step: nothing to loop
  });
});

describe('sameSteps', () => {
  it('compares tables field by field', () => {
    const a = starterSteps();
    const b = starterSteps();
    expect(sameSteps(a, b)).toBe(true);
    b[3].ntau += 0.5;
    expect(sameSteps(a, b)).toBe(false);
  });
});
