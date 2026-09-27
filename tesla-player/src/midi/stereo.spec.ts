import { describe, it, expect } from 'vitest';
import type { MidiAnalysis, MidiNote } from './analyze';
import {
  CENTER,
  MIN_REACH,
  defaultStereo,
  filePanAt,
  filePanOf,
  fitCoils,
  noteCoilVolumes,
  notePans,
  panVolume,
  pitchToPan,
  spreadCoils,
} from './stereo';
import { PAN_PN, compileStereo, decodeFrame, stereoChannelMessages } from '@/sysex/syntherrupter';
import type { CoilConfig, SongStereo } from '@/types/domain';

const note = (channel: number, n: number, startMs: number, endMs: number, velocity = 100): MidiNote =>
  ({ channel, note: n, startMs, endMs, velocity });
function analysis(notes: MidiNote[], panEvents: MidiAnalysis['panEvents'] = []): MidiAnalysis {
  return {
    durationMs: 1000, notes, channels: [...new Set(notes.map((n) => n.channel))].sort(),
    programByChannel: {}, programs: [], panEvents, beats: [], beatsPerBar: 4,
    pitchRange: { min: 0, max: 127 },
  };
}
const coil = (coilIndex: number, channelMask: number): CoilConfig => ({ coilIndex, channelMask, ontimeUs: 40, duty: 0.05 });
const pitch = (noteLow: number, noteHigh: number, lowOn: 'left' | 'right' = 'left', follow: 'each' | 'lowest' | 'highest' | 'loudest' = 'each') =>
  ({ source: 'pitch' as const, follow, noteLow, noteHigh, lowOn });

describe('spreading the coils', () => {
  it('spaces them evenly: reach meets the neighbour on fade, stops halfway one at a time', () => {
    expect(spreadCoils(3, 'fade')).toEqual([{ position: 0.17, reach: 0.33 }, { position: 0.5, reach: 0.33 }, { position: 0.83, reach: 0.33 }]);
    expect(spreadCoils(2, 'single')).toEqual([{ position: 0.25, reach: 0.25 }, { position: 0.75, reach: 0.25 }]);
  });

  it('fits a new coil count, keeping the coils already placed', () => {
    const s: SongStereo = { ...defaultStereo(2), coils: [{ position: 0.1, reach: 0.2 }, { position: 0.9, reach: 0.2 }] };
    const three = fitCoils(s, 3);
    expect(three.coils.slice(0, 2)).toEqual(s.coils);
    expect(three.coils[2]).toEqual({ position: 0.83, reach: 0.33 });
    expect(fitCoils(s, 1).coils).toEqual([s.coils[0]]);
  });
});

describe('where the notes sit', () => {
  it('follows the file pan in time, centred before any', () => {
    const a = analysis([note(0, 60, 0, 10)], [{ channel: 0, atMs: 100, value: 0 }, { channel: 1, atMs: 50, value: 127 }, { channel: 0, atMs: 300, value: 127 }]);
    expect(filePanAt(a, 0, 50)).toBe(CENTER);
    expect(filePanAt(a, 0, 200)).toBe(0);
    expect(filePanAt(a, 0, 400)).toBe(1);
    expect(filePanOf(a, 0)).toEqual({ kind: 'moving', min: 0, max: 127 });
    expect(filePanOf(a, 1)).toEqual({ kind: 'fixed', value: 127 });
    expect(filePanOf(a, 2)).toEqual({ kind: 'none' });
  });

  it('maps pitch linearly inside the range, clamped outside, either way round', () => {
    expect(pitchToPan(48, pitch(48, 72))).toBe(0);
    expect(pitchToPan(60, pitch(48, 72))).toBe(0.5);
    expect(pitchToPan(90, pitch(48, 72))).toBe(1);
    expect(pitchToPan(54, pitch(48, 72, 'right'))).toBe(0.75);
  });

  it('places chords by their lowest, highest or loudest note at each note start', () => {
    const notes = [note(0, 48, 0, 1000, 60), note(0, 72, 100, 1000, 120), note(0, 60, 200, 1000, 90)];
    const at = (follow: 'lowest' | 'highest' | 'loudest') =>
      notePans(analysis(notes), { ...defaultStereo(2), channels: { 0: pitch(48, 72, 'left', follow) } });
    expect(at('lowest')).toEqual([0, 0, 0]);
    expect(at('highest')).toEqual([0, 1, 1]);
    expect(at('loudest')).toEqual([0, 1, 1]);
  });

  it('leaves omni notes unplaced (they play everywhere)', () => {
    expect(notePans(analysis([note(0, 60, 0, 10)]), { ...defaultStereo(2), channels: { 0: { source: 'omni' } } })).toEqual([null]);
  });
});

