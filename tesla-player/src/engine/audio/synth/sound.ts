import type { CoilResponse } from '@/model/coils/response';
import {
  ATTACK_MIN_S, EPS, FLICKER_DEPTH, FLICKER_HORIZON_S, FLICKER_STEP_MS, holdAt, JITTER_LP_MIN_HZ, JITTER_SIGMA, NOISE_RMS,
} from './constants';

export interface SoundSpec {
  /** The coil it sounds on; ALL_COILS: every coil playing the note shares it (the physics off). */
  slot: number;
  physics: CoilResponse | null;
  wave: PeriodicWave;
  /** The note's pitch (Hz), its jitter's band follows it; the oscillator's, its bend and detune included. */
  hz: number;
  freq: number;
  /** The static detune of its pulse rate (1 for the steady models). */
  detune: number;
  /** Where the coils playing it stand (-1..1). */
  pan: number;
  /** The arc's texture (the "tesla" model): jitter and flicker; else a flat 1. */
  textured: boolean;
  when: number;
}

/**
 * One sound of a note: its band-limited impulse train → the level of the
 * pulse the board fires, step by step → an arc-flicker shimmer → bang-to-bang
 * jitter (1 ± σ, driven by the shared noise low-passed at ~f0/2, one random
 * value per bang) → its place → the bus.
 */
export class SndSound {
  readonly slot: number;
  readonly physics: CoilResponse | null;
  readonly detune: number;
  private readonly source: OscillatorNode;
  private readonly env: GainNode;
  private readonly flick: GainNode;
  private readonly jitter: GainNode;
  private readonly jitterLp: BiquadFilterNode;
  private readonly jitterAmt: GainNode;
  private readonly panner: StereoPannerNode;
  /** jitterAmt's gain for a σ of 1, and the σ scheduled last (NaN: none yet). */
  private readonly jitterScale: number;
  private sigma = JITTER_SIGMA;
  // what is scheduled on its level
  private attacked = false;
  private lastT: number;
  private lastV = 0;
  private flatUntil: number | null = null;

  constructor(ctx: BaseAudioContext, private readonly noise: AudioNode, bus: AudioNode, s: SoundSpec) {
    this.slot = s.slot;
    this.physics = s.physics;
    this.detune = s.detune;
    this.lastT = s.when;
    this.env = ctx.createGain();
    this.env.gain.setValueAtTime(0, ctx.currentTime);
    this.flick = ctx.createGain();
    this.panner = ctx.createStereoPanner();
    this.panner.pan.value = s.pan;
    this.jitter = ctx.createGain();
    this.jitterLp = ctx.createBiquadFilter();
    this.jitterLp.type = 'lowpass';
    const fc = Math.max(JITTER_LP_MIN_HZ, s.hz * 0.5);
    this.jitterLp.frequency.value = fc;
    this.jitterLp.Q.value = -3; // dB for lowpass → ≈ Butterworth, no resonance
    this.jitterAmt = ctx.createGain();
    // a 2nd-order low-pass keeps ≈1.11·fc/(sr/2) of the white noise power → scale to σ.
    this.jitterScale = 1 / (NOISE_RMS * Math.sqrt((1.11 * fc) / (ctx.sampleRate / 2)));
    this.jitterAmt.gain.value = JITTER_SIGMA * this.jitterScale;
    if (s.textured) noise.connect(this.jitterLp).connect(this.jitterAmt).connect(this.jitter.gain);

    this.source = ctx.createOscillator();
    this.source.setPeriodicWave(s.wave);
    this.source.frequency.value = s.freq;
    this.source.connect(this.env);
    this.env.connect(this.flick).connect(this.jitter).connect(this.panner).connect(bus);
    if (s.textured) SndSound.scheduleFlicker(this.flick.gain, s.when);
    this.source.start(s.when);
  }

  /** Bounded mean-reverting random walk (~1.0 ±FLICKER_DEPTH) baked onto a gain → arc shimmer. */
  private static scheduleFlicker(g: AudioParam, when: number): void {
    g.setValueAtTime(1, when);
    let v = 1;
    const steps = Math.round((FLICKER_HORIZON_S * 1000) / FLICKER_STEP_MS);
    for (let i = 1; i <= steps; i++) {
      v += (1 - v) * 0.25 + (Math.random() * 2 - 1) * FLICKER_DEPTH * 0.6; // mean-revert + wander
      v = Math.min(1 + FLICKER_DEPTH, Math.max(1 - FLICKER_DEPTH, v));
      g.linearRampToValueAtTime(v, when + (i * FLICKER_STEP_MS) / 1000);
    }
  }

  /** Follows its note's pitch (Hz, its detune added) from `at`. */
  retune(hz: number, at: number): void {
    this.source.frequency.setValueAtTime(hz * this.detune, at);
  }

  /** Its level at `t`: ramps between the steps, nothing while it holds still; its roughness `sigma` from `t`. onAt: its note's. */
  schedule(onAt: number, t: number, g: number, sigma: number, textured: boolean): void {
    if (textured && sigma !== this.sigma) {
      this.jitterAmt.gain.setValueAtTime(sigma * this.jitterScale, Math.max(t, onAt));
      this.sigma = sigma;
    }
    const p = this.env.gain;
    if (!this.attacked) {
      // the gate's attack: from silence at the note-on
      this.attacked = true;
      p.setValueAtTime(0, onAt);
      this.lastT = onAt + ATTACK_MIN_S;
      p.linearRampToValueAtTime(g, this.lastT);
      this.lastV = g;
      this.flatUntil = null;
      return;
    }
    if (t <= this.lastT + EPS) return;
    if (Math.abs(g - this.lastV) < 1e-5) {
      this.flatUntil = t;
      return;
    }
    // the end of a still stretch, then the change
    if (this.flatUntil != null) p.linearRampToValueAtTime(this.lastV, this.flatUntil);
    p.linearRampToValueAtTime(g, t);
    this.lastT = t;
    this.lastV = g;
    this.flatUntil = null;
  }

  /** Its level from `when` dropped, to be scheduled again; false when nothing was scheduled yet. onAt: its note's. */
  rewind(when: number, onAt: number): boolean {
    if (!this.attacked) return false;
    holdAt(this.env.gain, when);
    if (Number.isFinite(this.sigma) && this.sigma !== JITTER_SIGMA) {
      this.jitterAmt.gain.cancelScheduledValues(when);
      this.sigma = NaN;
    }
    if (onAt >= when - EPS) this.attacked = false;
    this.lastT = when;
    this.lastV = NaN;
    this.flatUntil = null;
    return true;
  }

  /** Silent from `death`: faded over `fade` when cut short, else down from its last level. */
  close(death: number, fade: number | null): void {
    const p = this.env.gain;
    if (fade != null) {
      holdAt(p, death);
      p.linearRampToValueAtTime(0, death + fade);
    } else {
      if (this.flatUntil != null) p.linearRampToValueAtTime(this.lastV, this.flatUntil);
      p.linearRampToValueAtTime(0, Math.max(death, this.lastT + EPS));
    }
  }

  stop(at: number): void {
    try {
      this.source.stop(at);
    } catch {
      /* already stopped */
    }
  }

  /** Detach its chain from the bus so sounds don't pile up. */
  disconnect(when: number): void {
    this.stop(when);
    try {
      this.noise.disconnect(this.jitterLp);
    } catch {
      /* */
    }
    for (const node of [this.source, this.env, this.flick, this.jitter, this.jitterLp, this.jitterAmt, this.panner]) {
      try {
        node.disconnect();
      } catch {
        /* */
      }
    }
  }
}
