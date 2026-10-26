import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SndTeslaSynth } from './synth';
import { PHYSICS_SOUND } from './sink';
import { HORIZON_S, MAX_VOICES, noteHz, PITCH_JITTER, PUMP_MS } from './constants';
import { DevSyntherrupterV1 } from '@/model/devices/drivers/syntherrupter-v1';
import { SYNTHERRUPTER_TIVA } from '@/model/devices/profiles/syntherrupter-tiva';
import { DevCoilLimits, type CoilLimits } from '@/model/devices/coil-limits';
import { PhyResponse } from '@/model/coils/response';
import { PhySpec } from '@/model/coils/spec';
import type { CoilConfig } from '@/model/domain';

// Web Audio is not in Node: a context that records what the synth schedules, and reads a
// param's automation back at any time (set and linear ramps, the only curves the synth uses).
type Event = { ramp: boolean; v: number; t: number };

class FakeParam {
  private events: Event[] = [];
  constructor(public value = 0) {}
  setValueAtTime(v: number, t: number): this {
    return this.add({ ramp: false, v, t });
  }
  linearRampToValueAtTime(v: number, t: number): this {
    return this.add({ ramp: true, v, t });
  }
  cancelScheduledValues(t: number): this {
    this.events = this.events.filter((e) => e.t < t);
    return this;
  }
  cancelAndHoldAtTime(t: number): this {
    const v = this.at(t);
    const ramp = this.events.find((e) => e.t > t)?.ramp ?? false;
    this.events = this.events.filter((e) => e.t <= t);
    return this.add({ ramp, v, t });
  }
  at(t: number): number {
    let v = this.value;
    let from = 0;
    for (const e of this.events) {
      if (e.t > t) return e.ramp ? v + ((e.v - v) * (t - from)) / (e.t - from) : v;
      v = e.v;
      from = e.t;
    }
    return v;
  }
  private add(e: Event): this {
    const i = this.events.findIndex((x) => x.t > e.t);
    this.events.splice(i < 0 ? this.events.length : i, 0, e);
    return this;
  }
}

class FakeNode {
  readonly outs: unknown[] = [];
  gain = new FakeParam(1);
  frequency = new FakeParam(440);
  detune = new FakeParam();
  Q = new FakeParam();
  pan = new FakeParam();
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
  type = '';
  buffer: unknown = null;
  loop = false;
  startAt: number | null = null;
  stopAt: number | null = null;
  connect<T>(to: T): T {
    this.outs.push(to);
    return to;
  }
  disconnect(): void {}
  start(t = 0): void {
    this.startAt = t;
  }
  stop(t = 0): void {
    this.stopAt = t;
  }
  setPeriodicWave(): void {}
  /** An oscillator's level: the gain it feeds. */
  get level(): FakeParam {
    return (this.outs[0] as FakeNode).gain;
  }
}

class FakeContext {
  currentTime = 0;
  readonly sampleRate = 48000;
  readonly state = 'running';
  readonly destination = new FakeNode();
  readonly oscillators: FakeNode[] = [];
  createGain = () => new FakeNode();
  createStereoPanner = () => new FakeNode();
  createBiquadFilter = () => new FakeNode();
  createDynamicsCompressor = () => new FakeNode();
  createConvolver = () => new FakeNode();
  createBufferSource = () => new FakeNode();
  createOscillator = (): FakeNode => {
    const o = new FakeNode();
    this.oscillators.push(o);
    return o;
  };
  createBuffer = (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) });
  createPeriodicWave = (real: Float32Array, imag: Float32Array) => ({ real, imag });
  resume = async () => {};
}

const v1 = new DevSyntherrupterV1(SYNTHERRUPTER_TIVA);
const coil = (c: Partial<CoilConfig> = {}): CoilConfig => ({ coilIndex: 0, channelMask: 0b1, ontimeUs: 60, duty: 0.05, ...c });

