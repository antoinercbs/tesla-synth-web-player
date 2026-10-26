/**
 * A song's spatialisation ("stereo" on the Syntherrupter): each coil has a
 * place from left (0) to right (1) and a reach, and each channel decides where
 * its notes sit. Channels absent from `channels` follow the file's own pan (CC10).
 * Stored as JSON on the Song; null = off (every coil plays everything it is
 * assigned, as before the feature).
 */
export type StereoBlend = 'fade' | 'single';
export type PanFollow = 'each' | 'lowest' | 'highest' | 'loudest';
export type ChannelPlacement =
  | { source: 'omni' }
  | { source: 'pitch'; follow: PanFollow; noteLow: number; noteHigh: number; lowOn: 'left' | 'right' };

export interface SongStereo {
  blend: StereoBlend;
  /** Index = coil index. */
  coils: { position: number; reach: number }[];
  channels: Record<string, ChannelPlacement>;
}

const MAX_COILS = 6;
/** The firmware divides by the reach (MIDI::setPanReach): never send 0. */
export const MIN_REACH = 0.01;
// no "average": the firmware's NOTE_PAN_AVG reads a note past the end of its list
const FOLLOWS: readonly PanFollow[] = ['each', 'lowest', 'highest', 'loudest'];

const unit = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
const noteNumber = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(127, Math.max(0, Math.round(v))) : fallback;

/** Whatever the client or a peer sent, as a well-formed value (or null = off). */
export function sanitizeStereo(raw: unknown): SongStereo | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const coils = (Array.isArray(r.coils) ? r.coils : []).slice(0, MAX_COILS).map((c: unknown) => {
    const k = (c ?? {}) as Record<string, unknown>;
    return { position: unit(k.position, 0.5), reach: Math.max(MIN_REACH, unit(k.reach, 0.5)) };
  });
  const channels: Record<string, ChannelPlacement> = {};
  if (r.channels && typeof r.channels === 'object' && !Array.isArray(r.channels)) {
    for (const [key, value] of Object.entries(r.channels as Record<string, unknown>)) {
      const ch = Number(key);
      if (!Number.isInteger(ch) || ch < 0 || ch > 15 || !value || typeof value !== 'object') continue;
      const p = value as Record<string, unknown>;
      if (p.source === 'omni') {
        channels[ch] = { source: 'omni' };
      } else if (p.source === 'pitch') {
        const a = noteNumber(p.noteLow, 0);
        const b = noteNumber(p.noteHigh, 127);
        channels[ch] = {
          source: 'pitch',
          follow: FOLLOWS.includes(p.follow as PanFollow) ? (p.follow as PanFollow) : 'each',
          noteLow: Math.min(a, b),
          noteHigh: Math.max(a, b),
          lowOn: p.lowOn === 'right' ? 'right' : 'left',
        };
      }
    }
  }
  return { blend: r.blend === 'single' ? 'single' : 'fade', coils, channels };
}
