import type { Song } from '@/types/domain';

/**
 * Format a millisecond duration as `m:ss` (or `h:mm:ss` past an hour). Returns
 * `–` when the duration is unknown (null/undefined/invalid).
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '–';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Sum the known play lengths (ms) of a list of songs; unknown durations count as 0. */
export function totalDurationMs(songs: Song[]): number {
  return songs.reduce((sum, s) => sum + (s.midiFile?.durationMs ?? 0), 0);
}

/** Does at least one song lack a known duration? (so totals can be flagged "~"). */
export function hasUnknownDuration(songs: Song[]): boolean {
  return songs.some((s) => s.midiFile?.durationMs == null);
}
