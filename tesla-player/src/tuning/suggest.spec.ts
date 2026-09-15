import { describe, expect, it } from 'vitest';
import type { Trial } from './api';
import { bestTrial, snap, suggestNextTap } from './suggest';

function trial(tapTurns: number, score: number): Trial {
  return { id: String(tapTurns), at: 0, tapTurns, notes: [], score, sigmaMedian: null };
}

describe('suggestNextTap', () => {
  it('starts with the ends and the middle of the range', () => {
    const s0 = suggestNextTap([], 4, 8, 0.125);
    expect(s0).toEqual({ tapTurns: 4, kind: 'coarse' });
    const s1 = suggestNextTap([trial(4, 10)], 4, 8, 0.125);
    expect(s1).toEqual({ tapTurns: 8, kind: 'coarse' });
    const s2 = suggestNextTap([trial(4, 10), trial(8, 12)], 4, 8, 0.125);
    expect(s2).toEqual({ tapTurns: 6, kind: 'coarse' });
  });

  it('fills the half-turn grid, then refines around the best at the tap step', () => {
    let trials = [trial(4, 10), trial(8, 12), trial(6, 30)];
    const seen = new Set(trials.map((t) => t.tapTurns));
    // coarse pass: every remaining half-turn point gets proposed once
    for (let i = 0; i < 6; i++) {
      const s = suggestNextTap(trials, 4, 8, 0.125);
      expect(s.kind).toBe('coarse');
      expect(seen.has(s.tapTurns)).toBe(false);
      expect((s.tapTurns * 2) % 1).toBe(0);
      seen.add(s.tapTurns);
      trials = [...trials, trial(s.tapTurns, s.tapTurns === 6.5 ? 35 : 20)];
    }
    const fine = suggestNextTap(trials, 4, 8, 0.125);
    expect(fine.kind).toBe('fine');
    expect(Math.abs(fine.tapTurns - 6.5)).toBeCloseTo(0.125, 6);
  });

  it('names the parabola vertex once the neighbours are known, then reports done', () => {
    const trials = [trial(6.25, 30), trial(6.375, 34), trial(6.5, 35), trial(6.625, 33), trial(6.75, 28),
      trial(4, 5), trial(4.5, 8), trial(5, 12), trial(5.5, 18), trial(6, 26), trial(7, 20), trial(7.5, 12), trial(8, 6)];
    const s = suggestNextTap(trials, 4, 8, 0.125);
    // vertex of the parabola through (6.375,34) (6.5,35) (6.625,33) is a bit below 6.5 → snaps to 6.5 (tested) or 6.375 (tested)
    expect(['optimum', 'done']).toContain(s.kind);
    expect(s.tapTurns).toBeGreaterThanOrEqual(6.375);
    expect(s.tapTurns).toBeLessThanOrEqual(6.5);
  });

  it('snaps to the step inside the range', () => {
    expect(snap(5.3, 0.125, 4, 8)).toBe(5.25);
    expect(snap(9, 0.125, 4, 8)).toBe(8);
    expect(snap(3, 0.125, 4, 8)).toBe(4);
  });

  it('bestTrial picks the highest score', () => {
    expect(bestTrial([trial(4, 1), trial(5, 9), trial(6, 3)])?.tapTurns).toBe(5);
    expect(bestTrial([])).toBeNull();
  });
});
