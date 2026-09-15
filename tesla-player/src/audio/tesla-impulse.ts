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
 * thin in the bass, so a +5 dB low shelf below 350 Hz (`bassShelfDb`) lifts the floor to ≈ −10 dB
 * and the pitch gain leans a little more toward the low notes.
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
   * ≈ −10 dB. Set `bassShelfDb` to 0 for the raw measured balance.
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
  bassShelfDb: 5,
};

/**
 * Bang energy vs pitch. With a peak-normalised waveform the synth already repeats the SAME
 * impulse at every pitch (constant peak, RMS ∝ √f0 — exactly what the recordings show across
 * each coil's range); on top of that the measured per-bang energy drifts gently down with
 * pitch (≈ −2 dB/oct on single coils, −4 dB/oct in the Megalovania mix), applied here as a
 * gain — set toward the mix value after listening ("the bass was too attenuated").
 */
export const PITCH_GAIN_DB_PER_OCT = -3;
export const PITCH_GAIN_REF_HZ = 110;

export function pitchGain(f0: number): number {
  return 10 ** ((PITCH_GAIN_DB_PER_OCT * Math.log2(f0 / PITCH_GAIN_REF_HZ)) / 20);
}

export interface Complex {
  re: number;
  im: number;
}

function cmul(a: Complex, b: Complex): Complex {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

function cdiv(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im;
  return {
    re: (a.re * b.re + a.im * b.im) / d,
    im: (a.im * b.re - a.re * b.im) / d,
  };
}

/** Analog 2nd-order Butterworth low-pass 1/(1 + √2·s + s²), s = j·f/fc. */
function lowpass2(f: number, fc: number): Complex {
  const w = f / fc;
  return cdiv({ re: 1, im: 0 }, { re: 1 - w * w, im: Math.SQRT2 * w });
}

/** Analog peaking EQ (s² + s·A/Q + 1)/(s² + s/(A·Q) + 1), A = 10^(dB/40), s = j·f/fc. */
function peaking(f: number, fc: number, gainDb: number, q: number): Complex {
  const A = 10 ** (gainDb / 40);
  const w = f / fc;
  return cdiv(
    { re: 1 - w * w, im: (w * A) / q },
    { re: 1 - w * w, im: w / (A * q) },
  );
}

/** Analog RBJ low shelf, Q = 1/√2: gain 10^(dB/20) at DC, unity well above fc. */
function lowShelf(f: number, fc: number, gainDb: number): Complex {
  const A = 10 ** (gainDb / 40);
  const w = f / fc;
  const k = Math.sqrt(A) * Math.SQRT2; // √A / Q with Q = 1/√2
  // A·(s² + k·s + A) / (A·s² + k·s + 1), s = j·w
  return cdiv(
    { re: A * (A - w * w), im: A * k * w },
    { re: 1 - A * w * w, im: k * w },
  );
}

/** Complex spectrum P(f) of one acoustic impulse (arbitrary scale; P(0) = (1 − a)·shelf gain). */
export function impulseSpectrum(
  f: number,
  p: ImpulseParams = TESLA_IMPULSE,
): Complex {
  const th = 2 * Math.PI * f * p.tauS;
  // doublet: ignition click at t=0, extinction click −a at t=τ → 1 − a·e^(−jθ)
  const doublet: Complex = {
    re: 1 - p.a * Math.cos(th),
    im: p.a * Math.sin(th),
  };
  let out = cmul(doublet, lowpass2(f, p.lowpassHz));
  out = cmul(out, peaking(f, p.formantHz, p.formantDb, p.formantQ));
  out = cmul(out, peaking(f, p.midHz, p.midDb, p.midQ));
  if (p.bassShelfDb !== 0)
    out = cmul(out, lowShelf(f, p.bassShelfHz, p.bassShelfDb));
  return out;
}

export function impulseMagnitude(
  f: number,
  p: ImpulseParams = TESLA_IMPULSE,
): number {
  const c = impulseSpectrum(f, p);
  return Math.hypot(c.re, c.im);
}

/**
 * `PeriodicWave` coefficients for a note: harmonic k of a pulse train is the impulse spectrum
 * at k·f0, so real[k] = 2·Re P, imag[k] = −2·Im P (Web Audio sums real[k]·cos + imag[k]·sin,
 * i.e. Re{c·e^(jωt)} with c = real − j·imag). Capped at the last harmonic below Nyquist, so
 * Web Audio synthesises the note with ZERO aliasing. Index 0 (DC) is left at 0.
 */
export function pulseCoefficients(
  f0: number,
  sampleRate: number,
  maxHarmonics = 256,
  p: ImpulseParams = TESLA_IMPULSE,
): { real: Float32Array; imag: Float32Array } {
  const n = Math.max(
    1,
    Math.min(maxHarmonics, Math.floor(sampleRate / 2 / f0) - 1),
  );
  const real = new Float32Array(new ArrayBuffer((n + 1) * 4));
  const imag = new Float32Array(new ArrayBuffer((n + 1) * 4));
  for (let h = 1; h <= n; h++) {
    const c = impulseSpectrum(h * f0, p);
    real[h] = 2 * c.re;
    imag[h] = -2 * c.im;
  }
  return { real, imag };
}
