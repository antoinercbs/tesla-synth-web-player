export interface LevelLaw {
  alpha: number;
  slopeDbPerOct: number;
}

// 40 µs / 5 % on A4 with a 2 µs min ontime fires 115.6 µs: the reference level
const LEVEL_REF_US = 115.6;
const LEVEL_REF_HZ = 440;

/**
 * How loud a coil's pulse sounds. The synth repeats the SAME impulse at every pitch
 * (a peak-normalised wave: RMS ∝ √f0, as the recordings show across each coil's
 * range). A longer pulse makes a louder bang, as (pulse / reference)^alpha, and the
 * bang drifts with pitch by slopeDbPerOct: the recordings drift ≈ −2 dB/oct on a
 * single coil, −4 in a mix, at settings that were not noted, so part of that drift
 * is the pulse length itself (D × period in the bass). Picked by ear on an A/B against
 * α ½ and slopes of 0 and −3 dB/oct.
 */
export class SndLevelLaw {
  static readonly DEFAULT = new SndLevelLaw({ alpha: 1, slopeDbPerOct: -1.5 });

  constructor(readonly law: Readonly<LevelLaw>) {}

  /** The same law, without its drift with pitch. */
  get flat(): SndLevelLaw {
    return new SndLevelLaw({ alpha: this.law.alpha, slopeDbPerOct: 0 });
  }

  /** The level of a pulse (µs) at a pitch (Hz): 1 for the reference pulse on A4. */
  level(pulseUs: number, f0: number): number {
    if (!(pulseUs > 0)) return 0;
    return (pulseUs / LEVEL_REF_US) ** this.law.alpha * 10 ** ((this.law.slopeDbPerOct * Math.log2(f0 / LEVEL_REF_HZ)) / 20);
  }
}
