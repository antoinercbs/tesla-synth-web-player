import { describe, it, expect } from 'vitest';
import { SndEnvPrograms, type EnvStep } from '@/model/sysex/envelopes';
import { MAX_PHASES, SndChain, SndEnvelope, SndEnvShape, type EnvShape } from '.';

const step = (amp: number, durMs: number, next: number, ntau = 1): EnvStep => ({ amp, durMs, next, ntau });
// attack → 1 ⇄ 2 loop, steps 3-6 never reached
const PULSE: EnvStep[] = [
  step(1, 6, 1), step(0.25, 90, 2), step(1, 90, 1),
  step(1, 0, 3), step(1, 0, 4), step(1, 0, 5), step(1, 0, 6),
  step(0, 60, 7),
];

describe('SndChain', () => {
  it('follows a piano to its sustain, with the handles at cumulated times', () => {
    const c = new SndChain(SndEnvPrograms.steps(1)); // 0 (30 ms) → 1 (10 ms) → 2 sustains
    expect(c.points.map((p) => [p.step, p.t])).toEqual([[0, 30], [1, 40], [2, 3540]]);
    expect(c.sustain).toBe(2);
    expect(c.loopTo).toBeNull();
    expect([...c.reachable].sort()).toEqual([0, 1, 2, 7]);
  });

  it('spots a loop and the steps it goes through', () => {
    const c = new SndChain(PULSE);
    expect(c.loopTo).toBe(1);
    expect([...c.loopSteps].sort()).toEqual([1, 2]);
    expect(c.sustain).toBeNull();
  });

  it('stops at the release when a step jumps to it (forced staccato)', () => {
    const s = SndEnvelope.starter();
    s[1].next = 7;
    const c = new SndChain(s);
    expect(c.points.map((p) => p.step)).toEqual([0, 1]);
    expect(c.reachable.has(2)).toBe(false);
  });
});

describe('SndChain.role', () => {
  it('names every column of the editor', () => {
    const c = new SndChain(PULSE);
    expect([0, 1, 2, 3, 7].map((i) => c.role(i))).toEqual(['attack', 'loop', 'loop', 'unused', 'release']);
    const piano = new SndChain(SndEnvPrograms.steps(1));
    expect([1, 2].map((i) => piano.role(i))).toEqual(['decay', 'sustain']);
    expect(new SndChain(SndEnvPrograms.steps(0)).role(0)).toBe('sustain'); // a single held step
    const noAttack = new SndEnvShape(new SndEnvelope(PULSE).shape).removePhase(0);
    const fromFirst = new SndEnvShape(new SndEnvShape(noAttack).withEnd('loop')).steps();
    expect(new SndChain(fromFirst).role(0)).toBe('loop');
  });
});

describe('SndEnvelope.peak', () => {
  it('reports the punch of P8/P9 and never less than the nominal', () => {
    expect(new SndEnvelope(SndEnvPrograms.steps(9)).peak).toBe(3);
    expect(new SndEnvelope(SndEnvPrograms.steps(2)).peak).toBe(1);
    // an unreachable step does not count
    const s = SndEnvelope.starter();
    s[5].amp = 9;
    expect(new SndEnvelope(s).peak).toBe(1);
  });
});

describe('SndEnvelope.freeProgram', () => {
  it('takes the lowest free slot of 20-63', () => {
    expect(SndEnvelope.freeProgram([])).toBe(20);
    expect(SndEnvelope.freeProgram([20, 21, 23])).toBe(22);
    expect(SndEnvelope.freeProgram(Array.from({ length: 44 }, (_, i) => 20 + i))).toBeNull();
  });
});

/** Same amplitude over time for held notes and for notes released at various points. */
function soundsAlike(a: readonly EnvStep[], b: readonly EnvStep[]): boolean {
  for (const releaseAt of [null, 5, 40, 250, 1200, 6000]) {
    for (let t = 0; t <= 9000; t += 7) {
      if (Math.abs(new SndEnvelope(a).amplitude(t, releaseAt) - new SndEnvelope(b).amplitude(t, releaseAt)) > 1e-9) return false;
    }
  }
  return true;
}

