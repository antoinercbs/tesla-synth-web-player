import { describe, it, expect } from 'vitest';
import { coilLevelAt, curveAt, curvePoints, effectiveRatio, levelSamples, snapToBeat } from './automation';
import { analyzeMidi } from './analyze';
import { SONG_WIDE, type CoilEvent } from '@/types/domain';

const song = (atMs: number, value: number, ramp = false): CoilEvent => ({ coilIndex: SONG_WIDE, param: 'power', atMs, value, ramp });
const coil = (coilIndex: number, param: 'ontime' | 'duty', atMs: number, value: number, ramp = false): CoilEvent =>
  ({ coilIndex, param, atMs, value, ramp });

describe('curveAt', () => {
  it('holds 100 % before the first point, then each step until the next', () => {
    const pts = [song(1000, 0.5), song(3000, 1.5)];
    expect(curveAt(pts, 0)).toBe(1);
    expect(curveAt(pts, 1000)).toBe(0.5);
    expect(curveAt(pts, 2999)).toBe(0.5);
    expect(curveAt(pts, 5000)).toBe(1.5);
  });

  it('reaches a ramp point linearly from the previous one (from 100 % at 0 for a first one)', () => {
    const pts = [song(1000, 0.5), song(3000, 1.5, true)];
    expect(curveAt(pts, 2000)).toBeCloseTo(1, 9);
    expect(curveAt([song(2000, 0, true)], 1000)).toBeCloseTo(0.5, 9);
  });

  it('keeps the last of two points at the same time', () => {
    expect(curveAt(curvePoints([song(1000, 0.2), song(1000, 0.8)], SONG_WIDE, 'power'), 1500)).toBe(0.8);
  });
});

describe('effectiveRatio', () => {
  it('multiplies the song power by the coil curve, parameter by parameter', () => {
    const events = [song(0, 0.5), coil(1, 'ontime', 0, 1.5), coil(1, 'duty', 0, 2)];
    expect(effectiveRatio(events, 1, 'ontime', 100)).toBeCloseTo(0.75, 9);
    expect(effectiveRatio(events, 1, 'duty', 100)).toBeCloseTo(1, 9);
    expect(effectiveRatio(events, 0, 'ontime', 100)).toBeCloseTo(0.5, 9); // no curve of its own
  });
});

describe('what a coil is sent', () => {
  const base = { coilIndex: 0, channelMask: 1, ontimeUs: 40, duty: 0.05 };

  it('is its setting × the automation × the live power: the fader always applies', () => {
    const events = [song(0, 1.3)];
    // the operator pulled the fader to 70 %: the 130 % change does not override it
    expect(coilLevelAt(events, base, 500, 70, 70)).toEqual({ ontimeUs: 36, duty: expect.closeTo(0.0455, 9) });
    expect(coilLevelAt([], base, 500, 100, 100)).toEqual({ ontimeUs: 40, duty: 0.05 });
  });

  it('never asks for more than a full duty', () => {
    expect(coilLevelAt([song(0, 2)], { ...base, duty: 0.8 }, 0, 100, 100).duty).toBe(1);
  });
});

describe('levelSamples', () => {
  it('draws a step as a vertical jump and samples a ramp', () => {
    const s = levelSamples([song(1000, 0.5), song(2000, 1, true)], SONG_WIDE, 'power', 3000);
    expect(s.filter(([t]) => t === 1000)).toEqual([[1000, 1], [1000, 0.5]]);
    expect(s.find(([t]) => t === 1500)?.[1]).toBeCloseTo(0.75, 9);
    expect(s.at(-1)).toEqual([3000, 1]);
  });

  it('draws a coil lane at the product of both curves', () => {
    const s = levelSamples([song(0, 0.5), coil(2, 'ontime', 1000, 2)], 2, 'ontime', 2000);
    expect(s.at(-1)).toEqual([2000, 1]);
    expect(s[0]).toEqual([0, 0.5]);
  });
});

describe('snapToBeat', () => {
  it('lands on the nearest beat, or on 100 ms without a tempo map', () => {
    expect(snapToBeat([0, 500, 1000, 1500], 740)).toBe(500);
    expect(snapToBeat([0, 500, 1000, 1500], 760)).toBe(1000);
    expect(snapToBeat([0, 500], 9000)).toBe(500);
    expect(snapToBeat([], 1234)).toBe(1200);
  });
});

describe('beats of the analysis', () => {
  it('follow the tempo changes and the time signature', () => {
    const note = (deltaTime: number, subtype: 'noteOn' | 'noteOff') =>
      ({ deltaTime, type: 'channel', subtype, channel: 0, noteNumber: 60, velocity: 100 });
    const a = analyzeMidi({
      header: { ticksPerBeat: 480 },
      tracks: [[
        { deltaTime: 0, type: 'meta', subtype: 'timeSignature', numerator: 3 },
        note(0, 'noteOn'),
        { deltaTime: 960, type: 'meta', subtype: 'setTempo', microsecondsPerBeat: 250000 },
        note(960, 'noteOff'),
      ]],
    });
    // 2 beats at 120 BPM (500 ms), then 240 BPM (250 ms)
    expect(a.beats).toEqual([0, 500, 1000, 1250, 1500]);
    expect(a.beatsPerBar).toBe(3);
  });
});
