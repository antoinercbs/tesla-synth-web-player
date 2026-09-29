import { describe, it, expect } from 'vitest';
import { parseMidi, writeMidi, type MidiEvent } from 'midi-file';
import { cutRange, docTempo, keepRange, leadingSilence, lostProgramChanges, readMidi, resolveOverlaps, UnsupportedMidiError, writeDoc, type EdNote } from './doc';

const on = (deltaTime: number, channel: number, noteNumber: number, velocity = 100): MidiEvent =>
  ({ deltaTime, type: 'noteOn', channel, noteNumber, velocity });
const off = (deltaTime: number, channel: number, noteNumber: number): MidiEvent =>
  ({ deltaTime, type: 'noteOff', channel, noteNumber, velocity: 0 });
const tempo = (deltaTime: number, microsecondsPerBeat: number): MidiEvent =>
  ({ deltaTime, meta: true, type: 'setTempo', microsecondsPerBeat });
const program = (deltaTime: number, channel: number, programNumber: number): MidiEvent =>
  ({ deltaTime, type: 'programChange', channel, programNumber });
const cc = (deltaTime: number, channel: number, value: number): MidiEvent =>
  ({ deltaTime, type: 'controller', channel, controllerType: 7, value });
const end = (deltaTime = 0): MidiEvent => ({ deltaTime, meta: true, type: 'endOfTrack' });

function file(tracks: MidiEvent[][], byte9 = false): number[] {
  return writeMidi({ header: { format: 1, numTracks: tracks.length, ticksPerBeat: 480 }, tracks }, { useByte9ForNoteOff: byte9 });
}
const shape = (notes: EdNote[]) =>
  notes.map((n) => [n.channel, n.note, n.tick, n.dur, n.velocity, n.track]).sort((a, b) => a[2] - b[2] || a[1] - b[1]);

describe('readMidi', () => {
  it('pairs the notes in ticks, a velocity-0 note-on ending one', () => {
    const doc = readMidi(file([[tempo(0, 400000), end()], [on(0, 1, 60, 90), off(480, 1, 60), on(0, 1, 62), off(240, 1, 62), end()]], true));
    expect(shape(doc.notes)).toEqual([[1, 60, 0, 480, 90, 1], [1, 62, 480, 240, 100, 1]]);
    expect(doc.events.map((e) => e.ev.type)).toEqual(['setTempo', 'endOfTrack', 'endOfTrack']);
  });

  it('stops a held note where the same key is struck again', () => {
    const doc = readMidi(file([[on(0, 0, 60), on(240, 0, 60), off(240, 0, 60), off(240, 0, 60), end()]]));
    expect(shape(doc.notes)).toEqual([[0, 60, 0, 240, 100, 0], [0, 60, 240, 240, 100, 0]]);
  });

  it('reads each channel\'s first instrument', () => {
    const doc = readMidi(file([[program(0, 2, 5), on(0, 2, 60), program(480, 2, 9), off(0, 2, 60), end()]]));
    expect(doc.readPrograms).toEqual({ 2: 5 });
  });

  it('refuses a file timed in SMPTE frames', () => {
    const bytes = writeMidi({ header: { format: 0, numTracks: 1, framesPerSecond: 25, ticksPerFrame: 40 }, tracks: [[end()]] });
    expect(() => readMidi(bytes)).toThrow(UnsupportedMidiError);
  });
});

describe('writeDoc', () => {
  it('writes back what it read', () => {
    const src = file([
      [tempo(0, 500000), tempo(960, 250000), end(100)],
      [program(0, 0, 4), cc(0, 0, 90), on(0, 0, 60), off(480, 0, 60), on(0, 0, 64, 70), off(960, 0, 64), end()],
      [on(240, 9, 36, 120), off(60, 9, 36), end()],
    ]);
    const doc = readMidi(src);
    const again = readMidi(writeDoc(doc));
    expect(shape(again.notes)).toEqual(shape(doc.notes));
    expect(again.events.map((e) => [e.track, e.tick, e.ev.type])).toEqual(doc.events.map((e) => [e.track, e.tick, e.ev.type]));
  });

  it('starts a channel on the instrument chosen for it, and leaves the others\' program changes', () => {
    const doc = readMidi(file([
      [program(0, 0, 4), on(0, 0, 60), program(480, 0, 7), off(0, 0, 60), end()],
      [program(0, 1, 2), on(0, 1, 48), off(480, 1, 48), end()],
    ]));
    doc.programs[0] = 22;
    const out = parseMidi(writeDoc(doc));
    const pcs = out.tracks.map((t) => t.filter((e) => e.type === 'programChange').map((e) => [(e as { channel: number }).channel, (e as { programNumber: number }).programNumber]));
    expect(pcs).toEqual([[[0, 22]], [[1, 2]]]);
    // before its first note
    expect(out.tracks[0][0].type).toBe('programChange');
  });

  it('writes a channel created in the editor with its program change, in the notes\' track', () => {
    const doc = readMidi(file([[on(0, 0, 60), off(480, 0, 60), end()]]));
    doc.notes[0].channel = 5;
    doc.programs[5] = 0;
    const out = parseMidi(writeDoc(doc));
    expect(out.tracks[0].slice(0, 2).map((e) => e.type)).toEqual(['programChange', 'noteOn']);
  });

  it('keeps a track\'s trailing length, and ends it after its last note', () => {
    const length = (d: ReturnType<typeof readMidi>) => parseMidi(writeDoc(d)).tracks[0].reduce((s, e) => s + e.deltaTime, 0);
    const doc = readMidi(file([[on(0, 0, 60), off(480, 0, 60), end(1000)]]));
    expect(length(doc)).toBe(1480);
    doc.notes[0].dur = 3000;
    expect(length(doc)).toBe(3000);
  });
});

