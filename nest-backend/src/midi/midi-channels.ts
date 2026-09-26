import { parseMidi } from 'midi-file';

/**
 * How many MIDI channels actually carry notes. Mirrors the front-end
 * `analyzeMidi` channel list (note-bearing channels only, not every channel that
 * happens to send a control change or a program change) so the count shown in
 * the library matches the channels the editor offers.
 *
 * Returns null if the buffer cannot be parsed as a MIDI file.
 */
export function computeChannels(buffer: Buffer): number | null {
  let midi: ReturnType<typeof parseMidi>;
  try {
    midi = parseMidi(buffer);
  } catch {
    return null;
  }

  const channels = new Set<number>();
  for (const track of midi.tracks ?? []) {
    for (const ev of track) {
      if (ev.type === 'noteOn' && ev.velocity > 0) channels.add(ev.channel);
    }
  }
  return channels.size;
}

/**
 * The instrument (program) each note-bearing channel starts with: its first
 * Program Change in time, 0 when it has none. Mirrors the front-end
 * `analyzeMidi().programByChannel`, defaulted to 0 like the instruments editor.
 * Keys are channel numbers. Null if the buffer cannot be parsed as a MIDI file.
 */
export function computePrograms(buffer: Buffer): Record<number, number> | null {
  let midi: ReturnType<typeof parseMidi>;
  try {
    midi = parseMidi(buffer);
  } catch {
    return null;
  }

  const noteChannels = new Set<number>();
  const first = new Map<number, { tick: number; program: number }>();
  for (const track of midi.tracks ?? []) {
    let tick = 0;
    for (const ev of track) {
      tick += ev.deltaTime;
      if (ev.type === 'noteOn' && ev.velocity > 0) noteChannels.add(ev.channel);
      else if (ev.type === 'programChange') {
        const seen = first.get(ev.channel);
        // strict: on a tie the earlier track wins, as in the front's stable sort
        if (!seen || tick < seen.tick) first.set(ev.channel, { tick, program: ev.programNumber });
      }
    }
  }
  const out: Record<number, number> = {};
  for (const ch of [...noteChannels].sort((a, b) => a - b)) out[ch] = first.get(ch)?.program ?? 0;
  return out;
}
