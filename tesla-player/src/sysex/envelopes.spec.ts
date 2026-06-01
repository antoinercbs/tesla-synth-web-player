import { describe, it, expect } from 'vitest';
import { stepAmp, envelopeAmplitude, envelopeReleaseMs } from './envelopes';

describe('envelope step maths (Syntherrupter n-tau)', () => {
  it('is linear when ntau ≈ 0', () => {
    expect(stepAmp(0, 1, 0, 0.5)).toBeCloseTo(0.5, 6);
    expect(stepAmp(0, 1, 0, 0)).toBe(0);
    expect(stepAmp(0, 1, 0, 1)).toBe(1);
  });
  it('reaches the target exactly at frac = 1 for any ntau', () => {
    expect(stepAmp(0, 1, 3, 1)).toBeCloseTo(1, 6);
    expect(stepAmp(2, 0, 0.1, 1)).toBeCloseTo(0, 6);
  });
  it('charges RC-like (faster than linear) for ntau > 0', () => {
    expect(stepAmp(0, 1, 3, 0.5)).toBeGreaterThan(0.5);
  });
});

describe('envelopeAmplitude — firmware default programs', () => {
  it('P0 (no envelope): full while held', () => {
    expect(envelopeAmplitude(0, 500, null)).toBeCloseTo(1, 2);
    expect(envelopeAmplitude(0, 5000, null)).toBeCloseTo(1, 2);
  });

  it('P1 (piano): attack ~30ms then slow decay to a 0.1 sustain', () => {
    expect(envelopeAmplitude(1, 0, null)).toBeCloseTo(0, 2);
    expect(envelopeAmplitude(1, 30, null)).toBeGreaterThan(0.9); // attack peak
    expect(envelopeAmplitude(1, 10000, null)).toBeCloseTo(0.1, 1); // sustain
  });

  it('P2 (slow pad): 4 s attack, sustains at 1', () => {
    expect(envelopeAmplitude(2, 100, null)).toBeLessThan(0.1); // barely started
    expect(envelopeAmplitude(2, 4000, null)).toBeGreaterThan(0.9);
    expect(envelopeAmplitude(2, 8000, null)).toBeCloseTo(1, 1);
  });

  it('P5 (staccato): always short — silent by ~0.5 s even if held', () => {
    expect(envelopeAmplitude(5, 3, null)).toBeGreaterThan(0.9);
    expect(envelopeAmplitude(5, 500, null)).toBeCloseTo(0, 2);
  });

  it('P8 (punch): attack amplitude exceeds 1 (multiplier, not clamped)', () => {
    expect(envelopeAmplitude(8, 30, null)).toBeGreaterThan(1.5);
  });

  it('release brings the amplitude to 0 after the release time', () => {
    // P1 release is 10ms; note-off at 50ms → fully released well before +100ms
    expect(envelopeAmplitude(1, 200, 50)).toBe(0);
    const mid = envelopeAmplitude(1, 53, 50); // 3ms into a 10ms release
    expect(mid).toBeGreaterThan(0);
    expect(envelopeReleaseMs(1)).toBeCloseTo(10, 5);
  });
});
