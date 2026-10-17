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

const dayOf = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * When something last changed, short: "aujourd’hui 14:32", "hier 09:05", then
 * "12 oct." this year and "12 oct. 2025" before. `–` when unknown.
 */
export function formatEditDate(ms: number | null | undefined, locale: string, now = Date.now()): string {
  if (!ms) return '–';
  const at = new Date(ms);
  const today = new Date(now);
  // rounded: a day around a clock change lasts 23 or 25 hours
  const days = Math.round((dayOf(today) - dayOf(at)) / 86_400_000);
  if (days === 0 || days === 1) {
    const day = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-days, 'day');
    return `${day} ${at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`;
  }
  return at.toLocaleDateString(locale, at.getFullYear() === today.getFullYear()
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A fraction as a percentage to show: one decimal under 10 %, whole numbers above ("8.4", "12"). */
export function pctLabel(fraction: number): string {
  const pct = fraction * 100;
  return String(pct < 10 ? Math.round(pct * 10) / 10 : Math.round(pct));
}
