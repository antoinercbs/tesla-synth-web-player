import { createHash } from 'crypto';

/**
 * Canonical content hashing for sync. A SINGLE source of truth used by both the
 * services (computed on every write) and the AddSyncColumns migration (backfill)
 * so the two peers can never disagree on what "the same content" means.
 *
 * Rules that make a hash stable across machines:
 *  - children are SORTED into a canonical order (the services do delete-then-
 *    reinsert, so row order / autoincrement ids are meaningless);
 *  - cross-entity references use the partner's stable `uuid`, never its local id
 *    or on-disk path (both differ per machine);
 *  - floats are rounded to a fixed precision so JSON of doubles matches.
 */

export interface CoilHashInput {
  coilIndex: number;
  channelMask: number;
  ontimeUs: number;
  duty: number;
}

export interface CoilEventHashInput {
  coilIndex: number;
  atMs: number;
  param: string;
  value: number;
}

export interface SongHashInput {
  name: string | null;
  coilCount: number;
  mode: string;
  output2Mask: number;
  /** uuid of the referenced MIDI file, NOT its id/path. */
  midiFileUuid: string | null;
  coils: CoilHashInput[];
  events: CoilEventHashInput[];
}

export interface PlaylistHashInput {
  name: string | null;
  coilCount: number;
  /** RESOLVED song uuids in playlist order. Unresolved members are dropped by
   *  every caller before hashing, so the hash never carries null slots. */
  songUuids: string[];
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Round-trip a float through fixed precision to neutralize tiny FP noise. */
function num(n: number): number {
  return Number.isFinite(n) ? Number(n.toFixed(6)) : 0;
}

export function hashSong(input: SongHashInput): string {
  const canonical = {
    name: input.name ?? '',
    coilCount: input.coilCount,
    mode: input.mode,
    output2Mask: input.output2Mask,
    midiFileUuid: input.midiFileUuid ?? null,
    coils: [...input.coils]
      .sort((a, b) => a.coilIndex - b.coilIndex)
      .map((c) => ({
        coilIndex: c.coilIndex,
        channelMask: c.channelMask,
        ontimeUs: c.ontimeUs,
        duty: num(c.duty),
      })),
    events: [...input.events]
      .sort(
        (a, b) =>
          a.coilIndex - b.coilIndex ||
          a.atMs - b.atMs ||
          a.param.localeCompare(b.param),
      )
      .map((e) => ({
        coilIndex: e.coilIndex,
        atMs: e.atMs,
        param: e.param,
        value: num(e.value),
      })),
  };
  return sha256(JSON.stringify(canonical));
}

export function hashPlaylist(input: PlaylistHashInput): string {
  const canonical = {
    name: input.name ?? '',
    coilCount: input.coilCount,
    songUuids: input.songUuids,
  };
  return sha256(JSON.stringify(canonical));
}

/** Identity of a MIDI file = sha256 of its raw bytes (path/name excluded). */
export function hashBytes(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
