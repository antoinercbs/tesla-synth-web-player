import { decodeFrame, PN } from "@/sysex/syntherrupter";
import {
  envelopeAmplitude,
  envelopeReleaseMs,
  programSteps,
} from "@/sysex/envelopes";
import { pitchGain, pulseCoefficients } from "@/audio/tesla-impulse";

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

// A musical Tesla coil's pitch IS the pulse-repetition frequency: each note is ONE acoustic
// impulse repeated at f0, so its harmonics sample the impulse spectrum |P(k·f0)|. That
// impulse — measured on the club's three coils, see `tesla-impulse.ts` — is a doublet
// (ignition click, extinction click ≈214 µs later) whose spectrum rises +6 dB/oct up to
// ~2.3 kHz and is notched at ~4.7 kHz: bass notes have almost no fundamental and buzz, high
// notes carry their energy on the 2nd/3rd harmonic. Each note is one band-limited waveform
// via a per-note PeriodicWave (only harmonics below Nyquist → ZERO aliasing), which Web Audio
// peak-normalises: the SAME bang at every pitch, exactly what the recordings show (constant
// impulse, RMS growing with pitch). The electrical SysEx ontime/duty drive only loudness.
//
// Texture: the recordings are ~85% tonal in the mids but the bangs are not identical — the
// inter-harmonic floor sits ~10 dB under the harmonics — so each voice's amplitude is
// modulated by low-passed noise (bandwidth ≈ f0/2 → one random gain per bang), on top of a
// slow mean-reverting flicker (streamer sputter). No additive noise: the pulse stays tonal.
const PULSE_HARMONICS_MAX = 256;
const PITCH_JITTER = 0.0007; // ±0.07% per-voice static PRF detune (measured 0.067%)
const ATTACK_MIN_S = 0.0012; // gate ramp floor — measured real attack ≈1.1 ms (snappy, not a click)
const REVERB_WET = 0.12; // light room send (dry coil + a touch of space)
// arc flicker: a real coil's streamer sputters → the sustain shimmers in amplitude (the
// recording is far from a flat tone). A bounded mean-reverting random walk on a per-voice
// gain emulates it WITHOUT a noise source (stays tonal). Baked as scheduled automation.
const FLICKER_DEPTH = 0.18,
  FLICKER_STEP_MS = 38,
  FLICKER_HORIZON_S = 2.2;
// bang-to-bang amplitude jitter: white noise low-passed at ~f0/2 (one random value per bang),
// scaled to an RMS of JITTER_SIGMA around 1 → inter-harmonic floor ≈ 20·log10(σ) ≈ −12 dB.
const JITTER_SIGMA = 0.25;
const JITTER_LP_MIN_HZ = 25;
const NOISE_SECONDS = 2;
const NOISE_RMS = 1 / Math.sqrt(3); // uniform [-1, 1]
// the doublet waveform has a higher crest factor than the old rectangular pulse (RMS ≈ 3 dB
// lower at the same peak) → a bit more master gain to keep the same loudness.
const MASTER_GAIN = 0.42;

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
  jitter: GainNode; // bang-to-bang amplitude jitter (1 ± σ, driven by low-passed noise)
  jitterLp: BiquadFilterNode;
  jitterAmt: GainNode;
  loud: GainNode; // coil energy × pitch gain (re-modulated live by ontime/duty automation)
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
 * impulse-train oscillator (a per-note PeriodicWave built from the measured coil impulse
 * spectrum, zero aliasing), gated by the channel's Syntherrupter envelope (the VCA),
 * roughened by per-bang amplitude jitter and a slow flicker, into a bus with a limiter and
 * a light reverb send. Loudness follows the coil's ontime/duty tracked from the SysEx stream.
 */
export class TeslaSynthOutput implements MidiSink {
  readonly id = SYNTH_OUTPUT_ID;
  readonly name = "Tesla synth";

