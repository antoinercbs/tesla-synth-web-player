import { sanitizeStereo, type SongStereo } from './stereo';
import { SONG_WIDE } from './entities/coil-event.entity';

/**
 * A song's other ways to be played, on other coils ("déclinaisons"): each has
 * its places, the coil at each and its settings, its automation and its
 * spatialisation. The MIDI file, the speakers and the mode stay the song's.
 * The song's own coils are its first way; these are the others, in order.
 */
export interface SongVariantCoil {
  coilIndex: number;
  coilUuid: string | null;
  channelMask: number;
  ontimeUs: number;
  duty: number;
}
export interface SongVariantEvent {
  coilIndex: number;
  atMs: number;
  param: 'ontime' | 'duty' | 'power';
  value: number;
  ramp?: boolean;
}
export interface SongVariant {
  /** Stable within the song (a uuid from the front). */
  id: string;
  name: string;
  coilCount: number;
  coils: SongVariantCoil[];
  events: SongVariantEvent[];
  stereo: SongStereo | null;
}

const MAX_VARIANTS = 16;
const MAX_COILS = 6;
const PARAMS = new Set(['ontime', 'duty', 'power']);

const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/**
 * The variants as stored, from whatever a client sent: what doesn't hold is
 * left out (a coil past the variant's count, a bad number, a duplicate id),
 * never refused. None left: null.
 */
export function sanitizeVariants(raw: unknown): SongVariant[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SongVariant[] = [];
  for (const item of raw.slice(0, MAX_VARIANTS)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const v = item as Record<string, unknown>;
    const id = typeof v.id === 'string' ? v.id.trim().slice(0, 64) : '';
    if (!id || out.some((x) => x.id === id)) continue;
    if (!isInt(v.coilCount, 1, MAX_COILS)) continue;
    const coilCount = v.coilCount;
    const coils = new Map<number, SongVariantCoil>();
    for (const c of Array.isArray(v.coils) ? v.coils : []) {
      if (!c || typeof c !== 'object') continue;
      const r = c as Record<string, unknown>;
      if (!isInt(r.coilIndex, 0, coilCount - 1) || !isInt(r.channelMask, 0, 0xffff)) continue;
      if (!isInt(r.ontimeUs, 0, 100_000) || !isNum(r.duty, 0, 1)) continue;
      const uuid = typeof r.coilUuid === 'string' ? r.coilUuid.trim().slice(0, 64) : '';
      coils.set(r.coilIndex, { coilIndex: r.coilIndex, coilUuid: uuid || null, channelMask: r.channelMask, ontimeUs: r.ontimeUs, duty: r.duty });
    }
    const events: SongVariantEvent[] = [];
    for (const e of Array.isArray(v.events) ? v.events : []) {
      if (!e || typeof e !== 'object') continue;
      const r = e as Record<string, unknown>;
      if (!isInt(r.coilIndex, SONG_WIDE, coilCount - 1) || !isInt(r.atMs, 0, Number.MAX_SAFE_INTEGER)) continue;
      if (typeof r.param !== 'string' || !PARAMS.has(r.param) || !isNum(r.value, 0, Number.MAX_VALUE)) continue;
      // a coil point needs a coil, and a song-wide one none
      if ((r.param === 'power') !== (r.coilIndex === SONG_WIDE)) continue;
      events.push({ coilIndex: r.coilIndex, atMs: r.atMs, param: r.param as SongVariantEvent['param'], value: r.value, ...(r.ramp === true ? { ramp: true } : {}) });
    }
    out.push({
      id,
      name: typeof v.name === 'string' ? v.name.trim().slice(0, 80) : '',
      coilCount,
      coils: [...coils.values()].sort((a, b) => a.coilIndex - b.coilIndex),
      events,
      stereo: sanitizeStereo(v.stereo ?? null),
    });
  }
  return out.length ? out : null;
}
