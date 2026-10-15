import { describe, expect, it } from 'vitest';
import { cutsSoFar, fateKind, heldReduction, simulate, stepAt } from './coil-sim';
import type { MidiAnalysis, MidiNote } from '@/midi/analyze';
import { SONG_WIDE, type CoilConfig } from '@/types/domain';

// program 0 holds full volume while the note is down: the levels below are the velocity's
const note = (channel: number, n: number, startMs: number, endMs: number, velocity = 127, volume = 1): MidiNote =>
  ({ channel, note: n, startMs, endMs, velocity, volume });
function analysis(notes: MidiNote[]): MidiAnalysis {
  return {
    durationMs: Math.max(...notes.map((n) => n.endMs)), notes,
    channels: [...new Set(notes.map((n) => n.channel))].sort(), programByChannel: {}, programs: [],
    panEvents: [], volumeEvents: [], beats: [], beatsPerBar: 4, pitchRange: { min: 0, max: 127 },
  };
}
const coil = (coilIndex: number, channelMask: number, ontimeUs = 40, duty = 0.05): CoilConfig => ({ coilIndex, channelMask, ontimeUs, duty });
const C5 = 72; // 523 Hz: under the 1250 Hz crossover, each note asks for 5 % of duty

describe('the voices', () => {
  it('silences the oldest note of the coil, not the newest', () => {
    const a = analysis([note(0, C5, 0, 1000), note(0, 76, 20, 1000), note(0, 79, 40, 1000)]);
    const sim = simulate({ analysis: a, coils: [coil(0, 1)], limits: [{ voices: 2 }], stepMs: 10 });
    const [oldest, middle, newest] = sim.fates[0];
    expect(oldest.cuts).toEqual([[40, 1000]]);
    expect(middle.cuts).toEqual([]);
    expect(newest.cuts).toEqual([]);
    expect(sim.tracks[0].skipped[stepAt(sim, 500)]).toBe(1);
  });

  it('counts the other coils’ notes too: they take this coil’s voices', () => {
    const a = analysis([note(0, C5, 0, 1000), note(1, 60, 20, 1000), note(1, 64, 40, 1000)]);
    const sim = simulate({ analysis: a, coils: [coil(0, 0b01), coil(1, 0b10)], limits: [{ voices: 2 }, {}], stepMs: 10 });
    expect(sim.fates[0][0].cuts).toEqual([[40, 1000]]);
    expect(fateKind(sim.fates[0][0])).toBe('cut');
    expect(cutsSoFar(sim.tracks[0], 30)).toBe(0);
    expect(cutsSoFar(sim.tracks[0], 40)).toBe(1);
  });

  it('keeps a cut note silent once a voice frees up, while it holds still', () => {
    const a = analysis([note(0, C5, 0, 1000), note(0, 76, 20, 300)]);
    const sim = simulate({ analysis: a, coils: [coil(0, 1)], limits: [{ voices: 1 }], stepMs: 10 });
    expect(sim.fates[0][0].cuts).toEqual([[20, 1000]]);
  });

  it('gives it its voice back when the board looks at it again: the coil’s settings change', () => {
    const a = analysis([note(0, C5, 0, 1000), note(0, 76, 20, 300)]);
    const events = [{ coilIndex: SONG_WIDE, param: 'power' as const, atMs: 500, value: 0.5, ramp: false }];
    const sim = simulate({ analysis: a, coils: [coil(0, 1)], limits: [{ voices: 1 }], events, stepMs: 10 });
    expect(sim.fates[0][0].cuts).toEqual([[20, 500]]);
  });
});

