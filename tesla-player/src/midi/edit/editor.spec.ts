import { describe, it, expect } from 'vitest';
import { parseMidi, writeMidi, type MidiEvent } from 'midi-file';
import { readMidi, type EdNote } from './doc';
import { MidiEditor } from './editor';
import { beyondVoices, chordRest, chordTops, shorterThan, sameKeys } from './select';
import { tempoMap } from '@/midi/tempo';

const on = (deltaTime: number, channel: number, noteNumber: number, velocity = 100): MidiEvent =>
  ({ deltaTime, type: 'noteOn', channel, noteNumber, velocity });
const off = (deltaTime: number, channel: number, noteNumber: number): MidiEvent =>
  ({ deltaTime, type: 'noteOff', channel, noteNumber, velocity: 0 });
const end = (deltaTime = 0): MidiEvent => ({ deltaTime, meta: true, type: 'endOfTrack' });

// a conductor track, then a melody on channel 0 and a bass on channel 1 (both P1 / P6)
function editor(): MidiEditor {
  const bytes = writeMidi({
    header: { format: 1, numTracks: 3, ticksPerBeat: 480 },
    tracks: [
      [{ deltaTime: 0, meta: true, type: 'setTempo', microsecondsPerBeat: 500000 }, end()],
      [{ deltaTime: 0, type: 'programChange', channel: 0, programNumber: 1 }, on(960, 0, 72), off(480, 0, 72), on(0, 0, 74), off(480, 0, 74), end()],
      [{ deltaTime: 0, type: 'programChange', channel: 1, programNumber: 6 }, { deltaTime: 0, type: 'controller', channel: 1, controllerType: 7, value: 100 },
        on(960, 1, 40), off(960, 1, 40), end()],
    ],
  });
  return new MidiEditor(readMidi(bytes));
}
const byNote = (ed: MidiEditor, note: number) => ed.notes.filter((n) => n.note === note);

