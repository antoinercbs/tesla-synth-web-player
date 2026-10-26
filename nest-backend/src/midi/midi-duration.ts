import { parseMidi } from 'midi-file';

const DEFAULT_TEMPO = 500000; // µs per beat (120 BPM) until a setTempo appears

/**
 * Total play length of a Standard MIDI File, in milliseconds. Mirrors the
 * front-end `analyzeMidi` duration (max absolute tick run through the tempo
 * map) so the value shown in lists matches the player's clock exactly.
 *
 * Returns null if the buffer cannot be parsed as a MIDI file.
 */
export function computeDurationMs(buffer: Buffer): number | null {
  let midi: ReturnType<typeof parseMidi>;
  try {
    midi = parseMidi(buffer);
  } catch {
    return null;
  }

  const ticksPerBeat = midi.header.ticksPerBeat || 480; // SMPTE files fall back to 480
  const tempos: { tick: number; us: number }[] = [];
  let maxTick = 0; // last event of any kind (fallback)
  let lastNoteTick = 0; // last note-on/off — where the music actually ends
  for (const track of midi.tracks) {
    let tick = 0;
    for (const ev of track) {
      tick += ev.deltaTime;
      if (ev.type === 'setTempo') tempos.push({ tick, us: ev.microsecondsPerBeat });
      if (ev.type === 'noteOn' || ev.type === 'noteOff') lastNoteTick = Math.max(lastNoteTick, tick);
    }
    if (tick > maxTick) maxTick = tick;
  }
  // Use the last note event, not the last tick: some files pad the track with a
  // huge trailing gap (e.g. 2^28 ticks) long after the music stops.
  const endTick = lastNoteTick > 0 ? lastNoteTick : maxTick;

  tempos.sort((a, b) => a.tick - b.tick);
  if (tempos.length === 0 || tempos[0].tick > 0) tempos.unshift({ tick: 0, us: DEFAULT_TEMPO });

  // integrate ticks → ms across tempo segments, each segment using its own tempo
  let ms = 0;
  for (let i = 0; i < tempos.length; i++) {
    const segStart = tempos[i].tick;
    if (segStart >= endTick) break;
    const segEnd = i + 1 < tempos.length ? Math.min(tempos[i + 1].tick, endTick) : endTick;
    ms += ((segEnd - segStart) * tempos[i].us) / ticksPerBeat / 1000;
  }
  return Math.round(ms);
}
