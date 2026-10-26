import { SndImpulse, SndRetroPulse } from '@/model/audio';
import { noteHz, PULSE_HARMONICS_MAX, SIMPLE_HARMONICS_MAX } from './constants';
import type { SynthModel } from './sink';

/**
 * The synth's waveforms, band-limited (only harmonics below Nyquist: no
 * aliasing) and built once: per MIDI note (the spectrum depends only on
 * pitch), per note and arc length, per fixed rate.
 */
export class SndWaves {
  private readonly impulse = new SndImpulse();
  private readonly pulses = new Map<number, PeriodicWave>();
  private readonly arcs = new Map<string, PeriodicWave>();
  private readonly retros = new Map<number, PeriodicWave>();
  private readonly rates = new Map<string, PeriodicWave>();

  constructor(private readonly ctx: BaseAudioContext) {}

  /** The measured coil impulse repeated at the note's pitch. */
  pulse(note: number): PeriodicWave {
    return this.cached(this.pulses, note, () => this.impulse.coefficients(noteHz(note), this.ctx.sampleRate, PULSE_HARMONICS_MAX), false);
  }

  /** The measured impulse shaped by arcs `arcM` long, by 10 cm. */
  arc(note: number, arcM: number): PeriodicWave {
    const tenths = Math.max(1, Math.round(arcM * 10));
    return this.cached(this.arcs, `${note}:${tenths}`, () => this.impulse.arcCoefficients(noteHz(note), this.ctx.sampleRate, tenths / 10, PULSE_HARMONICS_MAX), true);
  }

  /** The "pulse" model's wave. */
  retro(note: number): PeriodicWave {
    return this.cached(this.retros, note, () => SndRetroPulse.DEFAULT.coefficients(noteHz(note), this.ctx.sampleRate, PULSE_HARMONICS_MAX), false);
  }

  /** A coil's impulse repeated at any rate (a fixed tone's, not only a note's). */
  rate(model: SynthModel, hz: number): PeriodicWave {
    return this.cached(this.rates, `${model}:${hz}`, () => (model === 'pulse'
      ? SndRetroPulse.DEFAULT.coefficients(hz, this.ctx.sampleRate, SIMPLE_HARMONICS_MAX)
      : this.impulse.coefficients(hz, this.ctx.sampleRate, SIMPLE_HARMONICS_MAX)), false);
  }

  /** raw: the arcs' waves keep their own level (disableNormalization), the timbre changes, not the loudness. */
  private cached<K>(cache: Map<K, PeriodicWave>, key: K, make: () => { real: Float32Array; imag: Float32Array }, raw: boolean): PeriodicWave {
    const hit = cache.get(key);
    if (hit) return hit;
    const { real, imag } = make();
    const wave = this.ctx.createPeriodicWave(real, imag, { disableNormalization: raw });
    cache.set(key, wave);
    return wave;
  }
}
