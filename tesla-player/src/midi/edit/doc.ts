import { parseMidi, writeMidi, type MidiEvent } from 'midi-file';
import { tempoMap, type TempoMap } from '@/midi/tempo';

/**
 * A MIDI file as the editor holds it: notes paired from their on/off, every other
 * event kept as read at its absolute tick. Times are ticks, not ms, so an edit
 * never drifts off the file's own grid.
 */
export interface EdNote {
  id: number;
  channel: number;
  note: number;
  tick: number;
  /** ≥ 1 tick: a note-off on its own note-on's tick would be written before it */
  dur: number;
  velocity: number;
  track: number;
}

export interface EdEvent {
  track: number;
  tick: number;
  /** position in the file: same-tick events keep their order */
  seq: number;
  ev: MidiEvent;
}

export interface MidiDoc {
  format: 0 | 1 | 2;
  ticksPerBeat: number;
  trackCount: number;
  notes: EdNote[];
  events: EdEvent[];
  /** the first instrument of each channel, as read */
  readPrograms: Record<number, number>;
  /** the one each channel starts on when written: a channel whose value differs
   *  from readPrograms gets its program changes replaced by this one */
  programs: Record<number, number>;
}

export interface Timeline {
  notes: EdNote[];
  events: EdEvent[];
}

/** SMPTE time division: frames, not beats, so nothing to lay a grid on. */
export class UnsupportedMidiError extends Error {}

let lastId = 0;
export const newNoteId = (): number => ++lastId;

const CHANNEL_EVENTS = new Set(['noteAftertouch', 'controller', 'programChange', 'channelAftertouch', 'pitchBend']);

/** The channel of a channel-voice event (meta events such as channelPrefix carry one too, they don't count). */
export function eventChannel(ev: MidiEvent): number | null {
  return CHANNEL_EVENTS.has(ev.type) ? (ev as { channel: number }).channel : null;
}

export function readMidi(bytes: ArrayLike<number>): MidiDoc {
  const data = parseMidi(bytes);
  const ticksPerBeat = data.header.ticksPerBeat;
  if (!ticksPerBeat) throw new UnsupportedMidiError('SMPTE time division');

  const all: EdEvent[] = [];
  let seq = 0;
  data.tracks.forEach((track, t) => {
    let tick = 0;
    for (const ev of track) {
      tick += ev.deltaTime;
      all.push({ track: t, tick, seq: seq++, ev });
    }
  });
  // pairing follows what a device hears: the tracks merged in time
  all.sort((a, b) => a.tick - b.tick || a.seq - b.seq);

  const notes: EdNote[] = [];
  const events: EdEvent[] = [];
  const held = new Map<number, EdNote>();
  for (const e of all) {
    const ev = e.ev;
    if (ev.type !== 'noteOn' && ev.type !== 'noteOff') {
      events.push(e);
      continue;
    }
    const key = ev.channel * 128 + ev.noteNumber;
    const prev = held.get(key);
    // struck again while held: the first one stops there, as the retrigger does on the device
    if (prev) {
      prev.dur = Math.max(1, e.tick - prev.tick);
      held.delete(key);
    }
    // midi-file already reads a velocity-0 note-on as a note-off
    if (ev.type === 'noteOn') {
      const n: EdNote = { id: newNoteId(), channel: ev.channel, note: ev.noteNumber, tick: e.tick, dur: 1, velocity: ev.velocity, track: e.track };
      notes.push(n);
      held.set(key, n);
    }
  }
  const last = all.length ? all[all.length - 1].tick : 0;
  for (const n of held.values()) n.dur = Math.max(1, last - n.tick);

  const readPrograms: Record<number, number> = {};
  for (const { ev } of events) {
    if (ev.type === 'programChange' && !(ev.channel in readPrograms)) readPrograms[ev.channel] = ev.programNumber;
  }
  return {
    format: data.header.format,
    ticksPerBeat,
    trackCount: data.tracks.length,
    notes,
    events,
    readPrograms,
    programs: { ...readPrograms },
  };
}

/** The track a channel's new events belong in: where its notes are, or its other events; -1 if none. */
export function hostTrack(doc: MidiDoc, channel: number): number {
  const n = doc.notes.find((x) => x.channel === channel);
  if (n) return n.track;
  const e = doc.events.find((x) => eventChannel(x.ev) === channel);
  return e ? e.track : -1;
}

/**
 * The same key held twice at once on a channel is ambiguous in a file (which
 * note-off ends which?): the earlier note stops where the next one starts, and of
 * two starting together the longer stays.
 */
export function resolveOverlaps(notes: EdNote[]): EdNote[] {
  const sorted = [...notes].sort((a, b) => a.channel - b.channel || a.note - b.note || a.tick - b.tick || b.dur - a.dur);
  const out: EdNote[] = [];
  let prev: EdNote | null = null;
  for (const n of sorted) {
    if (prev && prev.channel === n.channel && prev.note === n.note) {
      if (n.tick === prev.tick) continue;
      if (prev.tick + prev.dur > n.tick) out[out.length - 1] = { ...prev, dur: n.tick - prev.tick };
    }
    out.push(n);
    prev = n;
  }
  return out;
}

