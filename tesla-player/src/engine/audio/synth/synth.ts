import { markRaw } from 'vue';
import { ENVELOPE_PN, MODE_BYTE, PAN_PN, PN } from '@/model/sysex/syntherrupter';
import { SndEnvelope } from '@/model/envelopes/envelope';
import { DevFrame } from '@/model/sysex/frame';
import { SndLevelLaw, type LevelLaw } from '@/model/audio';
import { DevBoard, type BoardCoil, type BoardNote } from '@/model/devices/board';
import { DevCoilLimits, type CoilLimits } from '@/model/devices/coil-limits';
import { DevOutput } from '@/model/devices/output';
import type { CoilResponse } from '@/model/coils/response';
import { SndBang } from '@/model/coils/sound';
import {
  ALL_COILS, COIL_SLOTS, EPS, HORIZON_S, JITTER_SIGMA, LFO_DEPTH, LFO_HZ, LIMITER_THRESHOLD_DB, MASTER_GAIN, MAX_VOICES, NOISE_SECONDS,
  noteHz, PITCH_JITTER, PULSE_REF_GAIN, PUMP_MS, REVERB_WET, SOFT_PEDAL, STEP_S, TESLA_REF_GAIN, UNCONFIGURED,
} from './constants';
import { SndChannel } from './channel';
import { SndCoil } from './coil';
import { SndPlace } from './place';
import { SndPrograms } from './programs';
import { PHYSICS_SOUND, SYNTH_OUTPUT_ID, type MidiSink, type PhysicsSound, type SynthModel } from './sink';
import { SndSimple, type SimpleHost, type SimpleParams } from './simple';
import { SndSound } from './sound';
import { SndVoice } from './voice';
import { SndWaves } from './waves';

/**
 * A Web-Audio "MIDI output" emulating Tesla-coil sound. Per note: one band-limited
 * impulse-train oscillator (a per-note PeriodicWave built from the measured coil impulse
 * spectrum, zero aliasing), roughened by per-bang amplitude jitter and a slow flicker, into a
 * bus with a limiter and a light reverb send (SndSound).
 *
 * Its loudness is the board's: the synth holds the board's MIDI state (the notes, each
 * channel's controllers and envelope, each coil's ontime, duty, channels, place and limits)
 * and, step by step, works out the pulse each coil fires for each note the way the firmware
 * does (DevBoard, DevOutput): a note's volume (velocity, CC7, CC11, envelope, soft pedal, LFO,
 * pan), the crossover, the coil's voices, its max ontime and duty, its min ontime, the
 * output's floor. A note sounds as loud as the longest pulse fired for it (SndLevelLaw). The
 * other SynthModels keep all of that but the timbre.
 */
export class SndTeslaSynth implements MidiSink, SimpleHost {
  readonly id = SYNTH_OUTPUT_ID;
  readonly name = 'Tesla synth';
  readonly ctx: AudioContext;
  readonly bus: GainNode;
  readonly waves: SndWaves;
  /** Applies from the next note-on. */
  model: SynthModel = 'tesla';

  private static instance: SndTeslaSynth | null = null;

