import { markRaw } from "vue";
import { decodeFrame, ENVELOPE_PN, MODE_BYTE, PAN_PN, PN } from "@/sysex/syntherrupter";
import { CENTER, panVolume } from "@/midi/stereo";
import {
  ENVELOPE_STEP_COUNT,
  RELEASE_STEP,
  programSteps,
  stepsAmplitude,
  type EnvStep,
} from "@/sysex/envelopes";
import {
  LEVEL_LAW,
  pulseCoefficients,
  pulseLevel,
  retroPulseCoefficients,
  type LevelLaw,
} from "@/audio/tesla-impulse";
import { BoardCore, type BoardCoil, type BoardNote } from "@/devices/board-core";
import { DEFAULT_COIL_LIMITS, type CoilLimits } from "@/devices/coil-limits";
import { fixedOntimeUs } from "@/devices/ontime-model";

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

/**
 * The built-in synth's timbre. "tesla": the measured coil impulse with the arc's texture;
 * "clean": the same impulse, steady (no jitter, flicker or detune) — clearer to compose by
 * ear; "pulse": the synth's first model, a fixed-width rectangular pulse.
 */
export type SynthModel = "tesla" | "clean" | "pulse";
export const SYNTH_MODELS: readonly SynthModel[] = ["tesla", "clean", "pulse"];

// A musical Tesla coil's pitch IS the pulse-repetition frequency: each note is ONE acoustic
// impulse repeated at f0, so its harmonics sample the impulse spectrum |P(k·f0)|. That
// impulse — measured on the club's three coils, see `tesla-impulse.ts` — is a doublet
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
const PULSE_HARMONICS_MAX = 256;
const PITCH_JITTER = 0.0007; // ±0.07% per-voice static PRF detune (measured 0.067%)
const ATTACK_MIN_S = 0.0012; // gate ramp floor — measured real attack ≈1.1 ms (snappy, not a click)
const REVERB_WET = 0.29; // light room send, relative to the dry coil
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
// lower at the same peak) → a bit more master gain. Matched by K-weighted loudness to the
// former compressed bus, so dropping its make-up gain for the limiter kept the level.
const MASTER_GAIN = 0.335;
// at −2 dB, stacked chords still overshot 0 dBFS now and then (attack + make-up gain)
const LIMITER_THRESHOLD_DB = -4;
// The level of the reference pulse (tesla-impulse.ts pulseLevel): the former model's for
// 40 µs / 5 % on A4, so the app's default settings keep their loudness. The retro pulse is
// flat across pitch, and as loud as the Tesla model (K-weighted, same test phrase).
const TESLA_REF_GAIN = 0.25;
const PULSE_REF_GAIN = 0.21;

// The board (MIDI.cpp, Channel.cpp): its notes are looked at on this grid and at every event
// in between (the firmware does every 2 ms), up to a little ahead of the audio clock; an
// event landing inside what is already scheduled reschedules from its time.
const STEP_S = 0.008;
const HORIZON_S = 0.2;
const PUMP_MS = 25;
const EPS = 1e-6;
// the board's LFO on the modulation wheel (CC1), its EEPROM defaults
const LFO_HZ = 5;
const LFO_DEPTH = 0.5;
// the soft pedal (CC67) multiplies a held note's volume
const SOFT_PEDAL = 0.6;
const BEND_RANGE = 2; // semitones, after a reset
// no coil configured yet: the notes play on one of these, rather than not at all
const UNCONFIGURED: BoardCoil = { drive: { ontimeUs: 40, duty: 0.05 }, limits: DEFAULT_COIL_LIMITS };

interface Stamped {
  when: number;
  v: number;
}

/** A value along the audio clock: what a controller or a coil setting is at any moment. */
class Timeline {
  private points: Stamped[] = [];
  constructor(private readonly initial: number) {}

  set(when: number, v: number): void {
    let i = this.points.length;
    while (i > 0 && this.points[i - 1].when > when) i--;
    this.points.splice(i, 0, { when, v });
  }

  at(t: number): number {
    for (let i = this.points.length - 1; i >= 0; i--) if (this.points[i].when <= t + EPS) return this.points[i].v;
    return this.initial;
  }

  /** Forget what came before `t`, keeping the value it left. */
  prune(t: number): void {
    let i = 0;
    while (i + 1 < this.points.length && this.points[i + 1].when <= t) i++;
    if (i > 0) this.points.splice(0, i);
  }
}

interface CoilState {
  mask: number;
  ontime: Timeline;
  duty: Timeline;
}
/** A channel's controllers, as Channel.h holds them (the times they changed included). */
interface ChannelState {
  volume: Timeline;
  expression: Timeline;
  modulation: Timeline;
  soft: Timeline;
  sustain: Timeline;
  pan: Timeline;
  /** Semitones off the note: the pitch bend × its range, plus the tuning. */
  bend: Timeline;
  /** When its controllers changed: the firmware looks at its notes again then. */
  touches: number[];
  bendRaw: number;
  rangeCoarse: number;
  rangeFine: number;
  fineCoarse: number;
  fineFine: number;
  coarseTuning: number;
  /** The RPN selected (0x7f7f: none); the NRPN one is in ChannelNrp. */
  rpn: number;
}
/** A channel's note pan mapping (NRP 42) and its NRPN selection, as Channel.h holds them. */
interface ChannelNrp {
  selMsb: number;
  selLsb: number;
  mode: number;
  srcLow: number;
  srcHigh: number;
  tgtLow: number;
  tgtHigh: number;
}
interface CoilPlace {
  /** 0..1, or -1: not placed (the coil plays every note it is assigned). */
  position: number;
  reach: number;
  single: boolean;
}
const COIL_SLOTS = 6;
/** A coil's fixed (Simple mode) tone, as the device holds it: firing rate, ontime, duty. */
interface SimpleParams {
  bps: number;
  ontime: number;
  duty: number;
}
interface SimpleTone {
  source: OscillatorNode;
  loud: GainNode;
  panner: StereoPannerNode;
  hz: number;
}
// a fixed tone may fire a few times a second: its bang keeps its clicks up to this many harmonics
const SIMPLE_HARMONICS_MAX = 2048;
const freshNrp = (): ChannelNrp => ({ selMsb: 127, selLsb: 127, mode: 0, srcLow: 0, srcHigh: 127, tgtLow: 0, tgtHigh: 1 });
const freshPlace = (): CoilPlace => ({ position: -1, reach: 1, single: false });
const freshChannel = (): ChannelState => ({
  volume: new Timeline(1),
  expression: new Timeline(1),
  modulation: new Timeline(0),
  soft: new Timeline(0),
  sustain: new Timeline(0),
  pan: new Timeline(CENTER),
  bend: new Timeline(0),
  touches: [],
  bendRaw: 0,
  rangeCoarse: BEND_RANGE,
  rangeFine: 0,
  fineCoarse: 64,
  fineFine: 0,
  coarseTuning: 0,
  rpn: 0x7f7f,
});

