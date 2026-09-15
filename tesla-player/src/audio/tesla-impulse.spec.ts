import { describe, expect, it } from 'vitest';
import {
  impulseMagnitude,
  impulseSpectrum,
  pitchGain,
  pulseCoefficients,
  TESLA_IMPULSE,
} from './tesla-impulse';

const SR = 44100;
const E2 = 440 * 2 ** ((40 - 69) / 12);
const A3 = 220;
const A4 = 440;
const C6 = 440 * 2 ** ((84 - 69) / 12);

const db = (a: number, b: number) => 20 * Math.log10(a / b);
const mag = (real: Float32Array, imag: Float32Array, k: number) => Math.hypot(real[k], imag[k]);
const argmax = (real: Float32Array, imag: Float32Array) => {
  let best = 1;
  for (let k = 1; k < real.length; k++) if (mag(real, imag, k) > mag(real, imag, best)) best = k;
  return best;
};

describe('impulseSpectrum', () => {
  it('matches the fitted reference model (Python analysis of the recordings)', () => {
    // |P(0)| = (1 − a) × bass shelf gain, then the measured rise to the ~2.15 kHz peak
    expect(impulseMagnitude(1)).toBeCloseTo(0.800228, 5);
    const p100 = impulseSpectrum(100);
    expect(p100.re).toBeCloseTo(0.818194, 5);
    expect(p100.im).toBeCloseTo(0.050027, 5);
    expect(impulseMagnitude(1000)).toBeCloseTo(1.284797, 5);
    expect(impulseMagnitude(2150)).toBeCloseTo(2.754604, 5);
    // notch at 1/τ ≈ 4673 Hz
    expect(impulseMagnitude(4673)).toBeCloseTo(0.344483, 5);
  });

  it('rises from the bass to the ~2 kHz peak and is notched near 1/τ', () => {
    expect(impulseMagnitude(300)).toBeLessThan(impulseMagnitude(700));
    expect(impulseMagnitude(700)).toBeLessThan(impulseMagnitude(2150));
    // low-frequency floor ≈ −10.5 dB re the peak: the measured −16 dB (phone mic) lifted by the
    // +5 dB bass shelf after listening next to the real coils
    expect(db(impulseMagnitude(100), impulseMagnitude(2150))).toBeLessThan(-8);
    expect(db(impulseMagnitude(100), impulseMagnitude(2150))).toBeGreaterThan(-13);
    // the 1/τ notch sits well under both neighbouring lobes
    const notch = impulseMagnitude(1 / TESLA_IMPULSE.tauS);
    expect(db(notch, impulseMagnitude(3000))).toBeLessThan(-8);
    expect(db(notch, impulseMagnitude(6300))).toBeLessThan(-5);
  });
});

describe('pulseCoefficients', () => {
  it('only emits harmonics below Nyquist (zero aliasing) and leaves DC at 0', () => {
    for (const f0 of [E2, A3, A4, C6]) {
      const { real, imag } = pulseCoefficients(f0, SR);
      const expected = Math.min(256, Math.floor(SR / 2 / f0) - 1);
      expect(real.length).toBe(expected + 1);
      expect(imag.length).toBe(expected + 1);
      expect(expected * f0).toBeLessThan(SR / 2);
      expect(real[0]).toBe(0);
      expect(imag[0]).toBe(0);
    }
    expect(pulseCoefficients(E2, SR).real.length).toBe(257); // capped
    expect(pulseCoefficients(A4, SR).real.length).toBe(50);
    expect(pulseCoefficients(C6, SR).real.length).toBe(21);
  });

  it('reproduces the reference coefficients (real = 2·Re P, imag = −2·Im P)', () => {
    const e2 = pulseCoefficients(E2, SR);
    expect(e2.real[1]).toBeCloseTo(1.626096, 4);
    expect(e2.imag[1]).toBeCloseTo(-0.08672, 4);
    expect(e2.real[2]).toBeCloseTo(1.671113, 4);
    expect(e2.imag[2]).toBeCloseTo(-0.126751, 4);
    const a4 = pulseCoefficients(A4, SR);
    expect(a4.real[1]).toBeCloseTo(1.649202, 4);
    expect(a4.imag[1]).toBeCloseTo(-0.502573, 4);
    expect(a4.real[2]).toBeCloseTo(2.651486, 4);
    expect(a4.imag[2]).toBeCloseTo(0.204511, 4);
    const c6 = pulseCoefficients(C6, SR);
    expect(c6.real[1]).toBeCloseTo(2.563547, 4);
    expect(c6.imag[1]).toBeCloseTo(0.217975, 4);
    expect(c6.real[2]).toBeCloseTo(4.503421, 4);
    expect(c6.imag[2]).toBeCloseTo(2.883537, 4);
  });

  it('gives bass notes a weak fundamental with the energy near 2.2 kHz (measured E2 ≈ −20 dB, lifted to ≈ −10.6)', () => {
    const { real, imag } = pulseCoefficients(E2, SR);
    const k = argmax(real, imag);
    expect(k).toBe(26); // 26 × 82.4 Hz ≈ 2143 Hz
    expect(db(mag(real, imag, 1), mag(real, imag, k))).toBeLessThan(-8);
    expect(db(mag(real, imag, 1), mag(real, imag, k))).toBeGreaterThan(-13);
    const a3 = pulseCoefficients(A3, SR);
    expect(argmax(a3.real, a3.imag)).toBe(10); // 2200 Hz
  });

  it('puts a high note’s energy on the 2nd harmonic, not the fundamental (measured C6: −7 dB)', () => {
    const { real, imag } = pulseCoefficients(C6, SR);
    expect(argmax(real, imag)).toBe(2);
    expect(db(mag(real, imag, 2), mag(real, imag, 1))).toBeGreaterThan(4);
  });

  it('carries the 1/τ notch on the harmonic closest to 4.7 kHz', () => {
    const { real, imag } = pulseCoefficients(A4, SR);
    const kn = Math.round(1 / TESLA_IMPULSE.tauS / A4); // 11 → 4840 Hz
    expect(kn).toBe(11);
    expect(db(mag(real, imag, kn), mag(real, imag, kn - 2))).toBeLessThan(-4);
    expect(db(mag(real, imag, kn), mag(real, imag, kn + 2))).toBeLessThan(-4);
  });
});

describe('pitchGain', () => {
  it('is unity at the reference pitch and −3 dB per octave above it', () => {
    expect(pitchGain(110)).toBeCloseTo(1, 9);
    expect(pitchGain(440)).toBeCloseTo(0.501187, 5);
    expect(pitchGain(55)).toBeCloseTo(1.412538, 5);
  });
});
