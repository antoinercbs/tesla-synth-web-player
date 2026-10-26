/**
 * Lightweight analysis of a parsed MIDI file (the jasmid SmfParser output):
 * extracts timed notes, the first instrument (program) per channel, the pitch
 * range and the total duration. Times are absolute milliseconds, computed by
 * walking every track's delta-times and integrating the tempo map.
 *
 * It consumes the structure jasmid produces (header.ticksPerBeat + tracks of
 * channel/meta events), so no second byte-level parser is needed.
 */
import { MidTempo } from "./tempo";

interface ParsedEvent {
  deltaTime: number;
  type?: string;
  subtype?: string;
  channel?: number;
  noteNumber?: number;
  velocity?: number;
  programNumber?: number;
  controllerType?: number;
  value?: number;
  microsecondsPerBeat?: number;
  numerator?: number;
}
interface ParsedMidi {
  header?: { ticksPerBeat?: number };
  tracks?: ParsedEvent[][];
}

export interface MidiNote {
  channel: number;
  note: number;
  startMs: number;
  endMs: number;
  /** MIDI note-on velocity (0..127). The Syntherrupter scales coil ontime
   *  linearly with this (ontime ∝ velocity/127), so it drives output power. */
  velocity: number;
  /** Channel volume (CC7) × expression (CC11) as the note starts, 0..1: the
   *  firmware scales the ontime by both, like the velocity. */
  volume: number;
}
/** A channel volume (CC7) or expression (CC11) change. */
export interface VolumeEvent {
  channel: number;
  atMs: number;
  controller: 7 | 11;
  value: number;
}
export interface MidiAnalysis {
  durationMs: number;
  notes: MidiNote[];
  /** channels that carry at least one note, ascending */
  channels: number[];
  /** first program (envelope/instrument) seen per channel */
  programByChannel: Record<number, number>;
  /** every program the file selects, mid-song changes included, ascending */
  programs: number[];
  /** the file's pan changes (CC10, 0..127), in time order */
  panEvents: { channel: number; atMs: number; value: number }[];
  /** the file's channel volume (CC7) and expression (CC11) changes, in time order */
  volumeEvents: VolumeEvent[];
  /** time of every beat up to the end, following the tempo changes */
  beats: number[];
  /** beats in a bar (the first time signature; 4 without one) */
  beatsPerBar: number;
  /** lowest / highest note number across all notes (0..127) */
  pitchRange: { min: number; max: number };
}

/**
 * A parsed MIDI file (the jasmid SmfParser output), read for what the app shows and
 * computes. It consumes the structure jasmid produces (header.ticksPerBeat + tracks of
 * channel/meta events), so no second byte-level parser is needed.
 */
export class MidFile {
  constructor(readonly parsed: unknown) {}

  /** Lowest and highest note on the channels of `channelMask`, null when they play none. */
  static noteRange(notes: readonly MidiNote[], channelMask: number): { min: number; max: number } | null {
    let min = Infinity;
    let max = -Infinity;
    for (const n of notes) {
      if (!(channelMask & (1 << n.channel))) continue;
      if (n.note < min) min = n.note;
      if (n.note > max) max = n.note;
    }
    return min <= max ? { min, max } : null;
  }