interface VoiceAudio {
  source: OscillatorNode;
  env: GainNode; // the level of the pulse the board fires, step by step
  flick: GainNode; // arc-flicker amplitude shimmer (per-voice random walk)
  jitter: GainNode; // bang-to-bang amplitude jitter (1 ± σ, driven by low-passed noise)
  jitterLp: BiquadFilterNode;
  jitterAmt: GainNode;
  panner: StereoPannerNode; // where the coils playing it stand
}

/** A note on the board's list, from its note-on until its release is over. */
interface Voice {
  id: number;
  /** Null: no coil plays its channel; it still takes the board's voices. */
  audio: VoiceAudio | null;
  retro: boolean;
  /** The static detune of its pulse rate (1 for the steady models). */
  detune: number;
  note: number;
  vel: number;
  ch: number;
  steps: EnvStep[];
  releaseS: number;
  onAt: number;
  keyUp: number | null;
  /** When its envelope went to the release: the key up, or the pedal up after it. */
  releaseAt: number | null;
  /** Cut short (struck again, stolen, all sound off), with its fade. */
  endAt: number | null;
  endFade: number;
  /** When it changed on its own (its key up): the firmware looks at it again then. */
  touches: number[];
  /** How loud each coil plays it (the spatialisation); 0 = not at all. */
  coilVol: number[];
  placeRev: number;
  key: string;
  // what is scheduled on its level
  attacked: boolean;
  closed: boolean;
  lastT: number;
  lastV: number;
  flatUntil: number | null;
}

const MAX_VOICES = 40;

