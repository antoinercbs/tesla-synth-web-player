import { createHash } from 'crypto';
import type { SongStereo } from '../songs/stereo';
import type { SongVariant } from '../songs/variants';

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
  /** Folded in only when set: songs saved before the coils were picked keep their hash. */
  coilUuid?: string | null;
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
  /** uuid of the song's MIDI file, NOT its id/path. */
  midiFileUuid: string | null;
  /** Its bytes' hash: a song is its notes too, so editing them changes the song.
   *  Folded in only when set, like stereo. */
  midiFileHash?: string | null;
  coils: CoilHashInput[];
  events: CoilEventHashInput[];
  /** Folded in only when set, like editorName: songs without it keep their hash. */
  stereo?: SongStereo | null;
  /** Folded in only when there are some, like stereo. */
  variants?: SongVariant[] | null;
  /** Server-stamped "edited by" name. Folded into the hash only when non-empty. */
  editorName?: string | null;
}

export interface TeslaCoilHashInput {
  name: string | null;
  position: number;
  /** The front's spec, hashed with its keys sorted. */
  spec: Record<string, unknown> | null;
  twinGroup?: string | null;
  notes?: string | null;
  editorName?: string | null;
}

export interface SceneHashInput {
  name: string | null;
  position: number;
  /** The front's scene, hashed with its keys sorted. */
  data: Record<string, unknown> | null;
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

function canonicalCoils(coils: CoilHashInput[]): Record<string, unknown>[] {
  return [...coils]
    .sort((a, b) => a.coilIndex - b.coilIndex)
    .map((c) => ({
      coilIndex: c.coilIndex,
      channelMask: c.channelMask,
      ontimeUs: c.ontimeUs,
      duty: num(c.duty),
      ...(c.coilUuid ? { coilUuid: c.coilUuid } : {}),
    }));
}

function canonicalEvents(events: CoilEventHashInput[]): Record<string, unknown>[] {
  return [...events]
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
    }));
}

export function hashSong(input: SongHashInput): string {
  const canonical: Record<string, unknown> = {
    name: input.name ?? '',
    coilCount: input.coilCount,
    mode: input.mode,
    output2Mask: input.output2Mask,
    midiFileUuid: input.midiFileUuid ?? null,
    coils: canonicalCoils(input.coils),
    events: canonicalEvents(input.events),
  };
  if (input.midiFileHash) canonical.midiFileHash = input.midiFileHash;
  if (input.stereo) canonical.stereo = canonicalStereo(input.stereo);
  // in their order: the first one is the one a stage tries first
  if (input.variants?.length) {
    canonical.variants = input.variants.map((v) => ({
      id: v.id,
      name: v.name,
      coilCount: v.coilCount,
      coils: canonicalCoils(v.coils),
      events: canonicalEvents(v.events),
      ...(v.stereo ? { stereo: canonicalStereo(v.stereo) } : {}),
    }));
  }
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

/** Keys sorted at every level, numbers rounded: the same spec hashes alike on both peers. */
function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (typeof value === 'number') return num(value);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalJson((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

export function hashTeslaCoil(input: TeslaCoilHashInput): string {
  const canonical: Record<string, unknown> = {
    name: input.name ?? '',
    position: input.position,
    spec: canonicalJson(input.spec ?? {}),
    twinGroup: input.twinGroup ?? null,
    notes: input.notes ?? null,
  };
  return sha256(JSON.stringify(withEditor(canonical, input.editorName)));
}

export function hashScene(input: SceneHashInput): string {
  const canonical: Record<string, unknown> = {
    name: input.name ?? '',
    position: input.position,
    data: canonicalJson(input.data ?? {}),
  };
  return sha256(JSON.stringify(withEditor(canonical, input.editorName)));
}

/** Identity of a MIDI file = sha256 of its raw bytes (path/name excluded). */
export function hashBytes(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