  /** Its notes, programs, pan and volume changes, beats and range. */
  analysis(): MidiAnalysis {
    const midi = (this.parsed ?? {}) as ParsedMidi;
    const ticksPerBeat = midi.header?.ticksPerBeat || 480;
    const tracks = midi.tracks ?? [];

    // 1. stamp every event with its absolute tick (per-track delta accumulation)
    const all: (ParsedEvent & { tick: number })[] = [];
    for (const track of tracks) {
      let tick = 0;
      for (const ev of track) {
        tick += ev.deltaTime ?? 0;
        all.push({ ...ev, tick });
      }
    }
    all.sort((a, b) => a.tick - b.tick); // stable: keeps intra-track order on ties

    // 2. tempo map → tick→ms
    const tempos = all
      .filter(
        (e) =>
          e.subtype === "setTempo" && typeof e.microsecondsPerBeat === "number",
      )
      .map((e) => ({ tick: e.tick, us: e.microsecondsPerBeat as number }));
    const tempo = new MidTempo(tempos, ticksPerBeat);
    const t2ms = (tick: number): number => tempo.toMs(tick);

    // 3. walk events: pair note-on/off, capture first program per channel
    const notes: MidiNote[] = [];
    const active = new Map<string, { tick: number; velocity: number; volume: number }>(); // "ch:note" -> start
    const programByChannel: Record<number, number> = {};
    const programs = new Set<number>();
    const panEvents: MidiAnalysis["panEvents"] = [];
    const volumeEvents: VolumeEvent[] = [];
    // switching the MIDI mode on resets both to 127 on the board, and a song always does
    const cc7 = new Array<number>(16).fill(127);
    const cc11 = new Array<number>(16).fill(127);
    let maxTick = 0;

    for (const e of all) {
      maxTick = Math.max(maxTick, e.tick);
      if (e.type !== "channel" || e.channel == null) continue;
      if (e.subtype === "noteOn" && e.noteNumber != null) {
        active.set(`${e.channel}:${e.noteNumber}`, {
          tick: e.tick,
          velocity: e.velocity ?? 127,
          volume: (cc7[e.channel] / 127) * (cc11[e.channel] / 127),
        });
      } else if (e.subtype === "noteOff" && e.noteNumber != null) {
        const key = `${e.channel}:${e.noteNumber}`;
        const start = active.get(key);
        if (start != null) {
          notes.push({
            channel: e.channel,
            note: e.noteNumber,
            startMs: t2ms(start.tick),
            endMs: t2ms(e.tick),
            velocity: start.velocity,
            volume: start.volume,
          });
          active.delete(key);
        }
      } else if (e.subtype === "programChange" && e.programNumber != null) {
        programs.add(e.programNumber);
        if (!(e.channel in programByChannel))
          programByChannel[e.channel] = e.programNumber;
      } else if (e.subtype === "controller" && e.controllerType === 10 && e.value != null) {
        panEvents.push({ channel: e.channel, atMs: t2ms(e.tick), value: e.value });
      } else if (e.subtype === "controller" && (e.controllerType === 7 || e.controllerType === 11) && e.value != null) {
        (e.controllerType === 7 ? cc7 : cc11)[e.channel] = e.value;
        volumeEvents.push({ channel: e.channel, atMs: t2ms(e.tick), controller: e.controllerType, value: e.value });
      } else if (e.subtype === "controller" && e.controllerType === 121) {
        cc7[e.channel] = 127;
        cc11[e.channel] = 127;
        volumeEvents.push({ channel: e.channel, atMs: t2ms(e.tick), controller: 7, value: 127 });
        volumeEvents.push({ channel: e.channel, atMs: t2ms(e.tick), controller: 11, value: 127 });
      }
    }
    // close any notes left hanging at the end of the file
    for (const [key, start] of active) {
      const [ch, note] = key.split(":").map(Number);
      notes.push({
        channel: ch,
        note,
        startMs: t2ms(start.tick),
        endMs: t2ms(maxTick),
        velocity: start.velocity,
        volume: start.volume,
      });
    }

    const channels = [...new Set(notes.map((n) => n.channel))].sort(
      (a, b) => a - b,
    );
    const pitches = notes.map((n) => n.note);
    // Song length = the last note's end. NOT t2ms(maxTick): some files pad the
    // track with a huge trailing gap (e.g. 2^28 ticks) long after the music stops.
    const durationMs = notes.length
      ? notes.reduce((m, n) => Math.max(m, n.endMs), 0)
      : t2ms(maxTick);

    const beats: number[] = [];
    for (let tick = 0; beats.length < 20000; tick += ticksPerBeat) {
      const ms = t2ms(tick);
      if (ms > durationMs) break;
      beats.push(ms);
    }
    const signature = all.find((e) => e.subtype === "timeSignature" && (e.numerator ?? 0) > 0);

    return {
      durationMs,
      notes,
      channels,
      programByChannel,
      programs: [...programs].sort((a, b) => a - b),
      panEvents,
      volumeEvents,
      beats,
      beatsPerBar: signature?.numerator ?? 4,
      pitchRange: {
        min: pitches.length ? Math.min(...pitches) : 0,
        max: pitches.length ? Math.max(...pitches) : 127,
      },
    };
  }
}