const made: SndTeslaSynth[] = [];
beforeEach(() => {
  vi.stubGlobal('window', { AudioContext: FakeContext });
});
afterEach(() => {
  for (const s of made.splice(0)) s.dispose();
  vi.unstubAllGlobals();
});

/**
 * A synth on the fake context. `at(t, …messages)` runs the clock to t, the board stepped
 * on the way as its timer does (the throttled tab that skips steps is another case), then
 * sends them at t.
 */
function rig({ coils = [] as CoilConfig[], limits = null as CoilLimits[] | null } = {}) {
  const synth = new SndTeslaSynth();
  made.push(synth);
  const ctx = synth.ctx as unknown as FakeContext;
  if (limits) synth.setCoilLimits(limits);
  for (const f of coils.length ? v1.coilConfig(coils) : []) synth.send(f);
  const at = (t: number, ...messages: number[][]): void => {
    while (ctx.currentTime < t - 1e-9) {
      ctx.currentTime = Math.min(t, ctx.currentTime + PUMP_MS / 1000);
      synth.pump();
    }
    for (const m of messages) synth.send(m);
    synth.pump(t + HORIZON_S);
  };
  return { synth, ctx, at };
}

const on = (note: number, vel = 100, ch = 0) => [0x90 | ch, note, vel];
const off = (note: number, ch = 0) => [0x80 | ch, note, 0];
const cc = (num: number, v: number, ch = 0) => [0xb0 | ch, num, v];

/** How loud a lone note (A3 unless said, the constant envelope) plays at 0.1 s on `coils`. */
function loudness(coils: CoilConfig[], { note = 57, vel = 100, limits = null as CoilLimits[] | null } = {}): number {
  const { ctx, at } = rig({ coils, limits });
  at(0, on(note, vel));
  return ctx.oscillators[0].level.at(0.1);
}

