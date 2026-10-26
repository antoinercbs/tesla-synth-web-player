import { Complex } from './complex';

/**
 * Acoustic impulse model of a musical Tesla coil — the per-note spectral colour of the
 * built-in synth. Fitted on recordings of the club's three coils (videos "3 Tesla coils":
 * Cantina Band, James Bond, Megalovania, Through the Fire and the Flames; Pixel 3a audio):
 * ~1700 clean single-note frames from B1 to D6 plus the whole-song spectrum of Megalovania.
 *
 * What a musical coil radiates: the pitch is the pulse-repetition frequency and every bang
 * is ONE acoustic impulse, so a note is that impulse repeated at f0 and its harmonics simply
 * sample the impulse spectrum |P(k·f0)|. Period-synchronous averaging of the recordings shows
 * the impulse is a DOUBLET: a click when the arc ignites and an opposite-sign click ≈214 µs
 * later when it extinguishes (the radiated pressure is the time-derivative of the arc's
 * heating pulse, not the pulse itself). Its spectrum |1 − a·e^(−j2πfτ)| RISES +6 dB/oct from
 * the low end up to 1/(2τ) ≈ 2.3 kHz — hence the very weak fundamental of bass notes (E2 sits
 * ~16 dB under its strongest harmonic, ~20 dB in the recordings) — and has notches at k/τ ≈
 * 4.7 kHz, 9.3 kHz… The extinction click is weaker (a < 1) so the notches and the
 * low-frequency floor stay finite (≈ −16 dB). On top: a 2nd-order roll-off (finite rise time
 * of the shock front) and two resonances present on every note — a narrow one at ~2.15 kHz
 * (the ~1 ms ringing visible after each click) and a broad body bump at ~700 Hz.
 *
 * The model is pitch-INDEPENDENT, which is what fixes both ends of the range at once: bass
 * notes lose their fundamental and buzz, high notes put their energy on the 2nd/3rd harmonic
 * instead of the fundamental. Per-note residual vs the recordings ≈ 3–4 dB rms (the previous
 * rectangular-pulse model: 32 dB in the bass, 7 dB in the melody); whole-song 1/3-octave
 * spectrum of Megalovania: 2.2 dB rms (was 8 dB). Caveat: the reference audio went through a
 * phone microphone, whose own low-frequency roll-off (~100 Hz) was fitted separately and is
 * NOT part of this model. Listening next to the real coils found the measured balance too
 * thin in the bass — bass notes buzzed like a kazoo, their 2 kHz hump drowning the fundamental —
 * so a +12 dB low shelf below 350 Hz (`bassShelfDb`, picked by A/B listening over +5 dB) lifts
 * the floor to ≈ −4 dB and the pitch gain leans a little more toward the low notes.
 */
export interface ImpulseParams {
  /** Doublet spacing = arc duration (s): sets the +6 dB/oct rise, the ~2.3 kHz peak and the k/τ notches. */
  tauS: number;
  /** Extinction click relative to the ignition click (0..1): notch depth and low-frequency floor = 1 − a. */
  a: number;
  /** 2nd-order Butterworth roll-off (Hz) — finite rise time of the shock front. */
  lowpassHz: number;
  /** Narrow resonance heard as a ~1 ms ringing after each click. */
  formantHz: number;
  formantDb: number;
  formantQ: number;
  /** Broad body bump. */
  midHz: number;
  midDb: number;
  midQ: number;
  /**
   * Low shelf (RBJ, Q = 1/√2) applied below `bassShelfHz`: listener compensation. The
   * recordings (phone mic, far from the coils) put the low-frequency floor ~16 dB under the
   * 2 kHz peak, which sounded too thin next to the real thing — the shelf lifts it back to
   * ≈ −4 dB. Set `bassShelfDb` to 0 for the raw measured balance.
   */
  bassShelfHz: number;
  bassShelfDb: number;
}

/** Fitted on the club's coils (see the module comment). */
export const TESLA_IMPULSE: ImpulseParams = {
  tauS: 0.000214,
  a: 0.55,
  lowpassHz: 5000,
  formantHz: 2150,
  formantDb: 5,
  formantQ: 4.1,
  midHz: 690,
  midDb: 5,
  midQ: 1.8,
  bassShelfHz: 350,
  bassShelfDb: 12,
};

/** The arcs the impulse was measured on (m). */
const REF_ARC_M = 0.6;
const SOUND_MPS = 343;

/** The acoustic impulse of one bang, and the notes it makes: the impulse repeated at their pitch. */
export class SndImpulse {
  /**
  * A long arc's sound: the clicks of its parts reach the listener spread over
  * ℓ/c. Below c/ℓ they add up in step, above it they add as noise power, so a
  * long arc puts the bass ahead (the "fat" sound of the big coils). The
  * impulse was measured on arcs of about REF_ARC_M: a coil's own arcs shape
  * it relative to that.
  */
  private static arcSpread(f: number, arcM: number): number {
    return 1 / Math.sqrt(1 + ((f * arcM) / SOUND_MPS) ** 2);
  }

  constructor(readonly p: Readonly<ImpulseParams> = TESLA_IMPULSE) {}

