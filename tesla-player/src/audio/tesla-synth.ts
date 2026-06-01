import { decodeFrame, PN } from "@/sysex/syntherrupter";
import {
  envelopeAmplitude,
  envelopeReleaseMs,
  programSteps,
} from "@/sysex/envelopes";

/**
 * The subset of a MIDI output the app drives. Both a real WebMidi `Output` and
 * the built-in {@link TeslaSynthOutput} satisfy it, so they're interchangeable.
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

export const SYNTH_OUTPUT_ID = "__synth__";

// A musical Tesla coil's pitch IS the pulse-repetition frequency: each note is a
// periodic impulse train, i.e. a NARROW-DUTY pulse wave. Verified against a real
// recording ("3 Tesla coils - Megalovania", spectral analysis): all harmonics
// present (even+odd), ~-6 dB/oct slope, SHARP sinc nulls, ~tonal (flatness 8e-4,
// so NO noise / NO heavy distortion — that would add inharmonic content the real
// coil doesn't have). Each note is one band-limited pulse via a per-note
// PeriodicWave, which Web Audio synthesises with ZERO aliasing (only harmonics
// below Nyquist) — strictly more faithful than a PolyBLEP worklet (~-33 dB alias).
//
// KEY measured fact: the acoustic impulse has a roughly FIXED DURATION (strike
// τ≈230 µs), so the audio duty SCALES with pitch: dBody = BODY_SEC·f0. The first
// sinc null then sits at ~1/τ ≈ 4.3 kHz regardless of pitch (matching the measured
// centroid). Low notes are narrow/buzzy, high notes fuller. This audio duty is
// DISTINCT from the electrical SysEx duty (the free ring-down outlives the ontime);
// the electrical duty drives only loudness, never the pulse width.
const PULSE_HARMONICS_MAX = 256;
const BODY_SEC = 0.000231; // acoustic impulse extent (s); dBody = BODY_SEC·f0
const D_MIN = 0.04,
  D_MAX = 0.26; // clamp on the audio duty (≈B2..C6)
const PITCH_JITTER = 0.0007; // ±0.07% per-voice static PRF detune (measured 0.067%)
const ATTACK_MIN_S = 0.0012; // gate ramp floor — measured real attack ≈1.1 ms (snappy, not a click)
const FILTER_HZ = 9000; // per-voice low-pass — tames the over-clean upper sinc lobes (real D4/A4
// roll off hard above ~4-5 kHz) while keeping the buzz
const FORMANT_HZ = 2600,
  FORMANT_DB = 2.5,
  FORMANT_Q = 0.9; // gentle measured ~2.5 kHz body resonance
const REVERB_WET = 0.12; // light room send (dry coil + a touch of space)
// arc flicker: a real coil's streamer sputters → the sustain shimmers in amplitude (the
// recording is far from a flat tone). A bounded mean-reverting random walk on a per-voice
// gain emulates it WITHOUT a noise source (stays tonal). Baked as scheduled automation.
const FLICKER_DEPTH = 0.18,
  FLICKER_STEP_MS = 38,
  FLICKER_HORIZON_S = 2.2;

interface Stamped {
  when: number;
  v: number;
}
interface CoilState {
  mask: number;
  ontime: Stamped[];
  duty: Stamped[];
}
interface Voice {
  source: OscillatorNode;
  env: GainNode; // envelope shape × velocity (can exceed 1 on attack)
  flick: GainNode; // arc-flicker amplitude shimmer (per-voice random walk)
  loud: GainNode; // coil energy (re-modulated live by ontime/duty automation)
  filter: BiquadFilterNode;
  ch: number;
  program: number;
  velScale: number;
  startWhen: number;
  key: string;
}

const MAX_VOICES = 40;

function noteHz(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

/**
 * A Web-Audio "MIDI output" emulating Tesla-coil sound. Per note: one band-limited
 * pulse oscillator (a per-note PeriodicWave, pitch-scaled duty, zero aliasing) through
 * an open/bright low-pass, gated by the channel's Syntherrupter envelope (the VCA),
 * into a bus with a gentle body formant and a light reverb send. Loudness follows the
 * coil's ontime/duty tracked from the SysEx stream.
 */
export class TeslaSynthOutput implements MidiSink {
  readonly id = SYNTH_OUTPUT_ID;
  readonly name = "Tesla synth";

  private ctx: AudioContext;
  private bus: GainNode;
  private master: GainNode;
  private wet: GainNode; // reverb send level
  private pulseCache = new Map<number, PeriodicWave>(); // per MIDI note (duty depends only on pitch)
  private voices = new Map<string, Voice>();
  private live: Voice[] = [];
  private channelProgram: number[] = new Array(16).fill(0);
  private coils: CoilState[] = [];

