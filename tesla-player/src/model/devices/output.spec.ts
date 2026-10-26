import { describe, expect, it } from 'vitest';
import { DevOutput } from './output';

// the app's defaults against a coil limited to 150 µs
const DRIVE = { ontimeUs: 40, duty: 0.05 };
const MAX = { ontimeUs: 150 };

describe('MIDI mode, as the firmware runs it', () => {
  it('hands over from the duty to the ontime at 1250 Hz', () => {
    expect(new DevOutput(DRIVE).crossoverHz).toBeCloseTo(1250, 6);
  });

  it('fires the ontime above the crossover and the duty × period under it', () => {
    expect(new DevOutput(DRIVE, MAX).effective(2000)).toBeCloseTo(40, 6);
    expect(new DevOutput(DRIVE, MAX).effective(440)).toBeCloseTo(113.6, 1);
  });

  it('caps the low notes at the coil limit, after the volume', () => {
    expect(new DevOutput(DRIVE).requested(110)).toBeCloseTo(454.5, 1);
    expect(new DevOutput(DRIVE, MAX).effective(110)).toBe(150);
    // half the volume still asks for more than the cap: no change heard
    expect(new DevOutput(DRIVE, MAX).effective(110, 0.5)).toBe(150);
    expect(new DevOutput(DRIVE, MAX).effective(110, 0.25)).toBeCloseTo(113.6, 1);
    expect(new DevOutput(DRIVE, MAX).capVolume(110)).toBeCloseTo(0.33, 2);
  });

  it('saturates the notes under 333 Hz', () => {
    expect(new DevOutput(DRIVE, MAX).saturationHz).toBeCloseTo(333.3, 1);
    expect(new DevOutput(DRIVE, MAX).capVolume(2000)).toBeGreaterThan(1);
  });

  it('saturates every note once the ontime alone passes the limit', () => {
    expect(new DevOutput({ ontimeUs: 200, duty: 0.05 }, MAX).saturationHz).toBe(Infinity);
  });

  it('computes without a cap when the coil limits are unknown', () => {
    expect(new DevOutput(DRIVE).effective(110)).toBeCloseTo(454.5, 1);
    expect(new DevOutput(DRIVE, null).saturationHz).toBe(0);
  });

  it('moves the crossover with the duty: 0.6 % hands over at 150 Hz', () => {
    const drive = { ontimeUs: 40, duty: 0.006 };
    expect(new DevOutput(drive).crossoverHz).toBeCloseTo(150, 6);
    expect(new DevOutput(drive, MAX).effective(50)).toBeCloseTo(120, 6);
    expect(new DevOutput(drive, MAX).effective(220)).toBeCloseTo(40, 6);
  });

  it('mutes a note under 1 µs', () => {
    expect(new DevOutput({ ontimeUs: 40, duty: 0 }, MAX).effective(2000, 0.02)).toBe(0);
    expect(new DevOutput({ ontimeUs: 0, duty: 0 }, MAX).effective(440)).toBe(0);
  });

  it('drops a pulse the output cannot fire, under 4 µs', () => {
    expect(new DevOutput(DRIVE, MAX).effective(2000, 0.09)).toBe(0); // 3.6 µs
    expect(new DevOutput(DRIVE, MAX).effective(2000, 0.1)).toBeCloseTo(4, 6);
    // the min ontime lifts it over the floor
    expect(new DevOutput(DRIVE, { ontimeUs: 150, minOntimeUs: 2 }).effective(2000, 0.05)).toBeCloseTo(4, 6);
  });

  it('divides by at least 1 µs like the firmware', () => {
    expect(new DevOutput({ ontimeUs: 0, duty: 0.05 }).crossoverHz).toBeCloseTo(50_000, 6);
  });
});

describe('the min ontime and the output', () => {
  const LIMITS = { ontimeUs: 150, minOntimeUs: 2 };

  it('adds the min ontime to a note under the cap', () => {
    expect(new DevOutput(DRIVE, LIMITS).effective(2000)).toBeCloseTo(42, 6);
  });

  it('keeps a capped note at the max ontime, min ontime included', () => {
    expect(new DevOutput(DRIVE, LIMITS).effective(110)).toBe(150);
    expect(DevOutput.cap(LIMITS)).toBe(148);
    expect(new DevOutput(DRIVE, LIMITS).saturationHz).toBeCloseTo(50_000 / 148, 3);
  });
});

describe('the max duty, shared by the notes sounding together', () => {
  const LIMITS = { ontimeUs: 150, duty: 0.1 };
  const medium = { ontimeUs: new DevOutput(DRIVE).requested(523.25), hz: 523.25 }; // 5 % each

  it('lets two notes at 5 % through a 10 % coil untouched', () => {
    const l = DevOutput.limit([medium, medium], LIMITS);
    expect(l.factor).toBe(1);
    expect(l.duty).toBeCloseTo(0.1, 6);
  });

  it('scales all of them by the same factor from the third', () => {
    const l = DevOutput.limit([medium, medium, medium], LIMITS);
    expect(l.factor).toBeCloseTo(2 / 3, 6);
    expect(l.dutyAsked).toBeCloseTo(0.15, 6);
    expect(l.duty).toBeCloseTo(0.1, 6);
    expect(l.pulsesUs.every((us) => Math.abs(us - medium.ontimeUs * (2 / 3)) < 1e-6)).toBe(true);
  });

  it('reduces even a lone note that asks for more than the coil allows', () => {
    // C8 at 40 µs: 16.7 % of duty
    expect(new DevOutput(DRIVE, LIMITS).effective(4186)).toBeCloseTo((0.1 * 1e6) / 4186, 3);
  });

  it('leaves the min ontime out when it alone would pass the max duty', () => {
    // 6 µs at 2000 Hz is 1.2 % on its own
    const l = DevOutput.limit([{ ontimeUs: 40, hz: 2000 }], { duty: 0.01, minOntimeUs: 6 });
    expect(l.pulsesUs[0]).toBeCloseTo((0.01 * 1e6) / 2000, 6);
  });
});

describe('fixed mode', () => {
  it('turns the duty into the ontime at the BPS, the ontime sent ignored', () => {
    expect(new DevOutput(DRIVE).fixedRequested(100)).toBeCloseTo(500, 6);
    expect(new DevOutput(DRIVE, MAX).fixedPulse(100)).toBe(150);
    expect(new DevOutput({ ontimeUs: 40, duty: 0.004 }, MAX).fixedPulse(100)).toBeCloseTo(40, 6);
    expect(new DevOutput({ ontimeUs: 300, duty: 0.004 }, MAX).fixedPulse(100)).toBeCloseTo(40, 6);
  });

  it('holds to the max duty too: 1000 Hz at 20 % stops at 100 µs on a 10 % coil', () => {
    expect(new DevOutput({ ontimeUs: 40, duty: 0.2 }, { ontimeUs: 150, duty: 0.1 }).fixedPulse(1000)).toBeCloseTo(100, 6);
  });

  it('fires nothing without a frequency', () => {
    expect(new DevOutput(DRIVE, MAX).fixedPulse(0)).toBe(0);
  });
});