  private ctx: AudioContext;
  private bus: GainNode;
  private master: GainNode;
  private wet: GainNode; // reverb send level
  private noise: AudioBufferSourceNode; // shared white noise, low-passed per voice
  private pulseCache = new Map<number, PeriodicWave>(); // per MIDI note (spectrum depends only on pitch)
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
    // bus → limiter → gain → speakers, plus a light parallel reverb send.
    this.bus = this.ctx.createGain();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 8;
    comp.attack.value = 0.002;
    comp.release.value = 0.18;
    this.master = this.ctx.createGain();
    this.master.gain.value = MASTER_GAIN;
    this.bus.connect(comp).connect(this.master).connect(this.ctx.destination);
    const conv = this.ctx.createConvolver();
    conv.buffer = this.makeReverbIR(0.9, 2.6);
    this.wet = this.ctx.createGain();
    this.wet.gain.value = REVERB_WET;
    comp.connect(conv).connect(this.wet).connect(this.ctx.destination);
    // one looping noise source feeds every voice's jitter low-pass (a modulator, never audible
    // by itself — it only reaches the graph through GainNode.gain params).
    this.noise = this.ctx.createBufferSource();
    this.noise.buffer = this.makeNoise(NOISE_SECONDS);
    this.noise.loop = true;
    this.noise.start();
  }

  resume(): void {
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

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

  /** Mono uniform white noise in [-1, 1] (RMS = NOISE_RMS), looped as the jitter modulator. */
  private makeNoise(seconds: number): AudioBuffer {
    const sr = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(seconds * sr));
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /**
   * Band-limited impulse train for a note: the measured coil impulse spectrum sampled at the
   * harmonics (see `pulseCoefficients`), capped at the last harmonic below Nyquist so there is
   * no aliasing. Cached per MIDI note (the spectrum depends only on pitch).
   */
  private pulseFor(note: number): PeriodicWave {
    const cached = this.pulseCache.get(note);
    if (cached) return cached;
    const { real, imag } = pulseCoefficients(
      noteHz(note),
      this.ctx.sampleRate,
      PULSE_HARMONICS_MAX,
    );
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
  /**
   * Map a `performance.now()`-domain timestamp (as a real WebMIDI output uses in
   * `send(msg, {time})`) to the audio clock so the SOUND reaches the speakers AT
   * that timestamp — i.e. in lock-step with a real MIDI output scheduled at the
   * same time and with the visual playhead. The naive `currentTime + (ms - now)`
   * ignores the output latency (the gap between an `AudioContext` time and the
   * speaker), so the synth would lag by ~10-40 ms (more over Bluetooth).
   *
   * `getOutputTimestamp()` returns the contextTime↔performanceTime pair AT THE
   * OUTPUT, which already folds in that latency; recomputing it per event also
   * prevents the audio and performance clocks from drifting apart over a long
   * song. Fall back to subtracting `outputLatency`/`baseLatency` if unavailable.
   */
  private toAudioTime(time?: number | string): number {
    const ms = time != null ? Number(time) : NaN;
    if (!Number.isFinite(ms)) return this.ctx.currentTime;
    const ts = this.ctx.getOutputTimestamp?.();
    let when: number;
    if (
      ts &&
      typeof ts.contextTime === "number" &&
      ts.contextTime > 0 &&
      typeof ts.performanceTime === "number"
    ) {
      when = ts.contextTime + (ms - ts.performanceTime) / 1000;
    } else {
      const lat = this.ctx.outputLatency || this.ctx.baseLatency || 0;
      when = this.ctx.currentTime + (ms - performance.now()) / 1000 - lat;
    }
    return Math.max(this.ctx.currentTime, when);
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
    const hz = noteHz(note);
    const energy = TeslaSynthOutput.energy(ontime, duty) * pitchGain(hz);
    // Linear in velocity, matching the Syntherrupter firmware (ontime ∝ velocity/127).
    const velScale = vel / 127;
    const program = this.channelProgram[ch] ?? 0;
    const ctx = this.ctx;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, ctx.currentTime);
    const flick = ctx.createGain();
    const loud = ctx.createGain();
    loud.gain.setValueAtTime(energy, ctx.currentTime);

    // bang-to-bang jitter: gain 1 + noise low-passed at ~f0/2 (≈ one random value per bang).
    const jitter = ctx.createGain();
    const jitterLp = ctx.createBiquadFilter();
    jitterLp.type = "lowpass";
    const fc = Math.max(JITTER_LP_MIN_HZ, hz * 0.5);
    jitterLp.frequency.value = fc;
    jitterLp.Q.value = -3; // dB for lowpass → ≈ Butterworth, no resonance
    const jitterAmt = ctx.createGain();
    // a 2nd-order low-pass keeps ≈1.11·fc/(sr/2) of the white noise power → scale to σ.
    jitterAmt.gain.value =
      JITTER_SIGMA / (NOISE_RMS * Math.sqrt((1.11 * fc) / (ctx.sampleRate / 2)));
    this.noise.connect(jitterLp).connect(jitterAmt).connect(jitter.gain);

    const source = ctx.createOscillator();
    source.setPeriodicWave(this.pulseFor(note));
    // tiny static per-voice detune (measured PRF jitter ≈0.07%) so repeated/stacked
    // notes aren't digitally identical.
    source.frequency.value = hz * (1 + (Math.random() * 2 - 1) * PITCH_JITTER);
    source.connect(env);
    env.connect(flick).connect(jitter).connect(loud).connect(this.bus);
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
      jitter,
      jitterLp,
      jitterAmt,
      loud,
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
        this.noise.disconnect(v.jitterLp);
      } catch {
        /* */
      }
      for (const node of [
        v.source,
        v.env,
        v.flick,
        v.jitter,
        v.jitterLp,
        v.jitterAmt,
        v.loud,
      ]) {
        try {
          node.disconnect();
        } catch {
          /* */
        }
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
    const base = TeslaSynthOutput.energy(
      this.stampAt(cs.ontime, when, 40),
      this.stampAt(cs.duty, when, 0.05),
    );
    for (const v of this.live) {
      if ((cs.mask & (1 << v.ch)) === 0) continue;
      try {
        this.holdAt(v.loud.gain, when);
        v.loud.gain.linearRampToValueAtTime(
          Math.max(0.0001, base * pitchGain(v.source.frequency.value)),
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
