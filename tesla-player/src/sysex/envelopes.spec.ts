import { describe, it, expect } from 'vitest';
import { stepAmp, envelopeAmplitude } from './envelopes';

describe('envelope step maths (Syntherrupter n-tau)', () => {
  it('is linear when ntau = 0', () => {
    expect(stepAmp(0, 1, 0, 0.5)).toBeCloseTo(0.5, 6);
    expect(stepAmp(0, 1, 0, 0)).toBe(0);
    expect(stepAmp(0, 1, 0, 1)).toBe(1);
    expect(stepAmp(0.2, 0.8, 0, 0.25)).toBeCloseTo(0.35, 6);
  });

  it('reaches the target exactly at frac = 1 for any ntau', () => {
    expect(stepAmp(0, 1, 3, 1)).toBeCloseTo(1, 6);
    expect(stepAmp(1, 0, 2, 1)).toBeCloseTo(0, 6);
    expect(stepAmp(0, 1, 3, 0)).toBeCloseTo(0, 6);
  });

  it('charges RC-like (faster than linear) for ntau > 0 rising to target', () => {
    expect(stepAmp(0, 1, 3, 0.5)).toBeGreaterThan(0.5);
  });
});

describe('envelopeAmplitude (per-program)', () => {
  it('constant (P0): held → full, released → decays to 0', () => {
    expect(envelopeAmplitude(0, 500, null)).toBeCloseTo(1, 2);
    expect(envelopeAmplitude(0, 1000, null)).toBeCloseTo(1, 2);
    // release step is ~25ms; well past it → 0
    expect(envelopeAmplitude(0, 200, 100)).toBe(0);
    // mid-release → between 0 and 1
    const mid = envelopeAmplitude(0, 110, 100);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('piano (P1): fast attack to ~1, then long decay toward 0', () => {
    expect(envelopeAmplitude(1, 0, null)).toBeCloseTo(0, 2);
    expect(envelopeAmplitude(1, 4, null)).toBeCloseTo(1, 1); // just after attack
    const mid = envelopeAmplitude(1, 700, null);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(0.6); // decayed substantially
    expect(envelopeAmplitude(1, 5000, null)).toBeCloseTo(0, 2); // rung out
  });

  it('pad (P2): slow attack, sustained at 1 while held', () => {
    expect(envelopeAmplitude(2, 10, null)).toBeLessThan(0.2); // barely started
    expect(envelopeAmplitude(2, 650, null)).toBeCloseTo(1, 1); // attack done
    expect(envelopeAmplitude(2, 5000, null)).toBeCloseTo(1, 1); // sustains
  });

  it('staccato (P5): always short even when held', () => {
    expect(envelopeAmplitude(5, 5, null)).toBeGreaterThan(0.5);
    expect(envelopeAmplitude(5, 300, null)).toBeCloseTo(0, 2);
  });
});