  private readonly master: GainNode;
  private readonly wet: GainNode; // reverb send level
  private readonly noise: AudioBufferSourceNode; // shared white noise, low-passed per voice
  private readonly law: SndLevelLaw;
  private readonly flatLaw: SndLevelLaw;
  private physics: Readonly<PhysicsSound> | null;
  private coilPhysics: readonly (CoilResponse | null)[] = [];
  // the keys down (or held by the pedal), to find a note-off's voice
  private voices = new Map<string, SndVoice>();
  // the board's list, in the order the notes came
  private live: SndVoice[] = [];
  private nextId = 1;
  private coils: (SndCoil | undefined)[] = [];
  private limits: readonly CoilLimits[] = [];
  private running = false;
  private readonly programs = new SndPrograms();
  // Spatialisation as the device holds it (MIDI.h, Channel.h); cleared with the coils' state.
  private places: SndPlace[] = Array.from({ length: COIL_SLOTS }, () => new SndPlace());
  private placeRev = 0;
  private chan: SndChannel[] = Array.from({ length: 16 }, () => new SndChannel());
  // the board stepped ahead of the audio clock, and what it was at each step (to step again)
  private board = new DevBoard();
  private snapshots: { t: number; board: DevBoard }[] = [];
  private scheduledUntil = 0;
  private lastStep = 0;
  private marks: number[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  // the earliest change of a burst of events, stepped once they are all in
  private pendingFrom: number | null = null;
  private readonly simple: SndSimple;

  /** `law`: how loud a pulse sounds, SndLevelLaw.DEFAULT's unless an A/B tries another; `physics`: the coils' own sound, off unless given. */
  constructor({ law = SndLevelLaw.DEFAULT.law, physics = null }: { law?: Readonly<LevelLaw>; physics?: Readonly<PhysicsSound> | null } = {}) {
    this.law = new SndLevelLaw(law);
    this.flatLaw = this.law.flat;
    this.physics = physics;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
    this.waves = new SndWaves(this.ctx);
    this.simple = new SndSimple(this);
  }

  /**
   * The shared built-in synth, made at first use (its AudioContext starts suspended). Raw:
   * held in the store as the output, a reactive proxy would track every step of its board.
   */
  static shared(): SndTeslaSynth {
    return (SndTeslaSynth.instance ??= markRaw(new SndTeslaSynth({ physics: PHYSICS_SOUND })));
  }

  resume(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setModel(model: SynthModel): void {
    this.model = model;
  }

  /** The coils' own sound (PhysicsSound), or null for the shared measured one; from the next note-on. */
  setPhysics(physics: Readonly<PhysicsSound> | null): void {
    this.physics = physics;
  }

  /** Each coil's physics, by coil index (null: a coil without a sheet). */
  setCoilPhysics(physics: readonly (CoilResponse | null)[]): void {
    this.coilPhysics = physics;
    this.changedAt(this.ctx.currentTime);
    this.simple.sync(this.ctx.currentTime);
  }

  /** Each coil's limits, by coil index, as the board holds them (or is taken to). */
  setCoilLimits(limits: readonly CoilLimits[]): void {
    this.limits = limits;
    this.changedAt(this.ctx.currentTime);
    this.simple.sync(this.ctx.currentTime);
  }

  // --- MidiSink ------------------------------------------------------------
  send(data: number[], options?: { time?: number | string }): void {
    if (!data || data.length === 0) return;
    const when = this.toAudioTime(options?.time);
    const status = typeof data[0] === 'number' ? data[0] : parseInt(String(data[0]).replace(/^0x/i, ''), 16);
    const kind = status & 0xf0;
    const ch = status & 0x0f;
    if (kind === 0x90 && data[2] > 0) this.noteOn(ch, data[1], data[2], when);
    else if (kind === 0x80 || (kind === 0x90 && data[2] === 0)) this.noteOff(ch, data[1], when);
    else if (kind === 0xc0) this.chan[ch].program = data[1];
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
    this.simple.off(now);
  }

  clear(): void {
    const now = this.ctx.currentTime;
    for (const v of this.live) v.disconnect(now);
    this.live = [];
    this.voices.clear();
    this.coils = [];
    this.running = false;
    this.simple.off(now, true);
    this.places = Array.from({ length: COIL_SLOTS }, () => new SndPlace());
    this.placeRev++;
    this.chan = Array.from({ length: 16 }, () => new SndChannel());
    this.board = new DevBoard();
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

  // --- SimpleHost ----------------------------------------------------------
  /** How loud a fixed tone plays: the duty, sent last, sets the pulse at that rate (Simple.h), within the coil's limits. */
  simpleLevel(coil: number, p: SimpleParams): number {
    const pulse = new DevOutput({ ontimeUs: p.ontime, duty: p.duty }, this.limits[coil] ?? DevCoilLimits.DEFAULT).fixedPulse(p.bps);
    const physics = this.physics ? this.coilPhysics[coil] ?? null : null;
    return this.levelOf(this.model === 'pulse', pulse, p.bps, physics);
  }

  placeOf(coil: number): SndPlace {
    return this.places[coil];
  }

  // --- internals -----------------------------------------------------------
  /** Short decaying-noise impulse response for a subtle room (not a tone source). */
  private makeReverbIR(seconds: number, decay: number): AudioBuffer {
    const sr = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(seconds * sr));
    const ir = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
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
    if (ts && typeof ts.contextTime === 'number' && ts.contextTime > 0 && typeof ts.performanceTime === 'number') {
      when = ts.contextTime + (ms - ts.performanceTime) / 1000;
    } else {
      const lat = this.ctx.outputLatency || this.ctx.baseLatency || 0;
      when = this.ctx.currentTime + (ms - performance.now()) / 1000 - lat;
    }
    return Math.max(this.ctx.currentTime, when);
  }

  private applyFrame(frame: number[], when: number): void {
    let dec: DevFrame;
    try {
      dec = DevFrame.decode(frame);
    } catch {
      return;
    }
    if (dec.pnFull >= ENVELOPE_PN.NEXT && dec.pnFull <= ENVELOPE_PN.NTAU) {
      this.programs.write(dec.pnFull, dec.target, dec.isFloat ? dec.valueFloat : dec.valueInt, dec.isFloat);
      return;
    }
    if (dec.pnFull === PAN_PN.RESET_NRPS) {
      this.chan.forEach((c, ch) => {
        if (!(dec.valueInt & (1 << ch))) return;
        c.resetPanMapping();
        c.touch(when);
      });
      this.changedAt(when);
      return;
    }
    if (dec.pnFull === PAN_PN.CONFIG || dec.pnFull === PAN_PN.POSITION || dec.pnFull === PAN_PN.REACH) {
      const place = this.places[dec.coil];
      if (place) {
        place.write(dec.pnFull, dec.isFloat ? dec.valueFloat : dec.valueInt, dec.isFloat);
        this.placeRev++;
      }
      this.changedAt(when);
      return;
    }
    if (dec.mode === MODE_BYTE.simple) {
      this.simple.apply(dec.pn, dec.coil, dec.valueInt, dec.valueFloat, when);
      return;
    }
    if (dec.pn === PN.ENABLE) {
      this.setRunning(dec.valueInt === 1, when);
      return;
    }
    const c = dec.coil;
    if (c < 0 || c > 5) return;
    const cs = (this.coils[c] ??= new SndCoil());
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

  /** Channel.cpp resetControllers (CC121, the MIDI mode switched on): not the NRPs themselves. */
  private resetControllers(ch: number, when: number): void {
    const c = this.chan[ch];
    c.reset(when);
    this.retune(ch, when);
    this.setSustain(ch, false, when);
    c.touch(when);
  }

  /** The controllers MIDI.cpp reads, at their time. */
  private control(ch: number, num: number, v: number, when: number): void {
    const c = this.chan[ch];
    if (num === 1) {
      c.modulation.set(when, v / 127);
      c.touch(when);
    } else if (num === 7) c.volume.set(when, v / 127);
    else if (num === 11) c.expression.set(when, v / 127);
    else if (num === 10) {
      c.pan.set(when, v / 127);
      c.touch(when);
    } else if (num === 64) this.setSustain(ch, v >= 64, when);
    else if (num === 67) {
      c.soft.set(when, v >= 64 ? 1 : 0);
      c.touch(when);
    } else if (num === 99 || num === 98) c.selectNrpn(num === 99, v);
    else if (num === 101 || num === 100) c.selectRpn(num === 101, v);
    else if (num === 6 || num === 38) {
      if (c.dataEntry(num === 38, v, when) === 'pitch') this.retune(ch, when);
    } else if (num === 120) {
      // all sound off: the notes die at once
      for (const voice of [...this.live]) if (voice.ch === ch) this.endVoice(voice, when, 0.005);
      for (const [key, voice] of this.voices) if (voice.ch === ch) this.voices.delete(key);
      c.touch(when);
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

  private pitchBend(ch: number, raw: number, when: number): void {
    this.chan[ch].pitchBend(raw, when);
    this.retune(ch, when);
    this.changedAt(when);
  }

  /** The channel's sounding notes follow its pitch from `when`. */
  private retune(ch: number, when: number): void {
    const bend = this.chan[ch].bend.at(when);
    for (const v of this.live) if (v.ch === ch) v.retune(bend, when);
  }

  /** The sustain pedal: up, the notes it held go to their release. */
  private setSustain(ch: number, down: boolean, when: number): void {
    const c = this.chan[ch];
    c.sustain.set(when, down ? 1 : 0);
    c.touch(when);
    if (down) return;
    for (const v of this.live) {
      if (v.ch === ch && v.keyUp != null && v.keyUp <= when + EPS && v.releaseAt == null && v.endAt == null) this.release(v, when);
    }
  }

  /** How loud each coil plays a note: 0 when not assigned the channel or out of reach. */
  private coilVolumes(ch: number, note: number, vel: number, t: number): number[] {
    const held = () => [...this.voices.values()].filter((v) => v.ch === ch).map((v) => ({ note: v.note, vel: v.vel }));
    const pan = this.chan[ch].notePan(note, vel, t, held);
    return Array.from({ length: COIL_SLOTS }, (_, c) => {
      const cs = this.coils[c];
      return cs?.plays(ch) ? this.places[c].volume(pan) : 0;
    });
  }

  /** Stereo position (-1..1) of a note: the placed coils playing it, weighted by volume. */
  private audioPan(coilVol: number[]): number {
    let sum = 0;
    let weight = 0;
    this.places.forEach((k, c) => {
      if (k.position < 0 || !coilVol[c]) return;
      sum += coilVol[c] * k.stereo;
      weight += coilVol[c];
    });
    return weight > 0 ? sum / weight : 0;
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
    const key = SndVoice.keyOf(ch, note);
    const prev = this.voices.get(key);
    if (prev) this.endVoice(prev, when, 0.01);
    const sounding = this.live.filter((v) => v.soundingAt(when));
    if (sounding.length >= MAX_VOICES) this.endVoice(sounding[0], when, 0.01);

    const coilVol = this.coilVolumes(ch, note, vel, when);
    const audible = this.configuredCoils()[0] === -1 || coilVol.some((x) => x > 0);
    const voice = new SndVoice({
      id: this.nextId++,
      sounds: audible ? this.makeSounds(note, ch, vel, coilVol, when) : [],
      retro: this.model === 'pulse',
      note,
      vel,
      ch,
      steps: this.programs.steps(this.chan[ch].program),
      onAt: when,
      coilVol,
      placeRev: this.placeRev,
    });
    this.voices.set(key, voice);
    this.live.push(voice);
    this.changedAt(when);
  }

  /**
   * A note's sounds: one shared by the coils playing it (the physics off), or one
   * per coil with its channel, where the coil stands, its timbre from the arcs
   * its drive gives this note now.
   */
  private makeSounds(note: number, ch: number, vel: number, coilVol: number[], when: number): SndSound[] {
    const detune = () => (this.model === 'tesla' ? 1 + (Math.random() * 2 - 1) * PITCH_JITTER : 1);
    const slots = this.configuredCoils();
    if (!this.physics || slots[0] === -1) return [this.makeSound(note, ch, detune(), this.audioPan(coilVol), ALL_COILS, null, null, when)];
    const hz = noteHz(note);
    const c = this.chan[ch];
    const out: SndSound[] = [];
    for (const s of slots) {
      const cs = this.coils[s];
      if (!cs?.plays(ch)) continue;
      const physics = this.coilPhysics[s] ?? null;
      let wave: PeriodicWave | null = null;
      if (physics && this.physics.arcTimbre && this.model !== 'pulse') {
        const vol = (vel / 127) * c.volume.at(when) * c.expression.at(when) * (coilVol[s] || 1);
        const pulse = new DevOutput(cs.drive(when), this.limits[s] ?? DevCoilLimits.DEFAULT).effective(hz, vol);
        const bang = physics.at(pulse, hz);
        // a strike is one bright channel: its crack keeps the measured brightness
        if (bang.l > 0) wave = this.waves.arc(note, bang.fate === 'strike' ? 0.3 : bang.l);
      }
      out.push(this.makeSound(note, ch, detune(), this.places[s].stereo, s, physics, wave, when));
    }
    return out;
  }

  private makeSound(note: number, ch: number, detune: number, pan: number, slot: number, physics: CoilResponse | null, wave: PeriodicWave | null, when: number): SndSound {
    return new SndSound(this.ctx, this.noise, this.bus, {
      slot,
      physics,
      wave: wave ?? (this.model === 'pulse' ? this.waves.retro(note) : this.waves.pulse(note)),
      hz: noteHz(note),
      // tiny static per-voice detune (measured PRF jitter ≈0.07%) so repeated/stacked
      // notes aren't digitally identical; the channel's bend from the start
      freq: noteHz(note + this.chan[ch].bend.at(when)) * detune,
      detune,
      pan,
      textured: this.model === 'tesla',
      when,
    });
  }

  private noteOff(ch: number, note: number, when: number): void {
    const key = SndVoice.keyOf(ch, note);
    const v = this.voices.get(key);
    if (!v) return;
    this.voices.delete(key);
    v.keyReleased(when);
    // the pedal down holds the note until it lifts
    if (!this.chan[ch].sustain.at(when)) this.release(v, when);
    this.changedAt(when);
  }

  /** The note's envelope goes to its release step. */
  private release(v: SndVoice, when: number): void {
    if (!v.release(when)) return;
    this.mark(when);
    this.mark(when + v.releaseS);
  }

  /** Cut a note short: struck again, stolen, or all sound off. */
  private endVoice(v: SndVoice, when: number, fade: number): void {
    if (this.voices.get(v.key) === v) this.voices.delete(v.key);
    if (v.end(when, fade)) this.changedAt(when);
  }

  // --- the board, stepped ahead of the audio clock ---------------------------
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
    this.board = snap ? snap.board.clone() : new DevBoard();
    this.scheduledUntil = snap ? snap.t : when - EPS;
    this.lastStep = this.scheduledUntil;
    for (const v of this.live) v.rewind(when);
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

  /** The grid in (from, to], and every event in it. */
  private stepTimes(from: number, to: number): number[] {
    const times: number[] = [];
    for (let k = Math.floor(from / STEP_S) + 1; k * STEP_S <= to + EPS; k++) times.push(k * STEP_S);
    for (const m of this.marks) if (m > from + EPS && m <= to + EPS) times.push(m);
    for (const v of this.live) {
      const death = v.death;
      if (death != null && death > from + EPS && death <= to + EPS) times.push(death);
    }
    times.sort((a, b) => a - b);
    return times.filter((t, i) => i === 0 || t - times[i - 1] > EPS);
  }

  private stepAt(t: number): void {
    const prev = this.lastStep;
    const notes: SndVoice[] = [];
    for (const v of this.live) {
      if (v.onAt > t + EPS) continue;
      const death = v.death;
      if (death != null && t >= death - EPS) {
        this.board.forget(v.id);
        v.close(death);
      } else notes.push(v);
    }
    notes.sort((a, b) => a.onAt - b.onAt || a.id - b.id);

    const slots = this.configuredCoils();
    const coils: BoardCoil[] = slots.map((c) => {
      const cs = this.coils[c];
      return !cs ? UNCONFIGURED : { drive: cs.drive(t), limits: this.limits[c] ?? DevCoilLimits.DEFAULT };
    });
    const lfo = (Math.sin(2 * Math.PI * LFO_HZ * t) + 1) / 2;
    const hz: number[] = [];
    const held: BoardNote[] = notes.map((v) => {
      const c = this.chan[v.ch];
      const touched = c.touchedIn(prev, t) || v.touchedIn(prev, t);
      if (touched || v.placeRev !== this.placeRev) {
        v.coilVol = this.coilVolumes(v.ch, v.note, v.vel, t);
        v.placeRev = this.placeRev;
      }
      const heldMs = v.releaseAt != null ? (v.releaseAt - v.onAt) * 1000 : null;
      const env = new SndEnvelope(v.steps).amplitude((t - v.onAt) * 1000, heldMs);
      // the soft pedal acts while the key is down
      const soft = c.soft.at(v.keyUp != null ? Math.min(t, v.keyUp) : t) ? SOFT_PEDAL : 1;
      const level = (v.vel / 127) * soft * c.volume.at(t) * c.expression.at(t) * env
        * (1 - lfo * c.modulation.at(t) * LFO_DEPTH);
      const f = noteHz(v.note + c.bend.at(t));
      hz.push(f);
      return { id: v.id, hz: f, level, vols: slots.map((s) => (s < 0 ? 1 : v.coilVol[s] ?? 0)), touched };
    });
    // each coil's pulse for each note; a shared sound is as loud as the longest
    const pulses = slots.map(() => new Float64Array(notes.length));
    this.board.step(held, coils).forEach((step, k) => {
      step.fired.forEach((j, m) => {
        pulses[k][j] = step.limited.pulsesUs[m];
      });
    });
    const textured = this.model === 'tesla';
    notes.forEach((v, j) => {
      for (const s of v.sounds) {
        let pulse = 0;
        if (s.slot === ALL_COILS) for (const p of pulses) pulse = Math.max(pulse, p[j]);
        else {
          const k = slots.indexOf(s.slot);
          pulse = k >= 0 ? pulses[k][j] : 0;
        }
        const physics = this.physics ? s.physics : null;
        const rough = physics && pulse > 0 && physics.at(pulse, hz[j]).fate === 'ocd';
        s.schedule(v.onAt, t, this.levelOf(v.retro, pulse, hz[j], physics), rough ? this.physics!.raspSigma : JITTER_SIGMA, textured);
      }
    });
    this.lastStep = t;
    this.snapshots.push({ t, board: this.board.clone() });
  }

  private levelOf(retro: boolean, pulseUs: number, hz: number, physics: CoilResponse | null = null): number {
    if (physics && this.physics) {
      const db = SndBang.db(physics, pulseUs, hz, this.physics.bang);
      return db <= -60 ? 0 : (retro ? PULSE_REF_GAIN : TESLA_REF_GAIN) * 10 ** (db / 20);
    }
    return retro ? PULSE_REF_GAIN * this.flatLaw.level(pulseUs, hz) : TESLA_REF_GAIN * this.law.level(pulseUs, hz);
  }

  /** Forget what the clock has passed: dead voices, old marks, old controller values. */
  private prune(now: number): void {
    const past = now - 0.1;
    this.live = this.live.filter((v) => {
      const death = v.death;
      if (death == null || death + v.endFade + 0.05 > past) return true;
      this.board.forget(v.id);
      v.disconnect(now);
      return false;
    });
    this.marks = this.marks.filter((m) => m > past);
    let keep = this.snapshots.length;
    while (keep > 0 && this.snapshots[keep - 1].t > now) keep--;
    // the last steps before the clock stay: an event now steps again from the one before it
    if (keep > 2) this.snapshots.splice(0, keep - 2);
    for (const c of this.chan) c.prune(past);
    for (const cs of this.coils) cs?.prune(past);
  }
}
