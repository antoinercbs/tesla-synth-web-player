import { parseMidi, writeMidi } from 'midi-file';

/** One channel's chosen instrument (MIDI program). */
export interface ProgramSetting {
  channel: number; // 0..15
  program: number; // 0..127
}

type MidiEvent = ReturnType<typeof parseMidi>['tracks'][number][number];
interface Abs {
  tick: number;
  ev: MidiEvent;
}

/** Channel of a channel-scoped event, or -1 for meta/sysex events. */
function channelOf(ev: MidiEvent): number {
  return typeof (ev as { channel?: number }).channel === 'number'
    ? (ev as { channel: number }).channel
    : -1;
}

/**
 * Rewrite a Standard MIDI File so that each listed channel plays a single chosen
 * instrument from the very start: every existing Program Change on that channel
 * is removed and ONE Program Change (program) is inserted at tick 0 of the track
 * that carries that channel's notes. Other channels and all timing are untouched.
 *
 * This is a deliberate "one instrument per channel" model (matching how the app
 * reads a file: first program per channel) — mid-song program switches on an
 * edited channel are intentionally collapsed.
 *
 * Returns the original buffer unchanged if there is nothing valid to apply.
 */
export function setMidiPrograms(buffer: Buffer, programs: ProgramSetting[]): Buffer {
  const targets = new Map<number, number>(); // channel -> program
  for (const p of programs) {
    if (
      Number.isInteger(p.channel) && p.channel >= 0 && p.channel <= 15 &&
      Number.isInteger(p.program) && p.program >= 0 && p.program <= 127
    ) {
      targets.set(p.channel, p.program);
    }
  }
  if (targets.size === 0) return buffer;

  const midi = parseMidi(buffer);

  // absolute-tick view of every track
  const absTracks: Abs[][] = midi.tracks.map((track) => {
    let tick = 0;
    return track.map((ev) => {
      tick += ev.deltaTime;
      return { tick, ev };
    });
  });

  // Host track for a channel = the track holding its first note (where the new
  // Program Change is prepended); fall back to any track using it, then track 0.
  const hostTrackFor = (channel: number): number => {
    let anyTrack = -1;
    for (let t = 0; t < absTracks.length; t++) {
      for (const { ev } of absTracks[t]) {
        if (channelOf(ev) !== channel) continue;
        if (ev.type === 'noteOn') return t;
        if (anyTrack < 0) anyTrack = t;
      }
    }
    return anyTrack >= 0 ? anyTrack : 0;
  };
  const host = new Map<number, number>();
  for (const ch of targets.keys()) host.set(ch, hostTrackFor(ch));

  midi.tracks = absTracks.map((entries, t) => {
    // drop existing Program Changes on the edited channels
    const kept = entries.filter(
      ({ ev }) => !(ev.type === 'programChange' && targets.has(channelOf(ev))),
    );
    // prepend the new Program Change(s) this track hosts, at tick 0
    const inserted: Abs[] = [];
    for (const [channel, program] of targets) {
      if (host.get(channel) === t) {
        inserted.push({ tick: 0, ev: { deltaTime: 0, type: 'programChange', channel, programNumber: program } });
      }
    }
    // inserted first so the stable sort keeps them before any existing tick-0 events
    const merged = [...inserted, ...kept];
    merged.sort((a, b) => a.tick - b.tick); // V8 sort is stable
    // re-derive delta times from the absolute ticks
    let prev = 0;
    return merged.map(({ tick, ev }) => {
      const out = { ...ev, deltaTime: tick - prev };
      prev = tick;
      return out;
    });
  });

  return Buffer.from(writeMidi(midi));
}
