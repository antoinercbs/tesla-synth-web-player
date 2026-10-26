import { SndBang, type BangLaw } from '@/model/coils/sound';

/**
 * The subset of a MIDI output the app drives. Both a real WebMidi `Output` and
 * the built-in SndTeslaSynth satisfy it, so they're interchangeable.
 */
export interface MidiSink {
  id: string;
  name: string;
  send(data: number[], options?: { time?: number | string }): void;
  sendSysex(manufacturer: number | number[], data: number[]): void;
  sendAllSoundOff(): void;
  clear(): void;
  /** Built-in synth only: unlock the AudioContext from a user gesture. */
  resume?(): void;
}

export const SYNTH_OUTPUT_ID = '__synth__';

/**
 * The built-in synth's timbre. "tesla": the measured coil impulse with the arc's texture;
 * "clean": the same impulse, steady (no jitter, flicker or detune) — clearer to compose by
 * ear; "pulse": the synth's first model, a fixed-width rectangular pulse.
 */
export type SynthModel = 'tesla' | 'clean' | 'pulse';
export const SYNTH_MODELS: readonly SynthModel[] = ['tesla', 'clean', 'pulse'];

/**
 * The coils' own sound, from their sheets (model/coils/response.ts): each coil plays
 * a note on a voice of its own, where it stands, as loud as the energy its arcs
 * take (model/coils/sound.ts), its timbre shaped by their length, rough when the OCD
 * cuts the bangs in the air. A strike on the ground mat sounds louder, not
 * rougher (picked by ear, A/B of 2026-10-17). A coil without a sheet keeps the
 * measured sound. Off, every coil shares one voice per note, as before.
 */
export interface PhysicsSound {
  bang: BangLaw;
  /** The arcs' length shapes the timbre. */
  arcTimbre: boolean;
  /** The bang-to-bang roughness (σ) when the OCD cuts the bangs in the air. */
  raspSigma: number;
}
export const PHYSICS_SOUND: Readonly<PhysicsSound> = { bang: SndBang.LAW, arcTimbre: true, raspSigma: 0.55 };