describe('how loud each coil plays', () => {
  const k = { position: 0.5, reach: 0.25 };

  it('fades with the distance as the firmware computes it (1.01 - d / reach)', () => {
    expect(panVolume(0.5, k, 'fade')).toBe(1);
    expect(panVolume(0.625, k, 'fade')).toBeCloseTo(0.51, 5);
    expect(panVolume(0.76, k, 'fade')).toBe(0);
  });

  it('is all or nothing one coil at a time', () => {
    expect(panVolume(0.74, k, 'single')).toBe(1);
    expect(panVolume(0.8, k, 'single')).toBe(0);
  });

  it('never divides by a zero reach', () => {
    expect(panVolume(0.5, { position: 0.5, reach: 0 }, 'fade')).toBe(1);
    expect(panVolume(0.5 + MIN_REACH * 2, { position: 0.5, reach: 0 }, 'fade')).toBe(0);
  });

  it('only counts the coils the channel is assigned to', () => {
    const a = analysis([note(0, 48, 0, 10), note(1, 72, 0, 10)]);
    const coils = [coil(0, 0b11), coil(1, 0b01)];
    expect(noteCoilVolumes(a, coils, null)).toEqual([[1, 1], [1, 0]]);
    const stereo: SongStereo = { blend: 'single', coils: [{ position: 0, reach: 0.3 }, { position: 1, reach: 0.3 }], channels: { 0: pitch(48, 72), 1: pitch(48, 72) } };
    expect(noteCoilVolumes(a, coils, stereo)).toEqual([[1, 0], [0, 0]]);
  });
});

describe('sending the spatialisation', () => {
  const stereo: SongStereo = {
    blend: 'single',
    coils: [{ position: 0.25, reach: 0 }, { position: 0.75, reach: 0.3 }],
    channels: { 2: pitch(48, 84, 'right', 'lowest'), 5: { source: 'omni' } },
  };

  it('places the song coils with floats, unplaces the others, then resets the NRPs', () => {
    const frames = compileStereo(stereo, 2).map((f) => decodeFrame(f));
    const of = (pn: number, coilIndex: number) => frames.find((d) => d.pnFull === pn && d.target === coilIndex);
    expect(of(PAN_PN.CONFIG, 0)?.valueInt).toBe(0); // one at a time = constant volume
    expect(of(PAN_PN.POSITION, 1)).toMatchObject({ isFloat: true });
    expect(of(PAN_PN.POSITION, 1)?.valueFloat).toBeCloseTo(0.75, 6);
    expect(of(PAN_PN.REACH, 0)?.valueFloat).toBeCloseTo(MIN_REACH, 6);
    expect(of(PAN_PN.POSITION, 4)?.valueFloat).toBe(-1);
    expect(of(PAN_PN.REACH, 4)).toBeUndefined();
    expect(frames.at(-1)).toMatchObject({ pnFull: PAN_PN.RESET_NRPS, valueInt: 0xffff });
  });

  it('switches every coil off when the song has no spatialisation', () => {
    const frames = compileStereo(null, 3).map((f) => decodeFrame(f));
    expect(frames.filter((d) => d.pnFull === PAN_PN.POSITION).map((d) => d.valueFloat)).toEqual([-1, -1, -1, -1, -1, -1]);
    expect(frames.some((d) => d.pnFull === PAN_PN.REACH)).toBe(false);
  });

  it('writes NRP 42 for pitch and omni channels, CC 6 upper and CC 38 lower', () => {
    const msgs = stereoChannelMessages(stereo);
    const ch2 = msgs.filter((m) => m[0] === 0xb2).map((m) => [m[1], m[2]]);
    expect(ch2).toEqual([
      [99, 42], [98, 0], [38, 3], // lowest
      [99, 42], [98, 1], [6, 84], [38, 48],
      [99, 42], [98, 2], [6, 0], [38, 127], // low notes on the right
      [99, 127], [98, 127],
    ]);
    const ch5 = msgs.filter((m) => m[0] === 0xb5).map((m) => [m[1], m[2]]);
    expect(ch5).toEqual([[99, 42], [98, 0], [38, 2], [99, 127], [98, 127]]);
    expect(stereoChannelMessages(null)).toEqual([]);
  });
});
