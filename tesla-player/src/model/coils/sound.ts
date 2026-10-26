import type { CoilResponse } from '@/model/coils/response';

export interface BangLaw {
  /** A strike's extra loudness for its energy (dB). */
  strikeDb: number;
  /** A drift with pitch on top of the energy (dB per octave). */
  slopeDbPerOct: number;
}

/**
 * How loud a real coil's bang sounds, from its physics: the sound a bang
 * radiates follows the energy its arcs take (model/coils/response.ts), and its
 * notes repeat it at their rate: the power heard goes as energy × rate.
 * A strike on the ground mat sounds louder than streamers for its energy: a
 * hot conductive channel takes its current at once, a shock wave, where the
 * streamers spend theirs in the corona around them.
 *
 * The same law for the synth and for the Assistant, so the Assistant's levels
 * are the ones heard. Its numbers are set by ear (A/B), not measured.
 */
export class SndBang {
  static readonly LAW: Readonly<BangLaw> = { strikeDb: 6, slopeDbPerOct: 0 };
  // the reference bang, 0 dB: the small coil firing 115.6 µs on A4 (40 µs / 5 % with a 2 µs min ontime),
  // the synth's reference level before the physics
  static readonly REF_US = 115.6;
  static readonly REF_HZ = 440;
  // its power (W), written out: working it out meant the small coil's whole response (~0.2 s) on the
  // first note played. sound.spec.ts checks it against the physics; change the physics, update it
  static readonly REF_POWER_W = 1663.014;

  private static reference(): number {
    return SndBang.REF_POWER_W;
  }

  /** One bang's loudness (dB of its energy against the reference bang's); −60 for a silent one. */
  static db(physics: CoilResponse, pulseUs: number, hz: number, law: Readonly<BangLaw> = SndBang.LAW): number {
    if (!(pulseUs > 0) || !(hz > 0)) return -60;
    const b = physics.at(pulseUs, hz);
    if (!(b.e > 0)) return -60;
    const db = 10 * Math.log10((b.e * SndBang.REF_HZ) / SndBang.reference()) + law.slopeDbPerOct * Math.log2(hz / SndBang.REF_HZ);
    return Math.max(-60, db + (b.fate === 'strike' ? law.strikeDb : 0));
  }

  /** A note's level: its bangs repeated at its rate (dB of power against the reference); −60 for a silent one. */
  static levelDb(physics: CoilResponse, pulseUs: number, hz: number, law: Readonly<BangLaw> = SndBang.LAW): number {
    const db = SndBang.db(physics, pulseUs, hz, law);
    return db <= -60 ? -60 : Math.max(-60, db + 10 * Math.log10(hz / SndBang.REF_HZ));
  }
}