describe('SndEnvelope.shape / SndEnvShape.steps', () => {
  it('reads the piano as 3 steps then a hold, and the release apart', () => {
    const s = new SndEnvelope(SndEnvPrograms.steps(1)).shape;
    expect(s.phases.map((p) => p.durMs)).toEqual([30, 10, 3500]);
    expect(s.end).toEqual({ kind: 'hold' });
    expect(s.release).toEqual({ durMs: 10, ntau: 0.1 });
  });

  it('reads a loop with its first step, and a chain into the release as a one-shot', () => {
    expect(new SndEnvelope(PULSE).shape.end).toEqual({ kind: 'loop', from: 1 });
    const staccato = SndEnvelope.starter();
    staccato[1].next = 7;
    expect(new SndEnvelope(staccato).shape).toMatchObject({ end: { kind: 'release' }, phases: [{}, {}] });
  });

  it('keeps the sound of every firmware envelope and of odd hand-made tables', () => {
    for (let p = 0; p <= 19; p++) expect(soundsAlike(SndEnvPrograms.steps(p), new SndEnvelope(SndEnvPrograms.steps(p)).normalized())).toBe(true);
    expect(soundsAlike(PULSE, new SndEnvelope(PULSE).normalized())).toBe(true);
    // a chain that skips steps: 0 → 4 → 2 → back to 4
    const skipping = SndEnvelope.starter();
    skipping[0].next = 4;
    skipping[4] = step(0.6, 50, 2, 2);
    skipping[2] = step(0.2, 80, 4, 1);
    const normalized = new SndEnvelope(skipping).normalized();
    expect(soundsAlike(skipping, normalized)).toBe(true);
    expect(normalized.slice(0, 3).map((s) => s.next)).toEqual([1, 2, 1]);
  });

  it('writes step i → i+1, the end on the last step, and parks the unused ones', () => {
    const shape: EnvShape = { phases: [{ amp: 1, durMs: 5, ntau: 1 }, { amp: 0.5, durMs: 50, ntau: 1 }, { amp: 1, durMs: 50, ntau: 1 }], end: { kind: 'loop', from: 1 }, release: { durMs: 30, ntau: 2 } };
    const steps = new SndEnvShape(shape).steps();
    expect(steps.map((s) => s.next)).toEqual([1, 2, 1, 3, 4, 5, 6, 7]);
    expect(steps[7]).toEqual({ amp: 0, durMs: 30, ntau: 2, next: 7 });
    expect(new SndEnvShape({ ...shape, end: { kind: 'release' } }).steps()[2].next).toBe(7);
    // a loop from the last step onto itself is a hold
    expect(new SndEnvShape({ ...shape, end: { kind: 'loop', from: 2 } }).steps()[2].next).toBe(2);
  });
});

describe('editing the shape', () => {
  const piano = (): EnvShape => new SndEnvelope(SndEnvPrograms.steps(1)).shape;

  it('cuts the step under a double-click without moving the curve', () => {
    const before = piano();
    const after = new SndEnvShape(before).splitAt(1000)!;
    expect(after.phases).toHaveLength(4);
    expect(after.phases[2].durMs + after.phases[3].durMs).toBeCloseTo(3500, 0);
    const a = new SndEnvShape(before).steps();
    const b = new SndEnvShape(after).steps();
    expect(new SndEnvelope(b).amplitude(1000, null)).toBeCloseTo(new SndEnvelope(a).amplitude(1000, null), 2);
  });

  it('adds past the end, shifts a loop that starts later, and refuses a full envelope', () => {
    expect(new SndEnvShape(piano()).splitAt(9000)!.phases).toHaveLength(4);
    const loop = new SndEnvelope(PULSE).shape;
    expect(new SndEnvShape(loop).splitAt(3)!.end).toEqual({ kind: 'loop', from: 2 });
    let full = piano();
    while (full.phases.length < MAX_PHASES) full = new SndEnvShape(full).appendPhase();
    expect(new SndEnvShape(full).splitAt(10)).toBeNull();
    expect(new SndEnvShape(full).appendPhase()).toBe(full);
  });

  it('keeps a loop sensible when steps go away', () => {
    const loop = new SndEnvelope(PULSE).shape; // loop over steps 2-3
    const noAttack = new SndEnvShape(loop).removePhase(0); // the loop still covers the same two steps, now 1-2
    expect(noAttack.end).toEqual({ kind: 'loop', from: 0 });
    expect(new SndEnvShape(noAttack).removePhase(1).end).toEqual({ kind: 'hold' }); // a single step cannot loop
    expect(new SndEnvShape(new SndEnvelope(SndEnvPrograms.steps(0)).shape).removePhase(0).phases).toHaveLength(1); // never below one step
  });

  it('starts a new loop after the attack when it can', () => {
    expect(new SndEnvShape(piano()).withEnd('loop').end).toEqual({ kind: 'loop', from: 1 });
    const two = new SndEnvShape(piano()).removePhase(2);
    expect(new SndEnvShape(two).withEnd('loop').end).toEqual({ kind: 'loop', from: 0 });
    expect(new SndEnvShape(new SndEnvelope(SndEnvPrograms.steps(0)).shape).withEnd('loop').end).toEqual({ kind: 'hold' }); // one step: nothing to loop
  });
});

describe('SndEnvelope.same', () => {
  it('compares tables field by field', () => {
    const a = SndEnvelope.starter();
    const b = SndEnvelope.starter();
    expect(new SndEnvelope(a).same(b)).toBe(true);
    b[3].ntau += 0.5;
    expect(new SndEnvelope(a).same(b)).toBe(false);
  });
});
