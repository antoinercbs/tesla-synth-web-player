import { afterEach, describe, it, expect } from 'vitest';
import { compileCustomEnvelopes, compileEnvelope, decodeFrame, ENVELOPE_PN } from './syntherrupter';
import {
  customEnvelope,
  envelope,
  envelopeAmplitude,
  envelopeChoices,
  programSteps,
  setCustomEnvelopes,
  stepsAmplitude,
  type EnvStep,
} from './envelopes';
import { ToneRunner, type ToneConfig } from '@/tuning/tone-runner';
import { driverFor } from '@/devices/driver';
import { SYNTHERRUPTER_TIVA } from '@/devices/profiles/syntherrupter-tiva';
import type { CustomEnvelope } from '@/types/domain';

const step = (amp: number, durMs: number, next: number, ntau = 1): EnvStep => ({ amp, durMs, next, ntau });
const STEPS: EnvStep[] = [
  step(1.2, 18, 1, 1.5), step(0.25, 90, 2, 2), step(1, 90, 1, -2),
  step(1, 0, 3), step(1, 0, 4), step(1, 0, 5), step(1, 0, 6),
  step(0, 60, 7),
];
const lib = (program: number, name: string, steps = STEPS): CustomEnvelope => ({ id: program, program, name, steps });

afterEach(() => setCustomEnvelopes([]));

describe('compileEnvelope', () => {
  it('writes the 4 fields of the 8 steps, program in TG_MSB and step in TG_LSB', () => {
    const frames = compileEnvelope(21, STEPS);
    expect(frames).toHaveLength(32);
    const first = frames[0];
    expect(first).toHaveLength(16);
    expect(first.slice(0, 6)).toEqual([0xf0, 0x00, 0x26, 0x05, 0x01, 0x7f]);
    expect(first[6]).toBe(0x01); // PN_LSB of 0x301 (amplitude)
    expect(first[7]).toBe(0x03); // PN_MSB, no float bit
    expect(first[8]).toBe(0); // step 0
    expect(first[9]).toBe(21); // program
    expect(first[15]).toBe(0xf7);
  });

  it('sends integers in the firmware units: amplitude and n-tau in 1/1000, duration in µs', () => {
    const byField = (step: number, pn: number) =>
      decodeFrame(compileEnvelope(40, STEPS).find((f) => {
        const d = decodeFrame(f);
        return d.pnFull === pn && (d.target & 0x7f) === step;
      })!);
    expect(byField(0, ENVELOPE_PN.AMPLITUDE).valueInt).toBe(1200);
    expect(byField(1, ENVELOPE_PN.DURATION).valueInt).toBe(90_000);
    expect(byField(0, ENVELOPE_PN.NTAU).valueInt).toBe(1500);
    expect(byField(2, ENVELOPE_PN.NEXT).valueInt).toBe(1);
    expect(byField(7, ENVELOPE_PN.NEXT).target >> 8).toBe(40);
  });

  it('keeps a negative n-tau negative through the 7-bit packing', () => {
    const f = compileEnvelope(21, STEPS).find((fr) => {
      const d = decodeFrame(fr);
      return d.pnFull === ENVELOPE_PN.NTAU && (d.target & 0x7f) === 2;
    })!;
    expect(decodeFrame(f).valueInt).toBe(-2000);
  });

  it('never sends a negative amplitude or duration (the firmware would ignore the frame)', () => {
    const bad = STEPS.map((s) => ({ ...s, amp: -1, durMs: -5 }));
    for (const f of compileEnvelope(22, bad)) {
      const d = decodeFrame(f);
      if (d.pnFull === ENVELOPE_PN.AMPLITUDE || d.pnFull === ENVELOPE_PN.DURATION) expect(d.valueInt).toBe(0);
    }
  });
});

describe('library envelopes registry', () => {
  it('makes a library envelope the shape of its program everywhere', () => {
    setCustomEnvelopes([lib(21, 'Pulse')]);
    expect(programSteps(21)).toBe(STEPS);
    expect(envelope(21)).toEqual({ program: 21, name: 'Pulse', kind: 'custom' });
    expect(envelopeChoices().custom.map((e) => e.program)).toEqual([21]);
  });

  it('leaves unset slots constant, like the device, and ignores malformed entries', () => {
    setCustomEnvelopes([lib(5, 'shadowing a built-in'), lib(30, 'short', STEPS.slice(0, 3))]);
    expect(customEnvelope(5)).toBeUndefined();
    expect(customEnvelope(30)).toBeUndefined();
    expect(envelopeAmplitude(30, 1000, null)).toBe(1);
  });

  it('keeps a loop cycling long after the first 64 steps', () => {
    // 18 ms attack, then 90 + 90 ms cycles: back at 1 every 180 ms from 198 ms (80+ steps walked)
    const late = 198 + 180 * 40;
    expect(stepsAmplitude(STEPS, late, null)).toBeCloseTo(1, 3);
    expect(stepsAmplitude(STEPS, late + 90, null)).toBeCloseTo(0.25, 3);
  });
});

describe('compileCustomEnvelopes', () => {
  it('sends only the library envelopes among the programs, once each', () => {
    setCustomEnvelopes([lib(21, 'Pulse'), lib(40, 'Punch')]);
    const frames = compileCustomEnvelopes([0, 1, 21, 21, 40, 63, 99]);
    expect(frames).toHaveLength(64);
    expect(new Set(frames.map((f) => f[9]))).toEqual(new Set([21, 40]));
  });
});

describe('ToneRunner.envelopeFrames', () => {
  const cfg = (over: Partial<ToneConfig>): ToneConfig => ({
    notes: [60], holdMs: 500, gapMs: 0, velocity: 127, channel: 0, coilIndex: 0,
    ontimeUs: 30, duty: 0, program: null, coilCount: 6, ...over,
  });
  const driver = driverFor(SYNTHERRUPTER_TIVA);

  it('writes the draft into its slot before the tone', () => {
    const draft = STEPS.map((s) => ({ ...s, amp: 0.5 }));
    const frames = ToneRunner.envelopeFrames(cfg({ program: 45, envelope: draft }), driver);
    expect(frames).toHaveLength(32);
    expect(decodeFrame(frames[0]).valueInt).toBe(500);
    expect(frames[0][9]).toBe(45);
  });

  it('falls back to the library, and leaves the firmware programs alone', () => {
    setCustomEnvelopes([lib(21, 'Pulse')]);
    expect(ToneRunner.envelopeFrames(cfg({ program: 21 }), driver)).toHaveLength(32);
    expect(ToneRunner.envelopeFrames(cfg({ program: 8 }), driver)).toHaveLength(0);
    expect(ToneRunner.envelopeFrames(cfg({ program: null }), driver)).toHaveLength(0);
  });
});