describe('MidiEditor', () => {
  it('moves notes to a free channel, which starts on program 0, and undoes it back to clean', () => {
    const ed = editor();
    ed.select(byNote(ed, 72));
    expect(ed.moveTo(4)).toBe(true);
    expect(ed.channels()).toEqual([0, 1, 4]);
    expect(ed.programOf(4)).toBe(0);
    expect(ed.dirty).toBe(true);
    ed.undo();
    expect(ed.dirty).toBe(false);
    expect(byNote(ed, 72)[0].channel).toBe(0);
    ed.redo();
    expect(byNote(ed, 72)[0].channel).toBe(4);
    expect(ed.dirty).toBe(true);
  });

  it('keeps a channel on what it plays when notes land on it', () => {
    const ed = editor();
    ed.select(byNote(ed, 72));
    expect(ed.moveTo(1)).toBe(false);
    expect(ed.programOf(1)).toBe(6);
  });

  it('writes the instrument chosen for a channel', () => {
    const ed = editor();
    ed.setProgram(1, 21);
    const pcs = parseMidi(ed.bytes()).tracks.flat().filter((e) => e.type === 'programChange');
    expect(pcs.map((e) => [(e as { channel: number }).channel, (e as { programNumber: number }).programNumber])).toEqual([[0, 1], [1, 21]]);
  });

  it('deletes a channel with its controllers and program changes', () => {
    const ed = editor();
    expect(ed.deleteChannel(1)).toBe(1);
    expect(ed.channels()).toEqual([0]);
    const types = parseMidi(ed.bytes()).tracks[2].map((e) => e.type);
    expect(types).toEqual(['endOfTrack']);
  });

  it('gives a pencil note on a new channel a track of its own', () => {
    const ed = editor();
    const { note, created } = ed.addNote(7, 60, 480, 240);
    expect(created).toBe(true);
    expect(note.track).toBe(3);
    const out = parseMidi(ed.bytes());
    expect(out.header.numTracks).toBe(4);
    expect(out.tracks[3].map((e) => e.type)).toEqual(['programChange', 'noteOn', 'noteOff', 'endOfTrack']);
  });

  it('duplicates right after the selection, on the grid', () => {
    const ed = editor();
    ed.select(byNote(ed, 72));
    ed.duplicate(480);
    expect(byNote(ed, 72).map((n) => n.tick)).toEqual([960, 1440]);
    // the copy is what is selected now
    expect(ed.selected().map((n) => n.tick)).toEqual([1440]);
  });

  it('pastes at the playhead', () => {
    const ed = editor();
    ed.select([...byNote(ed, 72), ...byNote(ed, 74)]);
    ed.copy();
    ed.paste(3000);
    expect(ed.selected().map((n) => [n.note, n.tick])).toEqual([[72, 3000], [74, 3480]]);
  });

  it('trims the silence before the first note, the whole file with it', () => {
    const ed = editor();
    expect(ed.trimLeading()).toBe(960);
    expect(byNote(ed, 72)[0].tick).toBe(0);
    expect(byNote(ed, 40)[0].tick).toBe(0);
    // the settings made during the silence still apply
    const t2 = parseMidi(ed.bytes()).tracks[2];
    expect(t2.slice(0, 3).map((e) => [e.type, e.deltaTime])).toEqual([['programChange', 0], ['controller', 0], ['noteOn', 0]]);
  });

  it('cuts the passage chosen on the ruler', () => {
    const ed = editor();
    ed.range = { a: 1440, b: 1920 };
    expect(ed.cutPassage()).toBe(1);
    expect(ed.notes.map((n) => [n.note, n.tick, n.dur]).sort((a, b) => a[0] - b[0])).toEqual([[40, 960, 480], [72, 960, 480]]);
    expect(ed.range).toBeNull();
  });

  it('tells the save dialog what changed', () => {
    const ed = editor();
    ed.select(byNote(ed, 40));
    ed.deleteSelected();
    ed.setProgram(0, 2);
    const c = ed.changesSinceSave();
    expect(c.before).toEqual({ 0: 2, 1: 1 });
    expect(c.after).toEqual({ 0: 2 });
    expect([c.programsBefore[0], c.programsAfter[0]]).toEqual([1, 2]);
    ed.markSaved();
    expect(ed.dirty).toBe(false);
    expect(ed.changesSinceSave().before).toEqual({ 0: 2 });
  });

  it('warns once of the instrument changes a save replaces, and again when the file gets them back', () => {
    const ed = new MidiEditor(readMidi(writeMidi({
      header: { format: 0, numTracks: 1, ticksPerBeat: 480 },
      tracks: [[{ deltaTime: 0, type: 'programChange', channel: 0, programNumber: 1 }, on(0, 0, 60),
        { deltaTime: 480, type: 'programChange', channel: 0, programNumber: 5 }, off(0, 0, 60), end()]],
    })));
    ed.setProgram(0, 2);
    expect(ed.changesSinceSave().programChangesLost).toEqual({ 0: 1 });
    ed.markSaved();
    ed.setProgram(0, 3);
    expect(ed.changesSinceSave().programChangesLost).toEqual({});
    ed.setProgram(0, 1);
    ed.markSaved();
    ed.setProgram(0, 3);
    expect(ed.changesSinceSave().programChangesLost).toEqual({ 0: 1 });
  });
});

describe('selection criteria', () => {
  const n = (tick: number, note: number, dur = 240, channel = 0): EdNote => ({ id: tick * 1000 + note, channel, note, tick, dur, velocity: 100, track: 0 });

  it('takes the top of each chord, or the rest', () => {
    const notes = [n(0, 60), n(3, 64), n(0, 67), n(480, 62)];
    expect(chordTops(notes, 10).map((x) => x.note)).toEqual([67, 62]);
    expect(chordRest(notes, 10).map((x) => x.note)).toEqual([64, 60]);
  });

  it('picks the notes beyond the voices, the lower ones of a chord first', () => {
    const notes = [n(0, 60, 960), n(0, 64, 960), n(0, 67, 960), n(480, 72, 240), n(960, 48)];
    expect(beyondVoices(notes, 2).map((x) => x.note)).toEqual([60, 72]);
  });

  it('measures a note\'s length in ms, through the tempo', () => {
    const map = tempoMap([{ tick: 0, us: 1000000 }], 480);
    expect(shorterThan([n(0, 60, 24), n(0, 62, 48)], 75, map).map((x) => x.note)).toEqual([60]);
  });

  it('finds the other notes on the same keys', () => {
    const notes = [n(0, 60), n(480, 60), n(480, 60, 240, 1), n(960, 62)];
    expect(sameKeys(notes, [notes[0]]).length).toBe(2);
  });
});