function noteHz(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

/** When a voice leaves the board's list: its release over, or cut short. */
function deathOf(v: Voice): number | null {
  if (v.endAt != null) return v.endAt;
  return v.releaseAt != null ? v.releaseAt + v.releaseS : null;
}

/**
 * A Web-Audio "MIDI output" emulating Tesla-coil sound. Per note: one band-limited
 * impulse-train oscillator (a per-note PeriodicWave built from the measured coil impulse
 * spectrum, zero aliasing), roughened by per-bang amplitude jitter and a slow flicker, into a
 * bus with a limiter and a light reverb send.
 *
 * Its loudness is the board's: the synth holds the board's MIDI state (the notes, each
 * channel's controllers and envelope, each coil's ontime, duty, channels, place and limits)
 * and, step by step, works out the pulse each coil fires for each note the way the firmware
 * does (devices/board-core.ts, devices/ontime-model.ts): a note's volume (velocity, CC7,
 * CC11, envelope, soft pedal, LFO, pan), the crossover, the coil's voices, its max ontime and
 * duty, its min ontime, the output's floor. A note sounds as loud as the longest pulse fired
 * for it (tesla-impulse.ts pulseLevel). The other {@link SynthModel}s keep all of that but the
 * timbre.
 */
export class TeslaSynthOutput implements MidiSink {
  readonly id = SYNTH_OUTPUT_ID;
  readonly name = "Tesla synth";

  private ctx: AudioContext;
  private bus: GainNode;
  private master: GainNode;
  private wet: GainNode; // reverb send level
  private noise: AudioBufferSourceNode; // shared white noise, low-passed per voice
  private model: SynthModel = "tesla"; // applies from the next note-on
  private law: Readonly<LevelLaw>;
  private pulseCache = new Map<number, PeriodicWave>(); // per MIDI note (spectrum depends only on pitch)
  private retroCache = new Map<number, PeriodicWave>();
  // the keys down (or held by the pedal), to find a note-off's voice
  private voices = new Map<string, Voice>();
  // the board's list, in the order the notes came
  private live: Voice[] = [];
  private nextId = 1;
  private channelProgram: number[] = new Array(16).fill(0);
  private coils: (CoilState | undefined)[] = [];
  private limits: readonly CoilLimits[] = [];
  private running = false;
  // Envelopes written over SysEx, like the device's RAM: kept across clear()
  // (a device forgets them only on reboot). Unwritten programs use the shared table.
  private writtenPrograms = new Map<number, EnvStep[]>();
  // Spatialisation as the device holds it (MIDI.h, Channel.h); cleared with the coils' state.
  private coilPlace: CoilPlace[] = Array.from({ length: COIL_SLOTS }, freshPlace);
  private placeRev = 0;
  private chan: ChannelState[] = Array.from({ length: 16 }, freshChannel);
  private nrp: ChannelNrp[] = Array.from({ length: 16 }, freshNrp);
  // the board stepped ahead of the audio clock, and what it was at each step (to step again)
  private core = new BoardCore();
  private snapshots: { t: number; core: BoardCore }[] = [];
  private scheduledUntil = 0;
  private lastStep = 0;
  private marks: number[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  // the earliest change of a burst of events, stepped once they are all in
  private pendingFrom: number | null = null;
  // Simple ("fixed") mode: its own per-coil parameters, and a steady tone per coil while enabled
  private simple: (SimpleParams | undefined)[] = [];
  private simpleOn = false;
  private simpleTones = new Map<number, SimpleTone>();
  private simpleWaves = new Map<string, PeriodicWave>();

  /** `law`: how loud a pulse sounds, LEVEL_LAW unless an A/B tries another. */
  constructor({ law = LEVEL_LAW }: { law?: Readonly<LevelLaw> } = {}) {
    this.law = law;
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.ctx = new Ctx();
    // bus → gain → limiter → speakers, plus a light parallel reverb send into the same limiter.
    // The limiter only catches overshoots near 0 dBFS: the former bus compressor (−12 dB
    // threshold) worked on every note, and A/B listening heard it as a harsher bass.
    this.bus = this.ctx.createGain();
    this.master = this.ctx.createGain();
    this.master.gain.value = MASTER_GAIN;
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = LIMITER_THRESHOLD_DB;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.2;
    this.bus.connect(this.master).connect(limiter).connect(this.ctx.destination);
    const conv = this.ctx.createConvolver();
    conv.buffer = this.makeReverbIR(0.9, 2.6);
    this.wet = this.ctx.createGain();
    this.wet.gain.value = REVERB_WET;
    this.master.connect(conv).connect(this.wet).connect(limiter);
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

  setModel(model: SynthModel): void {
    this.model = model;
  }

  /** Each coil's limits, by coil index, as the board holds them (or is taken to). */
  setCoilLimits(limits: readonly CoilLimits[]): void {
    this.limits = limits;
    this.changedAt(this.ctx.currentTime);
    this.syncSimple(this.ctx.currentTime);
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

  /** The "pulse" model's wave, band-limited and cached the same way. */
  private retroPulseFor(note: number): PeriodicWave {
    const cached = this.retroCache.get(note);
    if (cached) return cached;
    const { real, imag } = retroPulseCoefficients(noteHz(note), this.ctx.sampleRate, PULSE_HARMONICS_MAX);
    const wave = this.ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    this.retroCache.set(note, wave);
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
    else if (kind === 0xb0) this.control(ch, data[1], data[2], when);
    else if (kind === 0xe0) this.pitchBend(ch, data[1] + data[2] * 128 - 8192, when);
    else if (status === 0xf0) this.applyFrame(data, when);
  }

  sendSysex(manufacturer: number | number[], data: number[]): void {
    const mfr = Array.isArray(manufacturer) ? manufacturer : [manufacturer];
    this.applyFrame([0xf0, ...mfr, ...data, 0xf7], this.ctx.currentTime);
  }

  sendAllSoundOff(): void {
    const now = this.ctx.currentTime;
    for (const v of [...this.live]) this.endVoice(v, now, 0.01);
    this.voices.clear();
    // Panic sends it: the fixed tones go too (the device would keep them until Simple mode is off)
    this.simpleOn = false;
    this.syncSimple(now);
  }

  clear(): void {
    const now = this.ctx.currentTime;
    for (const v of this.live) this.disconnect(v, now);
    this.live = [];
    this.voices.clear();
    this.coils = [];
    this.running = false;
    this.simpleOn = false;
    this.syncSimple(now);
    this.simple = [];
    this.channelProgram = new Array(16).fill(0);
    this.coilPlace = Array.from({ length: COIL_SLOTS }, freshPlace);
    this.placeRev++;
    this.chan = Array.from({ length: 16 }, freshChannel);
    this.nrp = Array.from({ length: 16 }, freshNrp);
    this.core = new BoardCore();
    this.snapshots = [];
    this.marks = [];
    this.scheduledUntil = now;
    this.lastStep = now;
  }

  /** Stops the scheduling timer (an offline render, a synth thrown away). */
  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
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
    if (dec.pnFull >= ENVELOPE_PN.NEXT && dec.pnFull <= ENVELOPE_PN.NTAU) {
      this.writeEnvelopeStep(dec.pnFull, dec.target, dec.isFloat ? dec.valueFloat : dec.valueInt, dec.isFloat);
      return;
    }
    if (dec.pnFull === PAN_PN.RESET_NRPS) {
      for (let ch = 0; ch < 16; ch++) {
        if (dec.valueInt & (1 << ch)) {
          this.nrp[ch] = { ...freshNrp(), selMsb: this.nrp[ch].selMsb, selLsb: this.nrp[ch].selLsb };
          this.touch(ch, when);
        }
      }
      this.changedAt(when);
      return;
    }
    if (dec.pnFull === PAN_PN.CONFIG || dec.pnFull === PAN_PN.POSITION || dec.pnFull === PAN_PN.REACH) {
      this.writePlace(dec.pnFull, dec.coil, dec.isFloat ? dec.valueFloat : dec.valueInt, dec.isFloat);
      this.changedAt(when);
      return;
    }
    if (dec.mode === MODE_BYTE.simple) {
      this.applySimple(dec.pn, dec.coil, dec.valueInt, dec.valueFloat, when);
      return;
    }
    if (dec.pn === PN.ENABLE) {
      this.setRunning(dec.valueInt === 1, when);
      return;
    }
    const c = dec.coil;
    if (c < 0 || c > 5) return;
    const cs = (this.coils[c] ??= { mask: 0, ontime: new Timeline(0), duty: new Timeline(0) });
    if (dec.pn === PN.ONTIME) cs.ontime.set(when, dec.valueInt);
    else if (dec.pn === PN.DUTY) cs.duty.set(when, dec.valueFloat);
    else if (dec.pn === PN.CHANNEL_MAP) {
      cs.mask = dec.valueInt;
      this.placeRev++;
    } else return;
    this.changedAt(when);
  }

  /** MIDI.cpp setRunning: on, every channel's controllers reset; off, every note dropped. */
  private setRunning(run: boolean, when: number): void {
    if (run && !this.running) for (let ch = 0; ch < 16; ch++) this.resetControllers(ch, when);
    if (!run) {
      for (const v of [...this.live]) this.endVoice(v, when, 0.005);
      this.voices.clear();
    }
    this.running = run;
    this.changedAt(when);
  }

  /** Simple mode, as compileSimpleConfig / compileSimpleStop drive it: per-coil BPS, ontime, duty, then the global enable. */
  private applySimple(pn: number, coil: number, valueInt: number, valueFloat: number, when: number): void {
    if (pn === PN.ENABLE) {
      this.simpleOn = valueInt === 1;
    } else {
      if (coil < 0 || coil >= COIL_SLOTS) return;
      const p = (this.simple[coil] ??= { bps: 0, ontime: 0, duty: 0 });
      if (pn === PN.BPS) p.bps = valueInt;
      else if (pn === PN.ONTIME) p.ontime = valueInt;
      else if (pn === PN.DUTY) p.duty = valueFloat;
      else return;
      if (!this.simpleOn) return;
    }
    this.syncSimple(when);
  }

  /** How loud a fixed tone plays: the duty, sent last, sets the pulse at that rate (Simple.h), within the coil's limits. */
  private simpleLevel(coil: number, p: SimpleParams): number {
    const pulse = fixedOntimeUs({ ontimeUs: p.ontime, duty: p.duty }, p.bps, this.limits[coil] ?? DEFAULT_COIL_LIMITS);
    return this.levelOf(this.model === "pulse", pulse, p.bps);
  }

  /** The coil's impulse repeated at any rate (not only a note's), band-limited and cached. */
  private simpleWave(hz: number): PeriodicWave {
    const key = `${this.model}:${hz}`;
    const cached = this.simpleWaves.get(key);
    if (cached) return cached;
    const coeffs = this.model === "pulse" ? retroPulseCoefficients : pulseCoefficients;
    const { real, imag } = coeffs(hz, this.ctx.sampleRate, SIMPLE_HARMONICS_MAX);
    const wave = this.ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    this.simpleWaves.set(key, wave);
    return wave;
  }

  /** Start, retune or stop each coil's fixed tone to match what the device would now fire. */
  private syncSimple(when: number): void {
    for (let c = 0; c < COIL_SLOTS; c++) {
      const p = this.simple[c];
      // the ontime sent does not count: the duty sets the pulse
      const on = this.simpleOn && !!p && p.bps > 0 && p.duty > 0;
      const tone = this.simpleTones.get(c);
      if (!on || !p) {
        if (tone) this.stopSimpleTone(c, tone, when);
        continue;
      }
      const level = Math.max(0.0001, this.simpleLevel(c, p));
      if (tone) {
        if (tone.hz !== p.bps) {
          tone.source.setPeriodicWave(this.simpleWave(p.bps));
          tone.source.frequency.setValueAtTime(p.bps, when);
          tone.hz = p.bps;
        }
        this.holdAt(tone.loud.gain, when);
        tone.loud.gain.linearRampToValueAtTime(level, when + 0.03);
        continue;
      }
      const source = this.ctx.createOscillator();
      source.setPeriodicWave(this.simpleWave(p.bps));
      source.frequency.value = p.bps;
      const loud = this.ctx.createGain();
      loud.gain.setValueAtTime(0.0001, when);
      loud.gain.linearRampToValueAtTime(level, when + ATTACK_MIN_S * 10);
      const panner = this.ctx.createStereoPanner();
      const place = this.coilPlace[c];
      panner.pan.value = place.position >= 0 ? 2 * place.position - 1 : 0;
      source.connect(loud).connect(panner).connect(this.bus);
      source.start(when);
      this.simpleTones.set(c, { source, loud, panner, hz: p.bps });
    }
  }

  private stopSimpleTone(coil: number, tone: SimpleTone, when: number): void {
    this.simpleTones.delete(coil);
    try {
      this.holdAt(tone.loud.gain, when);
      tone.loud.gain.linearRampToValueAtTime(0.0001, when + 0.02);
      tone.source.stop(when + 0.06);
    } catch {
      /* already stopped */
    }
    setTimeout(() => {
      for (const node of [tone.source, tone.loud, tone.panner]) {
        try {
          node.disconnect();
        } catch {
          /* */
        }
      }
    }, Math.max(0, (when - this.ctx.currentTime) * 1000) + 120);
  }

  /** Mirrors MIDIProgram::setDataPoint: the release amplitude stays 0, n-tau is
   *  kept off zero, and out-of-range values are ignored. */
  private writeEnvelopeStep(pn: number, target: number, value: number, isFloat: boolean): void {
    const step = target & 0x7f;
    const program = (target >> 8) & 0x7f;
    if (step >= ENVELOPE_STEP_COUNT || program > 63) return;
    const steps = (this.writtenPrograms.get(program) ?? programSteps(program)).map((s) => ({ ...s }));
    const s = steps[step];
    const milli = isFloat ? value : value / 1000;
    if (pn === ENVELOPE_PN.NEXT) {
      if (value >= ENVELOPE_STEP_COUNT) return;
      s.next = value;
    } else if (pn === ENVELOPE_PN.AMPLITUDE) {
      if (milli < 0) return;
      s.amp = step === RELEASE_STEP ? 0 : milli;
    } else if (pn === ENVELOPE_PN.DURATION) {
      // µs in both the int and the float variant
      if (value < 0) return;
      s.durMs = value / 1000;
    } else {
      s.ntau = Math.abs(milli) < 0.1 ? 0.1 : milli;
    }
    this.writtenPrograms.set(program, steps);
  }

  /** Mirrors Sysex.cpp 0x62-0x64, quirks included: the integer reach is not divided by 127. */
  private writePlace(pn: number, coil: number, value: number, isFloat: boolean): void {
    const k = this.coilPlace[coil];
    if (!k) return;
    if (pn === PAN_PN.CONFIG) {
      if ((value & 0b111) === 0) k.single = true;
      else if ((value & 0b111) === 1) k.single = false;
    } else if (pn === PAN_PN.POSITION) {
      const f = isFloat ? value : value / 127;
      k.position = f >= 0 && f <= 1 ? f : -1;
    } else if (value >= 0 && value <= 1) {
      k.reach = value;
    }
    this.placeRev++;
  }

  /** Channel.cpp resetControllers (CC121, the MIDI mode switched on): not the NRPs themselves. */
  private resetControllers(ch: number, when: number): void {
    const c = this.chan[ch];
    c.volume.set(when, 1);
    c.expression.set(when, 1);
    c.modulation.set(when, 0);
    c.pan.set(when, CENTER);
    c.soft.set(when, 0);
    c.bendRaw = 0;
    c.rangeCoarse = BEND_RANGE;
    c.rangeFine = 0;
    c.fineCoarse = 64;
    c.fineFine = 0;
    c.coarseTuning = 0;
    c.rpn = 0x7f7f;
    c.bend.set(when, 0);
    this.retune(ch, when);
    this.nrp[ch].selMsb = 127;
    this.nrp[ch].selLsb = 127;
    this.setSustain(ch, false, when);
    this.touch(ch, when);
  }

  /** The controllers MIDI.cpp reads, at their time. */
  private control(ch: number, num: number, v: number, when: number): void {
    const c = this.chan[ch];
    const n = this.nrp[ch];
    if (num === 1) {
      c.modulation.set(when, v / 127);
      this.touch(ch, when);
    } else if (num === 7) c.volume.set(when, v / 127);
    else if (num === 11) c.expression.set(when, v / 127);
    else if (num === 10) {
      c.pan.set(when, v / 127);
      this.touch(ch, when);
    } else if (num === 64) this.setSustain(ch, v >= 64, when);
    else if (num === 67) {
      c.soft.set(when, v >= 64 ? 1 : 0);
      this.touch(ch, when);
    } else if (num === 99 || num === 98) {
      // an NRPN selected forgets the RPN, and the other way round
      if (num === 99) n.selMsb = v;
      else n.selLsb = v;
      c.rpn = 0x7f7f;
    } else if (num === 101 || num === 100) {
      c.rpn = num === 101 ? (c.rpn & 0x00ff) | (v << 8) : (c.rpn & 0xff00) | v;
      n.selMsb = 127;
      n.selLsb = 127;
    } else if (num === 6 || num === 38) this.dataEntry(ch, num === 38, v, when);
    else if (num === 120) {
      // all sound off: the notes die at once
      for (const voice of [...this.live]) if (voice.ch === ch) this.endVoice(voice, when, 0.005);
      for (const [key, voice] of this.voices) if (voice.ch === ch) this.voices.delete(key);
      this.touch(ch, when);
    } else if (num === 121) this.resetControllers(ch, when);
    else if (num === 123) {
      // all notes off: straight to the release, the pedal or not
      for (const [key, voice] of this.voices) {
        if (voice.ch !== ch) continue;
        this.voices.delete(key);
        voice.keyUp ??= when;
        this.release(voice, when);
      }
      for (const voice of this.live) if (voice.ch === ch && voice.releaseAt == null && voice.endAt == null) this.release(voice, when);
    } else return;
    this.changedAt(when);
  }

  /** CC6 (coarse) / CC38 (fine) on the RPN or NRPN selected, as MIDI.cpp reads them. */
  private dataEntry(ch: number, fine: boolean, v: number, when: number): void {
    const c = this.chan[ch];
    const n = this.nrp[ch];
    if (c.rpn === 0) {
      if (fine) c.rangeFine = v;
      else c.rangeCoarse = v;
    } else if (c.rpn === 1) {
      if (fine) c.fineFine = v;
      else c.fineCoarse = v;
    } else if (c.rpn === 2 && !fine) c.coarseTuning = v - 64;
    else if (n.selMsb === 42 && !fine && n.selLsb === 1) n.srcHigh = v;
    else if (n.selMsb === 42 && !fine && n.selLsb === 2) n.tgtHigh = v / 127;
    else if (n.selMsb === 42 && fine && n.selLsb === 0) n.mode = v;
    else if (n.selMsb === 42 && fine && n.selLsb === 1) n.srcLow = v;
    else if (n.selMsb === 42 && fine && n.selLsb === 2) n.tgtLow = v / 127;
    else return;
    if (c.rpn <= 2) {
      c.bend.set(when, this.bendOf(c));
      this.retune(ch, when);
    }
    this.touch(ch, when);
  }

  private pitchBend(ch: number, raw: number, when: number): void {
    const c = this.chan[ch];
    c.bendRaw = raw;
    c.bend.set(when, this.bendOf(c));
    this.retune(ch, when);
    this.touch(ch, when);
    this.changedAt(when);
  }

  /** Semitones off the note: the bend × its range (semitones + cents), plus the tuning. */
  private bendOf(c: ChannelState): number {
    const tuning = ((c.fineCoarse << 7) + c.fineFine - 8192) / 8192 + c.coarseTuning;
    return (c.bendRaw / 8192) * (c.rangeCoarse + c.rangeFine / 100) + tuning;
  }

  /** The channel's sounding notes follow its pitch from `when`. */
  private retune(ch: number, when: number): void {
    const bend = this.chan[ch].bend.at(when);
    for (const v of this.live) {
      if (v.ch !== ch || !v.audio || (deathOf(v) ?? Infinity) <= when) continue;
      v.audio.source.frequency.setValueAtTime(noteHz(v.note + bend) * v.detune, Math.max(when, v.onAt));
    }
  }

  /** The sustain pedal: up, the notes it held go to their release. */
  private setSustain(ch: number, down: boolean, when: number): void {
    this.chan[ch].sustain.set(when, down ? 1 : 0);
    this.touch(ch, when);
    if (down) return;
    for (const v of this.live) {
      if (v.ch === ch && v.keyUp != null && v.keyUp <= when + EPS && v.releaseAt == null && v.endAt == null) this.release(v, when);
    }
  }

  /** Where the device puts a note (0..1), or null when it plays everywhere (omni). */
  private notePan(ch: number, note: number, vel: number, t: number): number | null {
    const n = this.nrp[ch];
    if (n.mode === 0) return this.chan[ch].pan.at(t);
    if (n.mode === 2) return null;
    let input = note;
    if (n.mode !== 1) {
      const held = [...this.voices.values()].filter((v) => v.ch === ch).map((v) => ({ note: v.note, vel: v.vel }));
      held.push({ note, vel });
      if (n.mode === 3) input = Math.min(...held.map((h) => h.note));
      else if (n.mode === 4) input = Math.max(...held.map((h) => h.note));
      else input = held.reduce((a, h) => (h.vel > a.vel ? h : a)).note;
    }
    if (input <= n.srcLow) return n.tgtLow;
    if (input >= n.srcHigh) return n.tgtHigh;
    return ((input - n.srcLow) * (n.tgtHigh - n.tgtLow)) / (n.srcHigh - n.srcLow) + n.tgtLow;
  }

  /** How loud each coil plays a note: 0 when not assigned the channel or out of reach. */
  private coilVolumes(ch: number, note: number, vel: number, t: number): number[] {
    const pan = this.notePan(ch, note, vel, t);
    return Array.from({ length: COIL_SLOTS }, (_, c) => {
      const cs = this.coils[c];
      if (!cs || (cs.mask & (1 << ch)) === 0) return 0;
      const k = this.coilPlace[c];
      if (pan == null || k.position < 0) return 1;
      return panVolume(pan, k, k.single ? 'single' : 'fade');
    });
  }

  /** Stereo position (-1..1) of a note: the placed coils playing it, weighted by volume. */
  private audioPan(coilVol: number[]): number {
    let sum = 0;
    let weight = 0;
    this.coilPlace.forEach((k, c) => {
      if (k.position < 0 || !coilVol[c]) return;
      sum += coilVol[c] * (2 * k.position - 1);
      weight += coilVol[c];
    });
    return weight > 0 ? sum / weight : 0;
  }

  private stepsFor(program: number): EnvStep[] {
    return this.writtenPrograms.get(program) ?? programSteps(program);
  }

  /** The coils with channels, by index: none configured yet → -1, a stand-in for all of them. */
  private configuredCoils(): number[] {
    const out: number[] = [];
    this.coils.forEach((cs, c) => {
      if (cs && cs.mask) out.push(c);
    });
    return out.length ? out : [-1];
  }

  private noteOn(ch: number, note: number, vel: number, when: number): void {
    // a key struck again: the board reuses its note at the end of the list, here a new voice takes over
    const key = `${ch}:${note}`;
    const prev = this.voices.get(key);
    if (prev) this.endVoice(prev, when, 0.01);
    const sounding = this.live.filter((v) => (deathOf(v) ?? Infinity) > when);
    if (sounding.length >= MAX_VOICES) this.endVoice(sounding[0], when, 0.01);

    const coilVol = this.coilVolumes(ch, note, vel, when);
    const audible = this.configuredCoils()[0] === -1 || coilVol.some((x) => x > 0);
    const textured = this.model === "tesla";
    const program = this.channelProgram[ch] ?? 0;
    const steps = this.stepsFor(program);
    const detune = textured ? 1 + (Math.random() * 2 - 1) * PITCH_JITTER : 1;
    const voice: Voice = {
      id: this.nextId++,
      audio: audible ? this.makeAudio(note, ch, detune, coilVol, when) : null,
      retro: this.model === "pulse",
      detune,
      note,
      vel,
      ch,
      steps,
      releaseS: Math.max(0, steps[RELEASE_STEP].durMs) / 1000,
      onAt: when,
      keyUp: null,
      releaseAt: null,
      endAt: null,
      endFade: 0,
      touches: [],
      coilVol,
      placeRev: this.placeRev,
      key,
      attacked: false,
      closed: false,
      lastT: when,
      lastV: 0,
      flatUntil: null,
    };
    this.voices.set(key, voice);
    this.live.push(voice);
    this.changedAt(when);
  }

  private makeAudio(note: number, ch: number, detune: number, coilVol: number[], when: number): VoiceAudio {
    const ctx = this.ctx;
    const hz = noteHz(note);
    const textured = this.model === "tesla";
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, ctx.currentTime);
    const flick = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = this.audioPan(coilVol);

    // bang-to-bang jitter: gain 1 + noise low-passed at ~f0/2 (≈ one random value per bang).
    // The steady models leave it (and the flicker) at a flat 1.
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
    if (textured) this.noise.connect(jitterLp).connect(jitterAmt).connect(jitter.gain);

    const source = ctx.createOscillator();
    source.setPeriodicWave(this.model === "pulse" ? this.retroPulseFor(note) : this.pulseFor(note));
    // tiny static per-voice detune (measured PRF jitter ≈0.07%) so repeated/stacked
    // notes aren't digitally identical; the channel's bend from the start
    source.frequency.value = noteHz(note + this.chan[ch].bend.at(when)) * detune;
    source.connect(env);
    env.connect(flick).connect(jitter).connect(panner).connect(this.bus);
    if (textured) this.scheduleFlicker(flick.gain, when);
    source.start(when);
    return { source, env, flick, jitter, jitterLp, jitterAmt, panner };
  }

  private noteOff(ch: number, note: number, when: number): void {
    const key = `${ch}:${note}`;
    const v = this.voices.get(key);
    if (!v) return;
    this.voices.delete(key);
    v.keyUp = when;
    v.touches.push(when);
    // the pedal down holds the note until it lifts
    if (!this.chan[ch].sustain.at(when)) this.release(v, when);
    this.changedAt(when);
  }

  /** The note's envelope goes to its release step. */
  private release(v: Voice, when: number): void {
    if (v.releaseAt != null || v.endAt != null) return;
    v.releaseAt = when;
    this.mark(when);
    this.mark(when + v.releaseS);
    try {
      v.audio?.source.stop(when + v.releaseS + 0.05);
    } catch {
      /* already stopped */
    }
  }

  /** Cut a note short: struck again, stolen, or all sound off. */
  private endVoice(v: Voice, when: number, fade: number): void {
    if (this.voices.get(v.key) === v) this.voices.delete(v.key);
    const death = deathOf(v);
    if (death != null && death <= when) return;
    v.endAt = when;
    v.endFade = fade;
    try {
      v.audio?.source.stop(when + fade + 0.05);
    } catch {
      /* already stopped */
    }
    this.changedAt(when);
  }

  /** Detach a voice's chain from the bus so voices don't pile up. */
  private disconnect(v: Voice, when: number): void {
    const a = v.audio;
    if (!a) return;
    try {
      a.source.stop(when);
    } catch {
      /* already stopped */
    }
    try {
      this.noise.disconnect(a.jitterLp);
    } catch {
      /* */
    }
    for (const node of [a.source, a.env, a.flick, a.jitter, a.jitterLp, a.jitterAmt, a.panner]) {
      try {
        node.disconnect();
      } catch {
        /* */
      }
    }
  }

  private holdAt(g: AudioParam, when: number): void {
    if (typeof g.cancelAndHoldAtTime === "function")
      g.cancelAndHoldAtTime(when);
    else {
      g.cancelScheduledValues(when);
      g.setValueAtTime(Math.max(0.0001, g.value), when);
    }
  }

  // --- the board, stepped ahead of the audio clock ---------------------------
  private touch(ch: number, when: number): void {
    this.chan[ch].touches.push(when);
  }

  private mark(when: number): void {
    this.marks.push(when);
  }

  /**
   * Something the board reads changed at `when`: step there. Inside what is already
   * scheduled (a key played now, a setting moved), the board steps again from the
   * last step before it; near enough, at once, after the rest of the burst (a chord,
   * a coil's settings) is in.
   */
  private changedAt(when: number): void {
    this.mark(when);
    if (when > this.ctx.currentTime + HORIZON_S) {
      this.startTimer();
      return;
    }
    if (this.pendingFrom == null) queueMicrotask(() => this.flush());
    this.pendingFrom = Math.min(this.pendingFrom ?? Infinity, when);
  }

  private flush(): void {
    const from = this.pendingFrom;
    this.pendingFrom = null;
    if (from == null) return;
    if (from < this.scheduledUntil) this.rewind(from);
    this.pump();
  }

  private rewind(when: number): void {
    let i = this.snapshots.length - 1;
    while (i >= 0 && this.snapshots[i].t >= when - EPS) i--;
    const snap = this.snapshots[i];
    this.snapshots.length = i + 1;
    this.core = snap ? snap.core.clone() : new BoardCore();
    this.scheduledUntil = snap ? snap.t : when - EPS;
    this.lastStep = this.scheduledUntil;
    for (const v of this.live) {
      const a = v.audio;
      if (!a || !v.attacked) continue;
      const death = deathOf(v);
      // a fade already under way is left alone
      if (v.closed && death != null && death < when) continue;
      this.holdAt(a.env.gain, when);
      if (v.onAt >= when - EPS) v.attacked = false;
      v.closed = false;
      v.lastT = when;
      v.lastV = NaN;
      v.flatUntil = null;
    }
  }

  private startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.pump();
      if (!this.live.length && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }, PUMP_MS);
  }

  /**
   * Step the board up to `until` (audio time), scheduling each voice's level: on its own
   * timer ahead of the clock; public for an offline render, which steps it to the end.
   */
  pump(until = this.ctx.currentTime + HORIZON_S): void {
    if (this.pendingFrom != null) {
      if (this.pendingFrom < this.scheduledUntil) this.rewind(this.pendingFrom);
      this.pendingFrom = null;
    }
    const now = this.ctx.currentTime;
    // left behind (a throttled tab): the steps already past can't be heard any more
    if (this.scheduledUntil < now - STEP_S) {
      this.scheduledUntil = now;
      this.lastStep = now;
    }
    if (until > this.scheduledUntil) {
      for (const t of this.stepTimes(this.scheduledUntil, until)) this.stepAt(t);
      this.scheduledUntil = until;
    }
    this.prune(now);
    if (this.live.length) this.startTimer();
  }

  /** The grid in (from, to], and every event in it. */
  private stepTimes(from: number, to: number): number[] {
    const times: number[] = [];
    for (let k = Math.floor(from / STEP_S) + 1; k * STEP_S <= to + EPS; k++) times.push(k * STEP_S);
    for (const m of this.marks) if (m > from + EPS && m <= to + EPS) times.push(m);
    for (const v of this.live) {
      const death = deathOf(v);
      if (death != null && death > from + EPS && death <= to + EPS) times.push(death);
    }
    times.sort((a, b) => a - b);
    return times.filter((t, i) => i === 0 || t - times[i - 1] > EPS);
  }

  private stepAt(t: number): void {
    const prev = this.lastStep;
    const notes: Voice[] = [];
    for (const v of this.live) {
      if (v.onAt > t + EPS) continue;
      const death = deathOf(v);
      if (death != null && t >= death - EPS) {
        this.core.forget(v.id);
        this.close(v, death);
      } else notes.push(v);
    }
    notes.sort((a, b) => a.onAt - b.onAt || a.id - b.id);

    const slots = this.configuredCoils();
    const coils: BoardCoil[] = slots.map((c) => {
      const cs = this.coils[c];
      return !cs ? UNCONFIGURED : {
        drive: { ontimeUs: cs.ontime.at(t), duty: cs.duty.at(t) },
        limits: this.limits[c] ?? DEFAULT_COIL_LIMITS,
      };
    });
    const lfo = (Math.sin(2 * Math.PI * LFO_HZ * t) + 1) / 2;
    const hz: number[] = [];
    const board: BoardNote[] = notes.map((v) => {
      const c = this.chan[v.ch];
      const touched = c.touches.some((x) => x > prev + EPS && x <= t + EPS) || v.touches.some((x) => x > prev + EPS && x <= t + EPS);
      if (touched || v.placeRev !== this.placeRev) {
        v.coilVol = this.coilVolumes(v.ch, v.note, v.vel, t);
        v.placeRev = this.placeRev;
      }
      const heldMs = v.releaseAt != null ? (v.releaseAt - v.onAt) * 1000 : null;
      const env = stepsAmplitude(v.steps, (t - v.onAt) * 1000, heldMs);
      // the soft pedal acts while the key is down
      const soft = c.soft.at(v.keyUp != null ? Math.min(t, v.keyUp) : t) ? SOFT_PEDAL : 1;
      const level = (v.vel / 127) * soft * c.volume.at(t) * c.expression.at(t) * env
        * (1 - lfo * c.modulation.at(t) * LFO_DEPTH);
      const f = noteHz(v.note + c.bend.at(t));
      hz.push(f);
      return { id: v.id, hz: f, level, vols: slots.map((s) => (s < 0 ? 1 : v.coilVol[s] ?? 0)), touched };
    });
    // a note sounds as loud as the longest pulse a coil fires for it
    const pulse = new Float64Array(notes.length);
    for (const step of this.core.step(board, coils)) {
      step.fired.forEach((j, m) => {
        pulse[j] = Math.max(pulse[j], step.limited.pulsesUs[m]);
      });
    }
    notes.forEach((v, j) => this.schedule(v, t, this.levelOf(v.retro, pulse[j], hz[j])));
    this.lastStep = t;
    this.snapshots.push({ t, core: this.core.clone() });
  }

  private levelOf(retro: boolean, pulseUs: number, hz: number): number {
    return retro
      ? PULSE_REF_GAIN * pulseLevel(pulseUs, hz, { alpha: this.law.alpha, slopeDbPerOct: 0 })
      : TESLA_REF_GAIN * pulseLevel(pulseUs, hz, this.law);
  }

  /** A voice's level at `t`: ramps between the steps, nothing while it holds still. */
  private schedule(v: Voice, t: number, g: number): void {
    const a = v.audio;
    if (!a) return;
    const p = a.env.gain;
    if (!v.attacked) {
      // the gate's attack: from silence at the note-on
      v.attacked = true;
      p.setValueAtTime(0, v.onAt);
      v.lastT = v.onAt + ATTACK_MIN_S;
      p.linearRampToValueAtTime(g, v.lastT);
      v.lastV = g;
      v.flatUntil = null;
      return;
    }
    if (t <= v.lastT + EPS) return;
    if (Math.abs(g - v.lastV) < 1e-5) {
      v.flatUntil = t;
      return;
    }
    // the end of a still stretch, then the change
    if (v.flatUntil != null) p.linearRampToValueAtTime(v.lastV, v.flatUntil);
    p.linearRampToValueAtTime(g, t);
    v.lastT = t;
    v.lastV = g;
    v.flatUntil = null;
  }

  /** A voice leaving the board's list: silent from its death (a fade if cut short). */
  private close(v: Voice, death: number): void {
    const a = v.audio;
    if (v.closed || !a) return;
    v.closed = true;
    const p = a.env.gain;
    if (v.endAt != null) {
      this.holdAt(p, death);
      p.linearRampToValueAtTime(0, death + v.endFade);
    } else {
      if (v.flatUntil != null) p.linearRampToValueAtTime(v.lastV, v.flatUntil);
      p.linearRampToValueAtTime(0, Math.max(death, v.lastT + EPS));
    }
  }

  /** Forget what the clock has passed: dead voices, old marks, old controller values. */
  private prune(now: number): void {
    const past = now - 0.1;
    this.live = this.live.filter((v) => {
      const death = deathOf(v);
      if (death == null || death + v.endFade + 0.05 > past) return true;
      this.core.forget(v.id);
      this.disconnect(v, now);
      return false;
    });
    this.marks = this.marks.filter((m) => m > past);
    let keep = this.snapshots.length;
    while (keep > 0 && this.snapshots[keep - 1].t > now) keep--;
    // the last steps before the clock stay: an event now steps again from the one before it
    if (keep > 2) this.snapshots.splice(0, keep - 2);
    for (const c of this.chan) {
      for (const tl of [c.volume, c.expression, c.modulation, c.soft, c.sustain, c.pan, c.bend]) tl.prune(past);
      c.touches = c.touches.filter((x) => x > past);
    }
    for (const cs of this.coils) {
      cs?.ontime.prune(past);
      cs?.duty.prune(past);
    }
  }
}

let singleton: TeslaSynthOutput | null = null;
/**
 * Lazily create the shared built-in synth (its AudioContext starts suspended). Raw: held
 * in the store as the output, a reactive proxy would track every step of its board.
 */
export function getTeslaSynth(): TeslaSynthOutput {
  if (!singleton) singleton = markRaw(new TeslaSynthOutput());
  return singleton;
}
