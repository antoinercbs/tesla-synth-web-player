import { afterEach, describe, it, expect } from 'vitest';
import { ENVELOPE_PN } from '@/model/sysex/syntherrupter';
import { SndEnvPrograms, type EnvStep } from '@/model/sysex/envelopes';
import { SndEnvelope } from '@/model/envelopes/envelope';
import { ToneRunner, type ToneConfig } from '@/engine/tuning/tone-runner';
import { DevDrivers } from '@/model/devices/driver';
import { SYNTHERRUPTER_TIVA } from '@/model/devices/profiles/syntherrupter-tiva';
import type { CustomEnvelope } from '@/model/domain';
import { DevFrame } from '@/model/sysex/frame';
import { DevSyntherrupterV1 } from '@/model/devices/drivers/syntherrupter-v1';

// the protocol's encoders, on the board they were written for
const v1 = new DevSyntherrupterV1(SYNTHERRUPTER_TIVA);

const step = (amp: number, durMs: number, next: number, ntau = 1): EnvStep => ({ amp, durMs, next, ntau });
const STEPS: EnvStep[] = [
  step(1.2, 18, 1, 1.5), step(0.25, 90, 2, 2), step(1, 90, 1, -2),
  step(1, 0, 3), step(1, 0, 4), step(1, 0, 5), step(1, 0, 6),
  step(0, 60, 7),
];
const lib = (program: number, name: string, steps = STEPS): CustomEnvelope => ({ id: program, program, name, steps });

afterEach(() => SndEnvPrograms.setCustom([]));

describe("the driver's envelope frames", () => {
  it('writes the 4 fields of the 8 steps, program in TG_MSB and step in TG_LSB', () => {
    const frames = v1.envelope(21, STEPS);
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
      DevFrame.decode(v1.envelope(40, STEPS).find((f) => {
        const d = DevFrame.decode(f);
        return d.pnFull === pn && (d.target & 0x7f) === step;
      })!);
    expect(byField(0, ENVELOPE_PN.AMPLITUDE).valueInt).toBe(1200);
    expect(byField(1, ENVELOPE_PN.DURATION).valueInt).toBe(90_000);
    expect(byField(0, ENVELOPE_PN.NTAU).valueInt).toBe(1500);
    expect(byField(2, ENVELOPE_PN.NEXT).valueInt).toBe(1);
    expect(byField(7, ENVELOPE_PN.NEXT).target >> 8).toBe(40);
  });

  it('keeps a negative n-tau negative through the 7-bit packing', () => {
    const f = v1.envelope(21, STEPS).find((fr) => {
      const d = DevFrame.decode(fr);
      return d.pnFull === ENVELOPE_PN.NTAU && (d.target & 0x7f) === 2;
    })!;
    expect(DevFrame.decode(f).valueInt).toBe(-2000);
  });

  it('never sends a negative amplitude or duration (the firmware would ignore the frame)', () => {
    const bad = STEPS.map((s) => ({ ...s, amp: -1, durMs: -5 }));
    for (const f of v1.envelope(22, bad)) {
      const d = DevFrame.decode(f);
      if (d.pnFull === ENVELOPE_PN.AMPLITUDE || d.pnFull === ENVELOPE_PN.DURATION) expect(d.valueInt).toBe(0);
    }
  });
});

describe('library envelopes registry', () => {
  it('makes a library envelope the shape of its program everywhere', () => {
    SndEnvPrograms.setCustom([lib(21, 'Pulse')]);
    expect(SndEnvPrograms.steps(21)).toBe(STEPS);
    expect(SndEnvPrograms.info(21)).toEqual({ program: 21, name: 'Pulse', kind: 'custom' });
    expect(SndEnvPrograms.choices().custom.map((e) => e.program)).toEqual([21]);
  });

  it('leaves unset slots constant, like the device, and ignores malformed entries', () => {
    SndEnvPrograms.setCustom([lib(5, 'shadowing a built-in'), lib(30, 'short', STEPS.slice(0, 3))]);
    expect(SndEnvPrograms.custom(5)).toBeUndefined();
    expect(SndEnvPrograms.custom(30)).toBeUndefined();
    expect(SndEnvelope.of(30).amplitude(1000, null)).toBe(1);
  });

  it('keeps a loop cycling long after the first 64 steps', () => {
    // 18 ms attack, then 90 + 90 ms cycles: back at 1 every 180 ms from 198 ms (80+ steps walked)
    const late = 198 + 180 * 40;
    expect(new SndEnvelope(STEPS).amplitude(late, null)).toBeCloseTo(1, 3);
    expect(new SndEnvelope(STEPS).amplitude(late + 90, null)).toBeCloseTo(0.25, 3);
  });
});

describe("the driver's library envelopes", () => {
  it('sends only the library envelopes among the programs, once each', () => {
    SndEnvPrograms.setCustom([lib(21, 'Pulse'), lib(40, 'Punch')]);
    const frames = v1.libraryEnvelopes([0, 1, 21, 21, 40, 63, 99]);
    expect(frames).toHaveLength(64);
    expect(new Set(frames.map((f) => f[9]))).toEqual(new Set([21, 40]));
  });
});

describe('ToneRunner.envelopeFrames', () => {
  const cfg = (over: Partial<ToneConfig>): ToneConfig => ({
    notes: [60], holdMs: 500, gapMs: 0, velocity: 127, channel: 0, coilIndex: 0,
    ontimeUs: 30, duty: 0, program: null, coilCount: 6, ...over,
  });
  const driver = DevDrivers.of(SYNTHERRUPTER_TIVA);

  it('writes the draft into its slot before the tone', () => {
    const draft = STEPS.map((s) => ({ ...s, amp: 0.5 }));
    const frames = ToneRunner.envelopeFrames(cfg({ program: 45, envelope: draft }), driver);
    expect(frames).toHaveLength(32);
    expect(DevFrame.decode(frames[0]).valueInt).toBe(500);
    expect(frames[0][9]).toBe(45);
  });

  it('falls back to the library, and leaves the firmware programs alone', () => {
    SndEnvPrograms.setCustom([lib(21, 'Pulse')]);
    expect(ToneRunner.envelopeFrames(cfg({ program: 21 }), driver)).toHaveLength(32);
    expect(ToneRunner.envelopeFrames(cfg({ program: 8 }), driver)).toHaveLength(0);
    expect(ToneRunner.envelopeFrames(cfg({ program: null }), driver)).toHaveLength(0);
  });
});