describe('the max duty', () => {
  it('scales every note of the coil from the third one at 5 % on a 10 % coil', () => {
    const a = analysis([note(0, C5, 0, 1000), note(0, C5 + 4, 0, 1000), note(0, C5 + 7, 0, 1000)]);
    const sim = simulate({ analysis: a, coils: [coil(0, 1)], limits: [{ duty: 0.1 }], stepMs: 10 });
    const s = stepAt(sim, 500);
    expect(sim.tracks[0].dutyAsked[s]).toBeCloseTo(0.15, 5);
    expect(sim.tracks[0].duty[s]).toBeCloseTo(0.1, 5);
    expect(sim.tracks[0].factor[s]).toBeCloseTo(2 / 3, 5);
    expect(sim.fates[0].every((f) => fateKind(f) === 'reduced')).toBe(true);
  });

  it('leaves two notes untouched', () => {
    const a = analysis([note(0, C5, 0, 1000), note(0, C5 + 4, 0, 1000)]);
    const sim = simulate({ analysis: a, coils: [coil(0, 1)], limits: [{ duty: 0.1 }], stepMs: 10 });
    expect(sim.fates[0].every((f) => fateKind(f) === 'ok')).toBe(true);
  });
});

describe('what each note asks for', () => {
  it('follows the velocity, the file volume, the automation and the live power', () => {
    const a = analysis([note(0, 96, 0, 2000, 127, 0.5)]); // C7, above the crossover: the ontime rules
    const events = [{ coilIndex: SONG_WIDE, param: 'power' as const, atMs: 1000, value: 0.5, ramp: false }];
    const sim = simulate({ analysis: a, coils: [coil(0, 1)], limits: [{}], events, power: () => 50, stepMs: 10 });
    expect(sim.tracks[0].askedUs[stepAt(sim, 500)]).toBeCloseTo(40 * 0.5 * 0.5, 4);
    expect(sim.tracks[0].askedUs[stepAt(sim, 1500)]).toBeCloseTo(Math.round(40 * 0.5 * 0.5) * 0.5, 4);
  });

  it('caps the pulse at the max ontime, min ontime included', () => {
    const a = analysis([note(0, 45, 0, 1000)]); // A2: 455 µs asked
    const sim = simulate({ analysis: a, coils: [coil(0, 1)], limits: [{ ontimeUs: 150, minOntimeUs: 2 }], stepMs: 10 });
    expect(sim.tracks[0].pulseUs[stepAt(sim, 500)]).toBe(150);
    expect(sim.tracks[0].askedUs[stepAt(sim, 500)]).toBeCloseTo(454.5, 1);
  });

  it('ignores the channels no coil plays', () => {
    const a = analysis([note(0, C5, 0, 1000), note(5, 60, 0, 1000)]);
    const sim = simulate({ analysis: a, coils: [coil(0, 1)], limits: [{ voices: 1 }], stepMs: 10 });
    expect(sim.fates[0][0].cuts).toEqual([]);
  });
});

describe('the keys held in Live mode', () => {
  const key = (n: number, channel = 0, velocity = 127) => ({ note: n, channel, velocity });

  it('reduces them all once they pass the max duty', () => {
    const held = [key(C5), key(C5 + 4), key(C5 + 7)];
    expect(heldReduction(held, coil(0, 1), { duty: 0.1 })).toBeCloseTo(1 / 3, 5);
    expect(heldReduction(held.slice(0, 2), coil(0, 1), { duty: 0.1 })).toBe(0);
  });

  it('leaves out the oldest keys past the voices, the other coils’ keys counted', () => {
    // the newest key, on another channel, takes the only voice: the coil plays nothing
    expect(heldReduction([key(C5), key(C5 + 4), key(C5 + 7), key(60, 1)], coil(0, 1), { duty: 0.1, voices: 1 })).toBe(0);
    expect(heldReduction([key(C5), key(C5 + 4), key(C5 + 7)], coil(0, 1), { duty: 0.1, voices: 2 })).toBe(0);
  });

  it('follows the velocity', () => {
    expect(heldReduction([key(C5, 0, 64), key(C5 + 4, 0, 64), key(C5 + 7, 0, 64)], coil(0, 1), { duty: 0.1 })).toBe(0);
  });
});
