import { describe, expect, it } from 'vitest';
import type { MidiAnalysis, MidiNote } from '@/model/midi/analyze';
import { CalRoles } from '@/model/calib/roles';

const BEAT = 500;

function song(notes: MidiNote[], durationMs = 32_000): MidiAnalysis {
  const channels = [...new Set(notes.map((n) => n.channel))].sort((a, b) => a - b);
  return {
    durationMs, notes, channels, programByChannel: {}, programs: [0], panEvents: [], volumeEvents: [],
    beats: Array.from({ length: durationMs / BEAT }, (_, i) => i * BEAT), beatsPerBar: 4,
    pitchRange: { min: Math.min(...notes.map((n) => n.note)), max: Math.max(...notes.map((n) => n.note)) },
  };
}
/** `count` notes on `ch`, one every `every` ms, `len` ms long, cycling through `pitches`. */
function line(ch: number, pitches: number[], count: number, every: number, len: number, from = 0): MidiNote[] {
  return Array.from({ length: count }, (_, i) => ({
    channel: ch, note: pitches[i % pitches.length], startMs: from + i * every, endMs: from + i * every + len, velocity: 100, volume: 1,
  }));
}
const chord = (ch: number, roots: number[], every: number): MidiNote[] =>
  roots.flatMap((r, i) => [0, 4, 7].map((d) => ({ channel: ch, note: r + d, startMs: i * every, endMs: i * every + every * 0.9, velocity: 90, volume: 1 })));
const roleOf = (a: MidiAnalysis, ch: number) => new CalRoles(a).profiles().find((c) => c.ch === ch)?.role;

describe('channel roles', () => {
  it('tells the tune from the bass and the chords', () => {
    const a = song([
      ...line(0, [72, 74, 76, 77, 79], 60, 500, 450),
      ...line(1, [36, 43, 41, 38], 30, 1000, 900),
      ...chord(2, [60, 65, 67, 60], 2000).concat(chord(2, [60, 65, 67, 60], 2000).map((n) => ({ ...n, startMs: n.startMs + 8000, endMs: n.endMs + 8000 }))),
    ]);
    expect(roleOf(a, 0)).toBe('melody');
    expect(roleOf(a, 1)).toBe('bass');
    expect(roleOf(a, 2)).toBe('chords');
  });

  it('does not take a busy low line for the melody', () => {
    // a canon's cello: low and never silent; the violin above it, half the time
    const a = song([...line(0, [45, 43, 41, 40, 38, 36, 38, 40], 64, 500, 480), ...line(1, [74, 76, 78, 79], 32, 500, 480, 16_000)]);
    expect(roleOf(a, 1)).toBe('melody');
    expect(roleOf(a, 0)).toBe('bass');
  });

  it('keeps a rhythmic part on the coils, whatever its channel', () => {
    const a = song([...line(0, [72, 74, 76], 40, 800, 700), ...line(3, [60, 62, 64], 150, 200, 40)]);
    const p = new CalRoles(a).profiles().find((c) => c.ch === 3)!;
    expect(p.role).toBe('rhythm');
    expect(p.why.map((w) => w.kind)).toEqual(['short', 'struck']);
  });

  it('takes a kit on the General MIDI drum channel as drums, and only there', () => {
    const kit = line(9, [36, 38, 42], 150, 200, 40);
    expect(roleOf(song([...line(0, [72, 74], 40, 800, 700), ...kit]), 9)).toBe('drums');
    // the same channel holding a tune is a tune
    expect(roleOf(song([...line(0, [40, 41], 40, 800, 700), ...line(9, [72, 74, 76, 77], 40, 800, 700)]), 9)).toBe('melody');
  });
});