describe('the built-in synth', () => {
  it('sounds a note at its pitch while its key is down, then releases it', () => {
    const { ctx, at } = rig();
    at(0, on(69));
    expect(ctx.oscillators).toHaveLength(1);
    const osc = ctx.oscillators[0];
    expect(Math.abs(osc.frequency.value / noteHz(69) - 1)).toBeLessThanOrEqual(PITCH_JITTER);
    expect(osc.startAt).toBe(0);
    expect(osc.level.at(0.1)).toBeGreaterThan(0);
    at(0.3, off(69));
    expect(osc.level.at(0.29)).toBeCloseTo(osc.level.at(0.1), 6);
    expect(osc.level.at(0.35)).toBe(0);
  });

  it('plays a note only on the coils its channel is routed to', () => {
    const { ctx, at } = rig({ coils: [coil({ channelMask: 0b01 })] });
    at(0, on(60, 100, 1));
    expect(ctx.oscillators).toHaveLength(0);
    at(0.1, on(60, 100, 0));
    expect(ctx.oscillators).toHaveLength(1);
  });

  it('plays louder with the velocity', () => {
    const c = [coil({ duty: 0.02 })];
    expect(loudness(c, { vel: 120 })).toBeGreaterThan(loudness(c, { vel: 40 }));
  });

  // the firmware's crossover (duty / ontime): under it a note fires the duty × its period, over it the ontime
  it('fires the duty under the crossover and the ontime over it', () => {
    // 10 µs at 1 % crosses over at 1 kHz: A3 is under it
    expect(loudness([coil({ ontimeUs: 10, duty: 0.02 })])).toBeGreaterThan(loudness([coil({ ontimeUs: 10, duty: 0.01 })]));
    expect(loudness([coil({ ontimeUs: 5, duty: 0.01 })])).toBeCloseTo(loudness([coil({ ontimeUs: 10, duty: 0.01 })]), 6);
    // at 1 %, 20 µs and 40 µs cross over at 500 and 250 Hz: E5 is over both
    const e5 = { note: 76 };
    expect(loudness([coil({ ontimeUs: 40, duty: 0.01 })], e5)).toBeGreaterThan(loudness([coil({ ontimeUs: 20, duty: 0.01 })], e5) * 1.5);
  });

  it('keeps a coil within its max ontime', () => {
    // A3 asks 91 µs at 2 %, 182 µs at 4 %
    const limits = [{ ...DevCoilLimits.DEFAULT, ontimeUs: 50 }];
    const at2 = [coil({ duty: 0.02 })];
    expect(loudness([coil({ duty: 0.04 })], { limits })).toBeCloseTo(loudness(at2, { limits }), 6);
    expect(loudness(at2)).toBeGreaterThan(loudness(at2, { limits }));
  });

  it('follows a change landing inside what it already scheduled', () => {
    const { ctx, at } = rig({ coils: [coil({ duty: 0.02 })] });
    at(0, on(57, 127));
    const level = ctx.oscillators[0].level;
    const before = level.at(0.03);
    expect(level.at(0.15)).toBeCloseTo(before, 6);
    // the board had stepped to 0.2: the volume halved at 0.05 steps it again from there
    at(0.05, cc(7, 64));
    expect(level.at(0.03)).toBeCloseTo(before, 6);
    expect(level.at(0.15)).toBeLessThan(before * 0.9);
  });

  it('holds released keys while the sustain pedal is down', () => {
    const { ctx, at } = rig();
    at(0, cc(64, 127), on(60));
    at(0.2, off(60));
    const level = ctx.oscillators[0].level;
    expect(level.at(0.4)).toBeGreaterThan(0);
    at(0.5, cc(64, 0));
    expect(level.at(0.6)).toBe(0);
  });

  it('ends a note when its key is struck again', () => {
    const { ctx, at } = rig();
    at(0, on(60));
    at(0.2, on(60));
    const [first, second] = ctx.oscillators;
    expect(first.level.at(0.25)).toBe(0);
    expect(second.level.at(0.3)).toBeGreaterThan(0);
  });

  it(`steals the oldest note past ${MAX_VOICES} voices`, () => {
    const { ctx, at } = rig();
    for (let i = 0; i <= MAX_VOICES; i++) at(i * 0.001, on(30 + i));
    expect(ctx.oscillators[0].level.at(0.1)).toBe(0);
    expect(ctx.oscillators[0].stopAt).not.toBeNull();
    expect(ctx.oscillators[MAX_VOICES].stopAt).toBeNull();
  });

  it('silences every note on all sound off', () => {
    const { synth, ctx, at } = rig();
    at(0, on(60), on(64));
    ctx.currentTime = 0.2;
    synth.sendAllSoundOff();
    at(0.2);
    for (const o of ctx.oscillators) expect(o.level.at(0.25)).toBe(0);
  });

  it('gives each coil its own sound when the physics is on', () => {
    const { synth, ctx, at } = rig({ coils: [coil(), coil({ coilIndex: 1 })] });
    synth.setPhysics(PHYSICS_SOUND);
    synth.setCoilPhysics([PhyResponse.of(PhySpec.PRESETS.petite), PhyResponse.of(PhySpec.PRESETS.petite)]);
    at(0, on(57));
    expect(ctx.oscillators).toHaveLength(2);
  });

  it('plays a fixed tone at its firing rate while Simple mode is on', () => {
    const { synth, ctx, at } = rig();
    const tone = { coilIndex: 0, ontimeUs: 50, duty: 0.02, frequencyHz: 100 };
    for (const f of v1.simpleStart([tone])) synth.send(f);
    at(0);
    expect(ctx.oscillators).toHaveLength(1);
    const osc = ctx.oscillators[0];
    expect(osc.frequency.value).toBe(100);
    expect(osc.level.at(0.1)).toBeGreaterThan(0.001);
    ctx.currentTime = 0.2;
    for (const f of v1.simpleStop([tone])) synth.send(f);
    expect(osc.level.at(0.3)).toBeLessThanOrEqual(0.0001);
    expect(osc.stopAt).not.toBeNull();
  });
});
