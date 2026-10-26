import { describe, expect, it } from 'vitest';
import { SndImpulse, SndLevelLaw, SndRetroPulse, TESLA_IMPULSE } from '.';

const impulse = new SndImpulse();

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

describe('SndImpulse.spectrum', () => {
  it('matches the fitted reference model (Python analysis of the recordings)', () => {
    // |P(0)| = (1 − a) × bass shelf gain, then the measured rise to the ~2.15 kHz peak
    expect(impulse.magnitude(1)).toBeCloseTo(1.791487, 5);
    const p100 = impulse.spectrum(100);
    expect(p100.re).toBeCloseTo(1.806571, 5);
    expect(p100.im).toBeCloseTo(-0.221327, 5);
    expect(impulse.magnitude(1000)).toBeCloseTo(1.308348, 5);
    expect(impulse.magnitude(2150)).toBeCloseTo(2.757032, 5);
    // notch at 1/τ ≈ 4673 Hz
    expect(impulse.magnitude(4673)).toBeCloseTo(0.344497, 5);
  });

  it('rises from the bass to the ~2 kHz peak and is notched near 1/τ', () => {
    expect(impulse.magnitude(300)).toBeLessThan(impulse.magnitude(700));
    expect(impulse.magnitude(700)).toBeLessThan(impulse.magnitude(2150));
    // low-frequency floor ≈ −3.6 dB re the peak: the measured −16 dB (phone mic) lifted by the
    // +12 dB bass shelf picked by A/B listening
    expect(db(impulse.magnitude(100), impulse.magnitude(2150))).toBeLessThan(-2);
    expect(db(impulse.magnitude(100), impulse.magnitude(2150))).toBeGreaterThan(-6);
    // the 1/τ notch sits well under both neighbouring lobes
    const notch = impulse.magnitude(1 / TESLA_IMPULSE.tauS);
    expect(db(notch, impulse.magnitude(3000))).toBeLessThan(-8);
    expect(db(notch, impulse.magnitude(6300))).toBeLessThan(-5);
  });
});

describe('SndImpulse.coefficients', () => {
  it('only emits harmonics below Nyquist (zero aliasing) and leaves DC at 0', () => {
    for (const f0 of [E2, A3, A4, C6]) {
      const { real, imag } = impulse.coefficients(f0, SR);
      const expected = Math.min(256, Math.floor(SR / 2 / f0) - 1);
      expect(real.length).toBe(expected + 1);
      expect(imag.length).toBe(expected + 1);
      expect(expected * f0).toBeLessThan(SR / 2);
      expect(real[0]).toBe(0);
      expect(imag[0]).toBe(0);
    }
    expect(impulse.coefficients(E2, SR).real.length).toBe(257); // capped
    expect(impulse.coefficients(A4, SR).real.length).toBe(50);
    expect(impulse.coefficients(C6, SR).real.length).toBe(21);
  });

  it('reproduces the reference coefficients (real = 2·Re P, imag = −2·Im P)', () => {
    const e2 = impulse.coefficients(E2, SR);
    expect(e2.real[1]).toBeCloseTo(3.615577, 4);
    expect(e2.imag[1]).toBeCloseTo(0.340808, 4);
    expect(e2.real[2]).toBeCloseTo(3.442384, 4);
    expect(e2.imag[2]).toBeCloseTo(0.872407, 4);
    const a4 = impulse.coefficients(A4, SR);
    expect(a4.real[1]).toBeCloseTo(2.193695, 4);
    expect(a4.imag[1]).toBeCloseTo(0.448567, 4);
    expect(a4.real[2]).toBeCloseTo(2.578071, 4);
    expect(a4.imag[2]).toBeCloseTo(0.925516, 4);
    const c6 = impulse.coefficients(C6, SR);
    expect(c6.real[1]).toBeCloseTo(2.492538, 4);
    expect(c6.imag[1]).toBeCloseTo(0.78191, 4);
    expect(c6.real[2]).toBeCloseTo(4.191696, 4);
    expect(c6.imag[2]).toBeCloseTo(3.328878, 4);
  });

  it('gives bass notes a weak fundamental with the energy near 2.2 kHz (measured E2 ≈ −20 dB, lifted to ≈ −3.6)', () => {
    const { real, imag } = impulse.coefficients(E2, SR);
    const k = argmax(real, imag);
    expect(k).toBe(26); // 26 × 82.4 Hz ≈ 2143 Hz
    expect(db(mag(real, imag, 1), mag(real, imag, k))).toBeLessThan(-2);
    expect(db(mag(real, imag, 1), mag(real, imag, k))).toBeGreaterThan(-6);
    const a3 = impulse.coefficients(A3, SR);
    expect(argmax(a3.real, a3.imag)).toBe(10); // 2200 Hz
  });

  it('puts a high note’s energy on the 2nd harmonic, not the fundamental (measured C6: −7 dB)', () => {
    const { real, imag } = impulse.coefficients(C6, SR);
    expect(argmax(real, imag)).toBe(2);
    expect(db(mag(real, imag, 2), mag(real, imag, 1))).toBeGreaterThan(4);
  });

  it('carries the 1/τ notch on the harmonic closest to 4.7 kHz', () => {
    const { real, imag } = impulse.coefficients(A4, SR);
    const kn = Math.round(1 / TESLA_IMPULSE.tauS / A4); // 11 → 4840 Hz
    expect(kn).toBe(11);
    expect(db(mag(real, imag, kn), mag(real, imag, kn - 2))).toBeLessThan(-4);
    expect(db(mag(real, imag, kn), mag(real, imag, kn + 2))).toBeLessThan(-4);
  });
});

describe('SndRetroPulse', () => {
  it('scales the duty with pitch within 4–26 %', () => {
    expect(SndRetroPulse.DEFAULT.duty(E2)).toBe(0.04); // 231 µs × 82 Hz ≈ 1.9 % → floor
    expect(SndRetroPulse.DEFAULT.duty(A4)).toBeCloseTo(0.10164, 5);
    expect(SndRetroPulse.DEFAULT.duty(C6 * 2)).toBe(0.26); // C7: ≈ 48 % → ceiling
  });

  it('only emits harmonics below Nyquist, as a cosine series with DC at 0', () => {
    for (const f0 of [E2, A4, C6]) {
      const { real, imag } = SndRetroPulse.DEFAULT.coefficients(f0, SR);
      expect(real.length).toBe(Math.min(256, Math.floor(SR / 2 / f0) - 1) + 1);
      expect(real[0]).toBe(0);
      expect(imag.every((v) => v === 0)).toBe(true);
    }
  });

  it('puts the first sinc null near 1/duty', () => {
    const { real } = SndRetroPulse.DEFAULT.coefficients(A4, SR); // 1/0.1016 ≈ harmonic 9.8
    expect(Math.abs(real[10])).toBeLessThan(0.05 * Math.abs(real[1]));
  });
});

describe('SndLevelLaw', () => {
  it('plays the reference pulse on A4 at 1', () => {
    expect(SndLevelLaw.DEFAULT.level(115.6, 440)).toBeCloseTo(1, 9);
  });

  it('follows the pulse to the power alpha, and the pitch by the slope', () => {
    const law = { alpha: 0.5, slopeDbPerOct: -3 };
    expect(new SndLevelLaw(law).level(4 * 115.6, 440)).toBeCloseTo(2, 9);
    expect(new SndLevelLaw(law).level(115.6, 880)).toBeCloseTo(0.707946, 5);
  });

  it('is silent without a pulse', () => {
    expect(SndLevelLaw.DEFAULT.level(0, 440)).toBe(0);
  });
});