  /** Its complex spectrum P(f) (arbitrary scale; P(0) = (1 − a)·shelf gain). */
  spectrum(f: number): Complex {
    const p = this.p;
    const th = 2 * Math.PI * f * p.tauS;
    // doublet: ignition click at t=0, extinction click −a at t=τ → 1 − a·e^(−jθ)
    const doublet = new Complex(1 - p.a * Math.cos(th), p.a * Math.sin(th));
    let out = doublet.mul(SndImpulse.lowpass2(f, p.lowpassHz));
    out = out.mul(SndImpulse.peaking(f, p.formantHz, p.formantDb, p.formantQ));
    out = out.mul(SndImpulse.peaking(f, p.midHz, p.midDb, p.midQ));
    if (p.bassShelfDb !== 0) out = out.mul(SndImpulse.lowShelf(f, p.bassShelfHz, p.bassShelfDb));
    return out;
  }

  magnitude(f: number): number {
    return this.spectrum(f).abs;
  }

  /**
   * `PeriodicWave` coefficients for a note: harmonic k of a pulse train is the impulse spectrum
   * at k·f0, so real[k] = 2·Re P, imag[k] = −2·Im P (Web Audio sums real[k]·cos + imag[k]·sin,
   * i.e. Re{c·e^(jωt)} with c = real − j·imag). Capped at the last harmonic below Nyquist, so
   * Web Audio synthesises the note with ZERO aliasing. Index 0 (DC) is left at 0.
   */
  coefficients(f0: number, sampleRate: number, maxHarmonics = 256): { real: Float32Array; imag: Float32Array } {
    const n = Math.max(1, Math.min(maxHarmonics, Math.floor(sampleRate / 2 / f0) - 1));
    const real = new Float32Array(new ArrayBuffer((n + 1) * 4));
    const imag = new Float32Array(new ArrayBuffer((n + 1) * 4));
    for (let h = 1; h <= n; h++) {
      const c = this.spectrum(h * f0);
      real[h] = 2 * c.re;
      imag[h] = -2 * c.im;
    }
    return { real, imag };
  }

  /**
   * The coefficients for a coil whose arcs are `arcM` long. Scaled to the power
   * of the measured wave as Web Audio plays it (peak-normalised): use it with
   * `disableNormalization`, so the arc changes the timbre, not the level.
   */
  arcCoefficients(f0: number, sampleRate: number, arcM: number, maxHarmonics = 256): { real: Float32Array; imag: Float32Array } {
    const ref = this.coefficients(f0, sampleRate, maxHarmonics);
    const real = new Float32Array(new ArrayBuffer(ref.real.length * 4));
    const imag = new Float32Array(new ArrayBuffer(ref.imag.length * 4));
    let refPower = 0, arcPower = 0;
    for (let h = 1; h < ref.real.length; h++) {
      const k = SndImpulse.arcSpread(h * f0, arcM) / SndImpulse.arcSpread(h * f0, REF_ARC_M);
      const power = ref.real[h] ** 2 + ref.imag[h] ** 2;
      refPower += power;
      arcPower += k * k * power;
      real[h] = ref.real[h] * k;
      imag[h] = ref.imag[h] * k;
    }
    const scale = Math.sqrt(refPower / Math.max(arcPower, 1e-30)) / SndImpulse.wavePeak(ref.real, ref.imag);
    for (let h = 1; h < real.length; h++) {
      real[h] *= scale;
      imag[h] *= scale;
    }
    return { real, imag };
  }

  /** Analog 2nd-order Butterworth low-pass 1/(1 + √2·s + s²), s = j·f/fc. */
  private static lowpass2(f: number, fc: number): Complex {
    const w = f / fc;
    return new Complex(1, 0).div(new Complex(1 - w * w, Math.SQRT2 * w));
  }

  /** Analog peaking EQ (s² + s·A/Q + 1)/(s² + s/(A·Q) + 1), A = 10^(dB/40), s = j·f/fc. */
  private static peaking(f: number, fc: number, gainDb: number, q: number): Complex {
    const A = 10 ** (gainDb / 40);
    const w = f / fc;
    return new Complex(1 - w * w, (w * A) / q).div(new Complex(1 - w * w, w / (A * q)));
  }

  /** Analog RBJ low shelf, Q = 1/√2: gain 10^(dB/20) at DC, unity well above fc. */
  private static lowShelf(f: number, fc: number, gainDb: number): Complex {
    const A = 10 ** (gainDb / 40);
    const w = f / fc;
    const k = Math.sqrt(A) * Math.SQRT2; // √A / Q with Q = 1/√2
    // A·(s² + k·s + A) / (A·s² + k·s + 1), s = j·w
    return new Complex(A * (A - w * w), A * k * w).div(new Complex(1 - A * w * w, k * w));
  }

  /** The peak of a periodic wave from its coefficients (Web Audio's real·cos + imag·sin). */
  private static wavePeak(real: Float32Array, imag: Float32Array, samples = 1024): number {
    let peak = 0;
    for (let i = 0; i < samples; i++) {
      const w = (2 * Math.PI * i) / samples;
      let x = 0;
      for (let h = 1; h < real.length; h++) x += real[h] * Math.cos(h * w) + imag[h] * Math.sin(h * w);
      peak = Math.max(peak, Math.abs(x));
    }
    return peak || 1;
  }
}