  constructor() {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.ctx = new Ctx();
    // bus → body formant → limiter → gain → speakers, plus a light parallel reverb send.
    this.bus = this.ctx.createGain();
    const formant = this.ctx.createBiquadFilter();
    formant.type = "peaking";
    formant.frequency.value = FORMANT_HZ;
    formant.gain.value = FORMANT_DB;
    formant.Q.value = FORMANT_Q;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 8;
    comp.attack.value = 0.002;
    comp.release.value = 0.18;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.34;
    this.bus
      .connect(formant)
      .connect(comp)
      .connect(this.master)
      .connect(this.ctx.destination);
    const conv = this.ctx.createConvolver();
    conv.buffer = this.makeReverbIR(0.9, 2.6);
    this.wet = this.ctx.createGain();
    this.wet.gain.value = REVERB_WET;
    comp.connect(conv).connect(this.wet).connect(this.ctx.destination);
  }

  resume(): void {
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  /** Short decaying-noise impulse response for a subtle room (not a tone source). */
  /** Bounded mean-reverting random walk (~1.0 ±FLICKER_DEPTH) baked onto a per-voice gain → arc shimmer. */
  private scheduleFlicker(g: AudioParam, when: number): void {
    g.setValueAtTime(1, when);
    let v = 1;
    const steps = Math.round((FLICKER_HORIZON_S * 1000) / FLICKER_STEP_MS);
    for (let i = 1; i <= steps; i++) {
      v += (1 - v) * 0.25 + (Math.random() * 2 - 1) * FLICKER_DEPTH * 0.6; // mean-revert + wander
      v = Math.min(1 + FLICKER_DEPTH, Math.max(1 - FLICKER_DEPTH, v));
      g.linearRampToValueAtTime(v, when + (i * FLICKER_STEP_MS) / 1000);
    }
  }

  /** Short decaying-noise impulse response for a subtle room (not a tone source). */
  private makeReverbIR(seconds: number, decay: number): AudioBuffer {
    const sr = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(seconds * sr));
    const ir = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++)
        data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
    }
    return ir;
  }

  /**
   * Band-limited pulse wave for a note: a duty-d impulse train (imag[n] ∝ sin(nπd)/n →
   * even+odd harmonics, sinc nulls at h=k/d, -6 dB/oct), capped at the last harmonic
   * below Nyquist so there is no aliasing. Cached per MIDI note (duty depends on pitch).
   */
  private pulseFor(note: number): PeriodicWave {
    const cached = this.pulseCache.get(note);
    if (cached) return cached;
    const hz = noteHz(note);
    const d = Math.min(D_MAX, Math.max(D_MIN, BODY_SEC * hz));
    const n = Math.max(
      1,
      Math.min(
        PULSE_HARMONICS_MAX,
        Math.floor(this.ctx.sampleRate / 2 / hz) - 1,
      ),
    );
    const real = new Float32Array(new ArrayBuffer((n + 1) * 4));
    const imag = new Float32Array(new ArrayBuffer((n + 1) * 4));
    for (let h = 1; h <= n; h++)
      imag[h] = (2 / (h * Math.PI)) * Math.sin(h * Math.PI * d);
    const wave = this.ctx.createPeriodicWave(real, imag, {
      disableNormalization: false,
    });
    this.pulseCache.set(note, wave);
    return wave;
  }

  // --- MidiSink ------------------------------------------------------------
  send(data: number[], options?: { time?: number | string }): void {
    if (!data || data.length === 0) return;
    const when = this.toAudioTime(options?.time);
    const status =
      typeof data[0] === "number"
        ? data[0]
        : parseInt(String(data[0]).replace(/^0x/i, ""), 16);
    const kind = status & 0xf0;
    const ch = status & 0x0f;
    if (kind === 0x90 && data[2] > 0) this.noteOn(ch, data[1], data[2], when);
    else if (kind === 0x80 || (kind === 0x90 && data[2] === 0))
      this.noteOff(ch, data[1], when);
    else if (kind === 0xc0) this.channelProgram[ch] = data[1];
    else if (status === 0xf0) this.applyFrame(data, when);
  }

  sendSysex(manufacturer: number | number[], data: number[]): void {
    const mfr = Array.isArray(manufacturer) ? manufacturer : [manufacturer];
    this.applyFrame([0xf0, ...mfr, ...data, 0xf7], this.ctx.currentTime);
  }

  sendAllSoundOff(): void {
    for (const v of [...this.live])
      this.endVoice(v, this.ctx.currentTime, 0.01);
    this.voices.clear();
  }

  clear(): void {
    for (const v of [...this.live])
      this.disposeVoice(v, this.ctx.currentTime, 0);
    this.live = [];
    this.voices.clear();
    this.coils = [];
    this.channelProgram = new Array(16).fill(0);
  }

  // --- internals -----------------------------------------------------------
  private toAudioTime(time?: number | string): number {
    const ms = time != null ? Number(time) : NaN;
    if (!Number.isFinite(ms)) return this.ctx.currentTime;
    return this.ctx.currentTime + Math.max(0, (ms - performance.now()) / 1000);
  }

  private applyFrame(frame: number[], when: number): void {
    let dec;
    try {
      dec = decodeFrame(frame);
    } catch {
      return;
    }
    const c = dec.coil;
    if (c < 0 || c > 5) return;
    const cs = (this.coils[c] ??= { mask: 0, ontime: [], duty: [] });
    if (dec.pn === PN.ONTIME) cs.ontime.push({ when, v: dec.valueInt });
    else if (dec.pn === PN.DUTY) cs.duty.push({ when, v: dec.valueFloat });
    else if (dec.pn === PN.CHANNEL_MAP) cs.mask = dec.valueInt;
    if (dec.pn === PN.ONTIME || dec.pn === PN.DUTY) this.remodulate(c, when);
  }

  private stampAt(list: Stamped[], when: number, fallback: number): number {
    let v = fallback;
    let best = -Infinity;
    for (const s of list)
      if (s.when <= when + 1e-4 && s.when >= best) {
        best = s.when;
        v = s.v;
      }
    return v;
  }
  private channelParams(
    ch: number,
    when: number,
  ): { ontime: number; duty: number } {
    for (let c = 0; c < this.coils.length; c++) {
      const cs = this.coils[c];
      if (cs && (cs.mask & (1 << ch)) !== 0) {
        return {
          ontime: this.stampAt(cs.ontime, when, 0),
          duty: this.stampAt(cs.duty, when, 0),
        };
      }
    }
    return { ontime: 40, duty: 0.05 };
  }
  private static energy(ontime: number, duty: number): number {
    return Math.max(0.04, Math.min(1, (ontime * duty) / 4));
  }

  /**
   * Schedule the attack→sustain envelope on a gain param by sampling the real curve
   * step-by-step (~8 ms within each step so short attacks aren't missed). A floor of
   * ATTACK_MIN on the very first ramp prevents the click of an instant gate (P0).
   */
  private scheduleAttack(
    g: AudioParam,
    program: number,
    velScale: number,
    when: number,
  ): void {
    const a0 = envelopeAmplitude(program, 0, null) * velScale;
    g.setValueAtTime(0.0001, when);
    let startMs = 0;
    if (a0 > 0.001) {
      g.linearRampToValueAtTime(a0, when + ATTACK_MIN_S);
      startMs = ATTACK_MIN_S * 1000;
    }

    const steps = programSteps(program);
    let acc = 0;
    let cur = 0;
    for (let guard = 0; guard < 16; guard++) {
      const s = steps[cur];
      const dur = Math.max(0, s.durMs);
      if (dur > 0) {
        const m = Math.max(1, Math.min(16, Math.round(dur / 8)));
        for (let k = 1; k <= m; k++) {
          const tMs = acc + (k / m) * dur;
          if (tMs > startMs) {
            g.linearRampToValueAtTime(
              Math.max(
                0.0001,
                envelopeAmplitude(program, tMs, null) * velScale,
              ),
              when + tMs / 1000,
            );
          }
        }
        acc += dur;
      }
      if (s.next === cur || acc > 8000) break;
      cur = s.next;
    }
  }

  private noteOn(ch: number, note: number, vel: number, when: number): void {
    if (this.live.length >= MAX_VOICES) {
      const st = this.live.shift();
      if (st) {
        this.voices.delete(st.key);
        this.disposeVoice(st, when, 0.01);
      }
    }
    const { ontime, duty } = this.channelParams(ch, when);
    const energy = TeslaSynthOutput.energy(ontime, duty);
    // Linear in velocity, matching the Syntherrupter firmware (ontime ∝ velocity/127).
    const velScale = vel / 127;
    const program = this.channelProgram[ch] ?? 0;
    const ctx = this.ctx;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, ctx.currentTime);
    const flick = ctx.createGain();
    const loud = ctx.createGain();
    loud.gain.setValueAtTime(energy, ctx.currentTime);
    // ~Butterworth low-pass (no resonance) — tames the over-clean upper sinc lobes.
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = FILTER_HZ;
    filter.Q.value = 0.7;

    const source = ctx.createOscillator();
    source.setPeriodicWave(this.pulseFor(note));
    // tiny static per-voice detune (measured PRF jitter ≈0.07%) so repeated/stacked
    // notes aren't digitally identical.
    source.frequency.value =
      noteHz(note) * (1 + (Math.random() * 2 - 1) * PITCH_JITTER);
    source.connect(env);
    env.connect(flick).connect(loud).connect(filter).connect(this.bus);
    this.scheduleAttack(env.gain, program, velScale, when);
    this.scheduleFlicker(flick.gain, when);
    source.start(when);

    const key = `${ch}:${note}`;
    const prev = this.voices.get(key);
    if (prev) this.endVoice(prev, when, 0.01);
    const voice: Voice = {
      source,
      env,
      flick,
      loud,
      filter,
      ch,
      program,
      velScale,
      startWhen: when,
      key,
    };
    this.voices.set(key, voice);
    this.live.push(voice);
  }

  private noteOff(ch: number, note: number, when: number): void {
    const key = `${ch}:${note}`;
    const v = this.voices.get(key);
    if (!v) return;
    this.voices.delete(key);
    const relMs = envelopeReleaseMs(v.program);
    const heldElapsed = Math.max(0, (when - v.startWhen) * 1000);
    try {
      this.holdAt(v.env.gain, when);
      const n = Math.max(2, Math.min(16, Math.round(relMs / 8)));
      for (let i = 1; i <= n; i++) {
        const rt = (i / n) * relMs;
        const amp =
          envelopeAmplitude(v.program, heldElapsed + rt, heldElapsed) *
          v.velScale;
        v.env.gain.linearRampToValueAtTime(
          Math.max(0.0001, amp),
          when + rt / 1000,
        );
      }
    } catch {
      /* */
    }
    this.disposeVoice(v, when, relMs / 1000 + 0.05);
  }

  private endVoice(v: Voice, when: number, release = 0.02): void {
    try {
      this.holdAt(v.env.gain, when);
      v.env.gain.linearRampToValueAtTime(0.0001, when + release);
    } catch {
      /* */
    }
    this.disposeVoice(v, when, release + 0.05);
  }

  /** Stop a voice's oscillator and detach its chain from the bus so voices don't pile up. */
  private disposeVoice(v: Voice, when: number, tailS: number): void {
    try {
      v.source.stop(when + tailS);
    } catch {
      /* already stopped */
    }
    const i = this.live.indexOf(v);
    if (i !== -1) this.live.splice(i, 1);
    const delayMs =
      Math.max(0, (when - this.ctx.currentTime + tailS) * 1000) + 40;
    setTimeout(() => {
      try {
        v.source.disconnect();
      } catch {
        /* */
      }
      try {
        v.env.disconnect();
      } catch {
        /* */
      }
      try {
        v.flick.disconnect();
      } catch {
        /* */
      }
      try {
        v.loud.disconnect();
      } catch {
        /* */
      }
      try {
        v.filter.disconnect();
      } catch {
        /* */
      }
    }, delayMs);
  }

  private holdAt(g: AudioParam, when: number): void {
    if (typeof g.cancelAndHoldAtTime === "function")
      g.cancelAndHoldAtTime(when);
    else {
      g.cancelScheduledValues(when);
      g.setValueAtTime(Math.max(0.0001, g.value), when);
    }
  }

  /** Re-apply coil energy to live notes when the coil's ontime/duty changes. */
  private remodulate(coil: number, when: number): void {
    const cs = this.coils[coil];
    if (!cs) return;
    const target = TeslaSynthOutput.energy(
      this.stampAt(cs.ontime, when, 40),
      this.stampAt(cs.duty, when, 0.05),
    );
    for (const v of this.live) {
      if ((cs.mask & (1 << v.ch)) === 0) continue;
      try {
        this.holdAt(v.loud.gain, when);
        v.loud.gain.linearRampToValueAtTime(
          Math.max(0.0001, target),
          when + 0.03,
        );
      } catch {
        /* */
      }
    }
  }
}

let singleton: TeslaSynthOutput | null = null;
/** Lazily create the shared built-in synth (its AudioContext starts suspended). */
export function getTeslaSynth(): TeslaSynthOutput {
  if (!singleton) singleton = new TeslaSynthOutput();
  return singleton;
}