export function writeDoc(doc: MidiDoc): Uint8Array<ArrayBuffer> {
  const notes = resolveOverlaps(doc.notes);
  // a channel whose instrument was chosen here starts on it, and keeps it: its
  // program changes are replaced by one at the start (a channel without notes gets none)
  const hosts = new Map<number, number>();
  for (const key of Object.keys(doc.programs)) {
    const ch = Number(key);
    if (doc.programs[ch] === doc.readPrograms[ch]) continue;
    const host = notes.find((n) => n.channel === ch)?.track ?? -1;
    if (host >= 0) hosts.set(ch, host);
  }

  interface Out { tick: number; rank: number; seq: number; ev: MidiEvent }
  const tracks: Out[][] = Array.from({ length: doc.trackCount }, () => []);
  const ends: number[] = new Array(doc.trackCount).fill(0);
  for (const e of doc.events) {
    if (e.ev.type === 'endOfTrack') {
      ends[e.track] = Math.max(ends[e.track], e.tick);
      continue;
    }
    if (e.ev.type === 'programChange' && hosts.has(e.ev.channel)) continue;
    tracks[e.track].push({ tick: e.tick, rank: 1, seq: e.seq, ev: e.ev });
  }
  for (const [channel, t] of hosts) {
    tracks[t].push({ tick: 0, rank: 1, seq: -1, ev: { deltaTime: 0, type: 'programChange', channel, programNumber: doc.programs[channel] } });
  }
  // at one tick: the notes that end, then the settings, then the notes that start
  notes.forEach((n, i) => {
    tracks[n.track].push({ tick: n.tick, rank: 2, seq: i, ev: { deltaTime: 0, type: 'noteOn', channel: n.channel, noteNumber: n.note, velocity: n.velocity } });
    tracks[n.track].push({ tick: n.tick + n.dur, rank: 0, seq: i, ev: { deltaTime: 0, type: 'noteOff', channel: n.channel, noteNumber: n.note, velocity: 0 } });
  });

  const out = tracks.map((list, t) => {
    list.sort((a, b) => a.tick - b.tick || a.rank - b.rank || a.seq - b.seq);
    let prev = 0;
    const track: MidiEvent[] = list.map((o) => {
      const ev = { ...o.ev, deltaTime: o.tick - prev };
      prev = o.tick;
      return ev;
    });
    const end = Math.max(prev, ends[t]);
    track.push({ deltaTime: end - prev, meta: true, type: 'endOfTrack' });
    return track;
  });
  const bytes = writeMidi(
    { header: { format: doc.format, numTracks: out.length, ticksPerBeat: doc.ticksPerBeat }, tracks: out },
    { running: true, useByte9ForNoteOff: true },
  );
  return Uint8Array.from(bytes);
}

export function docTempo(doc: MidiDoc): TempoMap {
  const tempos = doc.events
    .filter((e) => e.ev.type === 'setTempo')
    .map((e) => ({ tick: e.tick, us: (e.ev as { microsecondsPerBeat: number }).microsecondsPerBeat }));
  return tempoMap(tempos, doc.ticksPerBeat);
}

/** Beats in a bar: the first time signature's (4 without one), as the player's analysis reads it. */
export function docBeatsPerBar(doc: MidiDoc): number {
  const sig = doc.events.find((e) => e.ev.type === 'timeSignature');
  const n = sig ? (sig.ev as { numerator: number }).numerator : 0;
  return n > 0 ? n : 4;
}

/**
 * Takes [a, b) out and closes the gap: what starts in it goes, a note crossing
 * `a` stops there. The settings changed inside it (tempo, programs, controllers)
 * still hold after it, so they land on its edge.
 */
export function cutRange(tl: Timeline, a: number, b: number): Timeline {
  const len = b - a;
  const notes: EdNote[] = [];
  for (const n of tl.notes) {
    if (n.tick >= b) notes.push({ ...n, tick: n.tick - len });
    else if (n.tick < a) notes.push(n.tick + n.dur > a ? { ...n, dur: a - n.tick } : n);
  }
  const events = tl.events.map((e) => (e.tick < a ? e : { ...e, tick: e.tick >= b ? e.tick - len : a }));
  return { notes, events };
}

/** Keeps [a, b) alone, moved to the start; the settings made before it still apply from its first tick. */
export function keepRange(tl: Timeline, a: number, b: number): Timeline {
  const notes = tl.notes
    .filter((n) => n.tick >= a && n.tick < b)
    .map((n) => ({ ...n, tick: n.tick - a, dur: Math.min(n.dur, b - n.tick) }));
  const events = tl.events.filter((e) => e.tick < b).map((e) => ({ ...e, tick: Math.max(0, e.tick - a) }));
  return { notes, events };
}

/** The silence before the first note, in whole beats so the notes stay on the grid. */
export function leadingSilence(doc: MidiDoc): number {
  if (!doc.notes.length) return 0;
  const first = doc.notes.reduce((m, n) => Math.min(m, n.tick), Infinity);
  return Math.floor(first / doc.ticksPerBeat) * doc.ticksPerBeat;
}
