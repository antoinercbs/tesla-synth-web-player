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
