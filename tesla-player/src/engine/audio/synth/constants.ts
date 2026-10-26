import { DevCoilLimits } from '@/model/devices/coil-limits';
import type { BoardCoil } from '@/model/devices/board';

// A musical Tesla coil's pitch IS the pulse-repetition frequency: each note is ONE acoustic
// impulse repeated at f0, so its harmonics sample the impulse spectrum |P(k·f0)|. That
// impulse — measured on the club's three coils, see `model/audio/impulse.ts` — is a doublet
// (ignition click, extinction click ≈214 µs later) whose spectrum rises +6 dB/oct up to
// ~2.3 kHz and is notched at ~4.7 kHz: bass notes have almost no fundamental and buzz, high
// notes carry their energy on the 2nd/3rd harmonic. Each note is one band-limited waveform
// via a per-note PeriodicWave (only harmonics below Nyquist → ZERO aliasing), which Web Audio
// peak-normalises: the SAME bang at every pitch, exactly what the recordings show (constant
// impulse, RMS growing with pitch). How loud each bang is comes from the pulse the board
// would fire for the note (see "The board" below).
//
// Texture: the recordings are ~85% tonal in the mids but the bangs are not identical — the
// inter-harmonic floor sits ~10 dB under the harmonics — so each voice's amplitude is
// modulated by low-passed noise (bandwidth ≈ f0/2 → one random gain per bang), on top of a
// slow mean-reverting flicker (streamer sputter). No additive noise: the pulse stays tonal.
export const PULSE_HARMONICS_MAX = 256;
export const PITCH_JITTER = 0.0007; // ±0.07% per-voice static PRF detune (measured 0.067%)
export const ATTACK_MIN_S = 0.0012; // gate ramp floor — measured real attack ≈1.1 ms (snappy, not a click)
export const REVERB_WET = 0.29; // light room send, relative to the dry coil
// arc flicker: a real coil's streamer sputters → the sustain shimmers in amplitude (the
// recording is far from a flat tone). A bounded mean-reverting random walk on a per-voice
// gain emulates it WITHOUT a noise source (stays tonal). Baked as scheduled automation.
export const FLICKER_DEPTH = 0.18,
  FLICKER_STEP_MS = 38,
  FLICKER_HORIZON_S = 2.2;
// bang-to-bang amplitude jitter: white noise low-passed at ~f0/2 (one random value per bang),
// scaled to an RMS of JITTER_SIGMA around 1 → inter-harmonic floor ≈ 20·log10(σ) ≈ −12 dB.
export const JITTER_SIGMA = 0.25;
export const JITTER_LP_MIN_HZ = 25;
export const NOISE_SECONDS = 2;
export const NOISE_RMS = 1 / Math.sqrt(3); // uniform [-1, 1]
// the doublet waveform has a higher crest factor than the old rectangular pulse (RMS ≈ 3 dB
// lower at the same peak) → a bit more master gain. Matched by K-weighted loudness to the
// former compressed bus, so dropping its make-up gain for the limiter kept the level.
export const MASTER_GAIN = 0.335;
// at −2 dB, stacked chords still overshot 0 dBFS now and then (attack + make-up gain)
export const LIMITER_THRESHOLD_DB = -4;
// The level of the reference pulse (SndLevelLaw): the former model's for
// 40 µs / 5 % on A4, so the app's default settings keep their loudness. The retro pulse is
// flat across pitch, and as loud as the Tesla model (K-weighted, same test phrase).
export const TESLA_REF_GAIN = 0.25;
export const PULSE_REF_GAIN = 0.21;

// The board (MIDI.cpp, Channel.cpp): its notes are looked at on this grid and at every event
// in between (the firmware does every 2 ms), up to a little ahead of the audio clock; an
// event landing inside what is already scheduled reschedules from its time.
export const STEP_S = 0.008;
export const HORIZON_S = 0.2;
export const PUMP_MS = 25;
export const EPS = 1e-6;
// the board's LFO on the modulation wheel (CC1), its EEPROM defaults
export const LFO_HZ = 5;
export const LFO_DEPTH = 0.5;
// the soft pedal (CC67) multiplies a held note's volume
export const SOFT_PEDAL = 0.6;
export const BEND_RANGE = 2; // semitones, after a reset
// no coil configured yet: the notes play on one of these, rather than not at all
export const UNCONFIGURED: BoardCoil = { drive: { ontimeUs: 40, duty: 0.05 }, limits: DevCoilLimits.DEFAULT };
export const COIL_SLOTS = 6;
// a fixed tone may fire a few times a second: its bang keeps its clicks up to this many harmonics
export const SIMPLE_HARMONICS_MAX = 2048;
/** A sound every coil playing the note shares (the physics off). */
export const ALL_COILS = -2;
export const MAX_VOICES = 40;

export function noteHz(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

/** Holds a param at its value from `when`, its later automation dropped. */
export function holdAt(g: AudioParam, when: number): void {
  if (typeof g.cancelAndHoldAtTime === 'function') g.cancelAndHoldAtTime(when);
  else {
    g.cancelScheduledValues(when);
    g.setValueAtTime(Math.max(0.0001, g.value), when);
  }
}
