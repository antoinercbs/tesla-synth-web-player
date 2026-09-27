import { createHash } from 'crypto';
import type { SongStereo } from '../songs/stereo';

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
 *
 * editorName (who last edited, server-stamped from the OIDC token) is folded in
 * ONLY when it is a non-empty string — see `withEditor` below. This is a
 * load-bearing backward-compat invariant: a null/empty editor produces the
 * EXACT same JSON as before this field existed, so auth-off instances and
 * pre-feature rows hash identically and never surface as phantom sync conflicts.
 * Do NOT "simplify" it to always include `editorName: null`.
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
  /** Folded in only when true: step events keep their pre-ramp hash. */
  ramp?: boolean | null;
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
  /** Folded in only when set, like editorName: songs without it keep their hash. */
  stereo?: SongStereo | null;
  /** Server-stamped "edited by" name. Folded into the hash only when non-empty. */
  editorName?: string | null;
}

export interface EnvelopeHashInput {
  program: number;
  name: string | null;
  /** In step order: the index IS the step number, so no sorting here. */
  steps: { next: number; amp: number; durMs: number; ntau: number }[];
  editorName?: string | null;
}

export interface PlaylistHashInput {
  name: string | null;
  coilCount: number;
  /** RESOLVED song uuids in playlist order. Unresolved members are dropped by
   *  every caller before hashing, so the hash never carries null slots. */
  songUuids: string[];
  /** Server-stamped "edited by" name. Folded into the hash only when non-empty. */
  editorName?: string | null;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Round-trip a float through fixed precision to neutralize tiny FP noise. */
function num(n: number): number {
  return Number.isFinite(n) ? Number(n.toFixed(6)) : 0;
}

/**
 * Appends `editorName` to an otherwise-finished canonical object ONLY when it is
 * a non-empty string (see the module header). When absent, the returned JSON is
 * byte-identical to the pre-editorName output — the invariant that keeps hashes
 * stable across auth-off / pre-feature peers. Inserted last for deterministic
 * key order.
 */
function withEditor(
  canonical: Record<string, unknown>,
  editorName: string | null | undefined,
): Record<string, unknown> {
  const editor = editorName?.trim();
  if (editor) canonical.editorName = editor;
  return canonical;
}

export function hashSong(input: SongHashInput): string {
  const canonical: Record<string, unknown> = {
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
        ...(e.ramp ? { ramp: true } : {}),
      })),
  };
  if (input.stereo) canonical.stereo = canonicalStereo(input.stereo);
  return sha256(JSON.stringify(withEditor(canonical, input.editorName)));
}

function canonicalStereo(s: SongStereo): Record<string, unknown> {
  return {
    blend: s.blend,
    coils: s.coils.map((c) => ({ position: num(c.position), reach: num(c.reach) })),
    channels: Object.keys(s.channels)
      .map(Number)
      .sort((a, b) => a - b)
      .map((ch) => ({ ch, ...s.channels[ch] })),
  };
}

export function hashPlaylist(input: PlaylistHashInput): string {
  const canonical: Record<string, unknown> = {
    name: input.name ?? '',
    coilCount: input.coilCount,
    songUuids: input.songUuids,
  };
  return sha256(JSON.stringify(withEditor(canonical, input.editorName)));
}

export function hashEnvelope(input: EnvelopeHashInput): string {
  const canonical: Record<string, unknown> = {
    program: input.program,
    name: input.name ?? '',
    steps: input.steps.map((s) => ({
      next: s.next,
      amp: num(s.amp),
      durMs: num(s.durMs),
      ntau: num(s.ntau),
    })),
  };
  return sha256(JSON.stringify(withEditor(canonical, input.editorName)));
}

/** Identity of a MIDI file = sha256 of its raw bytes (path/name excluded). */
export function hashBytes(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