describe('lostProgramChanges', () => {
  // ch 0: set up before its notes (twice), then changes at 480 and 960, and one repeating what plays
  const tracks = (): MidiEvent[][] => [
    [program(0, 0, 4), program(0, 0, 6), on(240, 0, 60), off(240, 0, 60), program(0, 0, 7), program(480, 0, 7), program(0, 0, 4), on(0, 0, 62), off(480, 0, 62), end()],
    [on(0, 1, 48), program(480, 1, 3), off(0, 1, 48), end()],
  ];

  it('counts the instrument changes made once a replaced channel\'s notes have started', () => {
    const doc = readMidi(file(tracks()));
    doc.programs[0] = 22;
    expect(lostProgramChanges(doc)).toEqual({ 0: 2 });
  });

  it('counts a first program change after the notes, from the program 0 they start on', () => {
    const doc = readMidi(file(tracks()));
    doc.programs[1] = 9;
    expect(lostProgramChanges(doc)).toEqual({ 1: 1 });
  });

  it('says nothing for a channel whose program changes are kept', () => {
    const doc = readMidi(file(tracks()));
    expect(lostProgramChanges(doc)).toEqual({});
    doc.programs[0] = 4;
    expect(lostProgramChanges(doc)).toEqual({});
  });
});

describe('resolveOverlaps', () => {
  const n = (tick: number, dur: number, note = 60, channel = 0): EdNote => ({ id: tick * 1000 + dur, channel, note, tick, dur, velocity: 100, track: 0 });

  it('stops a note where the same key starts again, and keeps the longest of two together', () => {
    const out = resolveOverlaps([n(0, 500), n(200, 100), n(200, 400), n(0, 100, 62), n(50, 50, 60, 1)]);
    expect(out.map((x) => [x.channel, x.note, x.tick, x.dur])).toEqual([[0, 60, 0, 200], [0, 60, 200, 400], [0, 62, 0, 100], [1, 60, 50, 50]]);
  });
});

describe('passages', () => {
  const doc = () => readMidi(file([
    [tempo(0, 500000), tempo(1200, 250000), cc(0, 0, 10), end(2000)],
    [on(0, 0, 60), off(1500, 0, 60), on(0, 0, 62), off(480, 0, 62), on(0, 0, 64), off(480, 0, 64), end()],
  ]));

  it('cuts a passage out: a note crossing its start stops there, the rest closes up, the settings in it land on its edge', () => {
    const d = doc();
    const tl = cutRange(d, 960, 1920);
    expect(tl.notes.map((x) => [x.note, x.tick, x.dur])).toEqual([[60, 0, 960], [64, 1020, 480]]);
    expect(tl.events.filter((e) => e.track === 0).map((e) => [e.ev.type, e.tick])).toEqual([['setTempo', 0], ['setTempo', 960], ['controller', 960], ['endOfTrack', 2240]]);
  });

  it('keeps a passage alone, from the start, with the settings made before it', () => {
    const tl = keepRange(doc(), 1200, 2000);
    expect(tl.notes.map((x) => [x.note, x.tick, x.dur])).toEqual([[62, 300, 480], [64, 780, 20]]);
    expect(tl.events.filter((e) => e.track === 0).map((e) => [e.ev.type, e.tick])).toEqual([['setTempo', 0], ['setTempo', 0], ['controller', 0]]);
  });

  it('counts the leading silence in whole beats', () => {
    const d = readMidi(file([[on(1300, 0, 60), off(100, 0, 60), end()]]));
    expect(leadingSilence(d)).toBe(960);
  });

  it('follows the tempo changes both ways', () => {
    const map = docTempo(doc());
    expect(map.toMs(1200)).toBe(1250);
    expect(map.toMs(1440)).toBe(1375);
    expect(map.toTick(1375)).toBe(1440);
    expect(map.toTick(1000)).toBe(960);
  });
});
