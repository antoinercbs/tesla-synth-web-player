/**
 * The synth's first model, kept as the "retro pulse" timbre: a rectangular pulse of fixed
 * duration (the strike, ≈231 µs), so the duty grows with pitch — narrow and buzzy in the bass,
 * fuller up high — and the first sinc null stays near 4.3 kHz. Clamped to 4–26 % of the
 * period (≈B2..C6), with a 2nd-order roll-off at 9 kHz that tames the over-clean upper lobes.
 */
export class SndRetroPulse {
  static readonly DEFAULT = new SndRetroPulse({ widthS: 0.000231, dutyMin: 0.04, dutyMax: 0.26, lowpassHz: 9000 });

  constructor(readonly p: Readonly<{ widthS: number; dutyMin: number; dutyMax: number; lowpassHz: number }>) {}

  duty(f0: number): number {
    return Math.min(this.p.dutyMax, Math.max(this.p.dutyMin, this.p.widthS * f0));
  }

  /** Same contract as SndImpulse.coefficients: harmonics below Nyquist only, DC left at 0. */
  coefficients(f0: number, sampleRate: number, maxHarmonics = 256): { real: Float32Array; imag: Float32Array } {
    const n = Math.max(1, Math.min(maxHarmonics, Math.floor(sampleRate / 2 / f0) - 1));
    const d = this.duty(f0);
    const real = new Float32Array(new ArrayBuffer((n + 1) * 4));
    const imag = new Float32Array(new ArrayBuffer((n + 1) * 4));
    for (let h = 1; h <= n; h++) {
      const w = (h * f0) / this.p.lowpassHz;
      // pulse centred on t = 0 → cosine series, amplitude (2/πh)·sin(πhd)
      real[h] = ((2 / (Math.PI * h)) * Math.sin(Math.PI * h * d)) / Math.sqrt(1 + w ** 4);
    }
    return { real, imag };
  }
}
