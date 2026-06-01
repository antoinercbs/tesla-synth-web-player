/**
 * Lightweight analysis of a parsed MIDI file (the jasmid SmfParser output):
 * extracts timed notes, the first instrument (program) per channel, the pitch
 * range and the total duration. Times are absolute milliseconds, computed by
 * walking every track's delta-times and integrating the tempo map.
 *
 * It consumes the structure jasmid produces (header.ticksPerBeat + tracks of
 * channel/meta events), so no second byte-level parser is needed.
 */

interface ParsedEvent {
  deltaTime: number;
  type?: string;
  subtype?: string;
  channel?: number;
  noteNumber?: number;
  velocity?: number;
  programNumber?: number;
  microsecondsPerBeat?: number;
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
}
export interface MidiAnalysis {
  durationMs: number;
  notes: MidiNote[];
  /** channels that carry at least one note, ascending */
  channels: number[];
  /** first program (envelope/instrument) seen per channel */
  programByChannel: Record<number, number>;
  /** lowest / highest note number across all notes (0..127) */
  pitchRange: { min: number; max: number };
}

const DEFAULT_TEMPO = 500000; // µs per beat (120 BPM) until a setTempo appears

/** Build a tick→ms converter from the (tick-stamped) tempo changes. */
function tickToMsFn(
  tempos: { tick: number; us: number }[],
  ticksPerBeat: number,
): (tick: number) => number {
  const points = [...tempos].sort((a, b) => a.tick - b.tick);
  if (points.length === 0 || points[0].tick > 0) points.unshift({ tick: 0, us: DEFAULT_TEMPO });
  // cumulative ms at the start of each tempo segment
  const cum: { tick: number; ms: number; us: number }[] = [];
  let ms = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const dt = points[i].tick - points[i - 1].tick;
      ms += (dt * points[i - 1].us) / ticksPerBeat / 1000;
    }
    cum.push({ tick: points[i].tick, ms, us: points[i].us });
  }
  return (tick: number) => {
    let seg = cum[0];
    for (const c of cum) { if (c.tick <= tick) seg = c; else break; }
    return seg.ms + ((tick - seg.tick) * seg.us) / ticksPerBeat / 1000;
  };
}

export function analyzeMidi(parsed: unknown): MidiAnalysis {
  const midi = (parsed ?? {}) as ParsedMidi;
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
    .filter((e) => e.subtype === 'setTempo' && typeof e.microsecondsPerBeat === 'number')
    .map((e) => ({ tick: e.tick, us: e.microsecondsPerBeat as number }));
  const t2ms = tickToMsFn(tempos, ticksPerBeat);

  // 3. walk events: pair note-on/off, capture first program per channel
  const notes: MidiNote[] = [];
  const active = new Map<string, number>(); // "ch:note" -> start tick
  const programByChannel: Record<number, number> = {};
  let maxTick = 0;

  for (const e of all) {
    maxTick = Math.max(maxTick, e.tick);
    if (e.type !== 'channel' || e.channel == null) continue;
    if (e.subtype === 'noteOn' && e.noteNumber != null) {
      active.set(`${e.channel}:${e.noteNumber}`, e.tick);
    } else if (e.subtype === 'noteOff' && e.noteNumber != null) {
      const key = `${e.channel}:${e.noteNumber}`;
      const start = active.get(key);
      if (start != null) {
        notes.push({ channel: e.channel, note: e.noteNumber, startMs: t2ms(start), endMs: t2ms(e.tick) });
        active.delete(key);
      }
    } else if (e.subtype === 'programChange' && e.programNumber != null) {
      if (!(e.channel in programByChannel)) programByChannel[e.channel] = e.programNumber;
    }
  }
  // close any notes left hanging at the end of the file
  for (const [key, start] of active) {
    const [ch, note] = key.split(':').map(Number);
    notes.push({ channel: ch, note, startMs: t2ms(start), endMs: t2ms(maxTick) });
  }

  const channels = [...new Set(notes.map((n) => n.channel))].sort((a, b) => a - b);
  const pitches = notes.map((n) => n.note);
  // Song length = the last note's end. NOT t2ms(maxTick): some files pad the
  // track with a huge trailing gap (e.g. 2^28 ticks) long after the music stops.
  const durationMs = notes.length
    ? notes.reduce((m, n) => Math.max(m, n.endMs), 0)
    : t2ms(maxTick);

  return {
    durationMs,
    notes,
    channels,
    programByChannel,
    pitchRange: {
      min: pitches.length ? Math.min(...pitches) : 0,
      max: pitches.length ? Math.max(...pitches) : 127,
    },
  };
}
