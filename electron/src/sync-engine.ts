/**
 * Sync orchestrator (main process). Diffs the local embedded backend against a
 * remote peer (both expose the identical /api/sync/* surface) and applies the
 * user's per-item choices. Policy: ADD/UPDATE ONLY — nothing is ever deleted.
 *
 * MIDI files needed by a synced song (and member songs of a synced playlist)
 * are auto-resolved as dependencies regardless of the user's per-row choice, so
 * a propagated song never lands without its file.
 */

export type EntityType = 'song' | 'playlist' | 'midiFile';
export type Choice = 'local' | 'remote' | 'skip';
export type DiffStatus = 'only-local' | 'only-remote' | 'conflict';

export interface ManifestEntry {
  uuid: string;
  updatedAt: number;
  contentHash: string;
  name: string;
}
interface Manifest {
  songs: ManifestEntry[];
  playlists: ManifestEntry[];
  midiFiles: ManifestEntry[];
}

export interface DiffItem {
  type: EntityType;
  uuid: string;
  name: string;
  status: DiffStatus;
  localUpdatedAt: number | null;
  remoteUpdatedAt: number | null;
  defaultChoice: Choice;
  /** The same content/name exists on the other side under a DIFFERENT uuid —
   *  syncing it would create a duplicate, so it defaults to skip. */
  duplicate?: boolean;
}

export interface SyncDiff {
  serverUrl: string;
  items: DiffItem[];
}

export interface SyncSelection {
  type: EntityType;
  uuid: string;
  choice: Choice;
}

export interface ApplyOutcome {
  pulled: number;
  pushed: number;
  warnings: string[];
}

export interface RemoteConfig {
  url: string;
  username: string;
  password: string;
}

export interface SyncContext {
  localBase: string;
  remote: RemoteConfig;
}

/** A progress step: an i18n key (under `desktop.prog`) + optional params. The
 *  renderer translates it, so the message respects the UI language. */
export interface SyncProgress {
  key: string;
  params?: Record<string, string | number>;
}
type Progress = (p: SyncProgress) => void;

interface Peer {
  base: string;
  headers: Record<string, string>;
}

interface SongPayload {
  uuid: string;
  updatedAt: number;
  contentHash: string;
  name: string;
  coilCount: number;
  mode: string;
  output2Mask: number;
  midiFileUuid: string | null;
  coils: unknown[];
  events: unknown[];
}
interface PlaylistPayload {
  uuid: string;
  updatedAt: number;
  contentHash: string;
  name: string;
  coilCount: number;
  songUuids: string[];
}
interface PullResponse {
  songs: SongPayload[];
  playlists: PlaylistPayload[];
  midiFiles: ManifestEntry[];
}

const trimSlash = (s: string): string => s.replace(/\/+$/, '');

function authHeaders(remote: RemoteConfig): Record<string, string> {
  if (!remote.username) return {};
  const token = Buffer.from(`${remote.username}:${remote.password}`).toString(
    'base64',
  );
  return { Authorization: `Basic ${token}` };
}

async function fetchJson<T>(
  url: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${url} -> HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

function peersOf(ctx: SyncContext): { local: Peer; remote: Peer } {
  if (!ctx.remote.url) {
    throw new Error('No server configured. Set the server URL first.');
  }
  return {
    local: { base: trimSlash(ctx.localBase), headers: {} },
    remote: { base: trimSlash(ctx.remote.url), headers: authHeaders(ctx.remote) },
  };
}

const manifestOf = (peer: Peer): Promise<Manifest> =>
  fetchJson<Manifest>(`${peer.base}/api/sync/manifest`, { headers: peer.headers });

const norm = (s: string): string => s.trim().toLowerCase();

function diffType(
  type: EntityType,
  local: ManifestEntry[],
  remote: ManifestEntry[],
): DiffItem[] {
  const lm = new Map(local.map((e) => [e.uuid, e]));
  const rm = new Map(remote.map((e) => [e.uuid, e]));
  const items: DiffItem[] = [];
  const onlyLocal: ManifestEntry[] = [];
  const onlyRemote: ManifestEntry[] = [];
  for (const uuid of new Set([...lm.keys(), ...rm.keys()])) {
    const l = lm.get(uuid);
    const r = rm.get(uuid);
    if (l && r) {
      if (l.contentHash === r.contentHash) continue; // in sync (same uuid + hash)
      items.push({
        type,
        uuid,
        name: r.name || l.name,
        status: 'conflict',
        localUpdatedAt: l.updatedAt,
        remoteUpdatedAt: r.updatedAt,
        defaultChoice: l.updatedAt >= r.updatedAt ? 'local' : 'remote',
      });
    } else if (l) {
      onlyLocal.push(l);
    } else if (r) {
      onlyRemote.push(r);
    }
  }

  // Likely-duplicate detection: an only-local and an only-remote item sharing the
  // same content hash, or the same (trimmed, case-insensitive) name, are almost
  // certainly the same logical item created independently on each side with
  // different uuids. Propagating one would add a SECOND copy on the other side,
  // so flag it and default to skip — the user can still override per row.
  const rHash = new Set(onlyRemote.map((e) => e.contentHash).filter(Boolean));
  const rName = new Set(onlyRemote.map((e) => norm(e.name)).filter(Boolean));
  const lHash = new Set(onlyLocal.map((e) => e.contentHash).filter(Boolean));
  const lName = new Set(onlyLocal.map((e) => norm(e.name)).filter(Boolean));
  const isDup = (e: ManifestEntry, hashes: Set<string>, names: Set<string>): boolean =>
    (!!e.contentHash && hashes.has(e.contentHash)) ||
    (!!norm(e.name) && names.has(norm(e.name)));

  for (const l of onlyLocal) {
    const dup = isDup(l, rHash, rName);
    items.push({
      type,
      uuid: l.uuid,
      name: l.name,
      status: 'only-local',
      localUpdatedAt: l.updatedAt,
      remoteUpdatedAt: null,
      defaultChoice: dup ? 'skip' : 'local',
      duplicate: dup,
    });
  }
  for (const r of onlyRemote) {
    const dup = isDup(r, lHash, lName);
    items.push({
      type,
      uuid: r.uuid,
      name: r.name,
      status: 'only-remote',
      localUpdatedAt: null,
      remoteUpdatedAt: r.updatedAt,
      defaultChoice: dup ? 'skip' : 'remote',
      duplicate: dup,
    });
  }
  return items;
}

export async function previewSync(
  ctx: SyncContext,
  onProgress?: Progress,
): Promise<SyncDiff> {
  const { local, remote } = peersOf(ctx);
  onProgress?.({ key: 'comparing' });
  const [localM, remoteM] = await Promise.all([
    manifestOf(local),
    manifestOf(remote),
  ]);
  const items = [
    ...diffType('midiFile', localM.midiFiles, remoteM.midiFiles),
    ...diffType('song', localM.songs, remoteM.songs),
    ...diffType('playlist', localM.playlists, remoteM.playlists),
  ];
  return { serverUrl: trimSlash(ctx.remote.url), items };
}

interface Selected {
  songs: Set<string>;
  playlists: Set<string>;
  midiFiles: Set<string>;
}

function collect(selections: SyncSelection[], choice: Choice): Selected {
  const out: Selected = {
    songs: new Set(),
    playlists: new Set(),
    midiFiles: new Set(),
  };
  for (const s of selections) {
    if (s.choice !== choice) continue;
    if (s.type === 'song') out.songs.add(s.uuid);
    else if (s.type === 'playlist') out.playlists.add(s.uuid);
    else out.midiFiles.add(s.uuid);
  }
  return out;
}

const pull = (peer: Peer, body: Record<string, string[]>): Promise<PullResponse> =>
  fetchJson<PullResponse>(`${peer.base}/api/sync/pull`, {
    method: 'POST',
    headers: { ...peer.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

async function transferFile(
  source: Peer,
  target: Peer,
  meta: ManifestEntry,
): Promise<void> {
  const res = await fetch(`${source.base}/api/sync/file/${meta.uuid}`, {
    headers: source.headers,
  });
  if (!res.ok) {
    throw new Error(`GET file ${meta.uuid} -> HTTP ${res.status}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const fname = /\.midi?$/i.test(meta.name) ? meta.name : `${meta.name || 'file'}.mid`;
  const form = new FormData();
  form.append('uuid', meta.uuid);
  form.append('name', fname);
  form.append('contentHash', meta.contentHash);
  form.append('updatedAt', String(meta.updatedAt));
  form.append('file', new Blob([bytes]), fname);
  const up = await fetch(`${target.base}/api/sync/file`, {
    method: 'POST',
    headers: target.headers, // do NOT set Content-Type; fetch adds the boundary
    body: form,
  });
  if (!up.ok) {
    throw new Error(`POST file ${meta.uuid} -> HTTP ${up.status}`);
  }
}

/** Moves the selected items (+ their dependencies) from source to target. */
async function transfer(
  source: Peer,
  target: Peer,
  sourceM: Manifest,
  targetM: Manifest,
  sel: Selected,
  warnings: string[],
  onProgress: Progress | undefined,
  direction: 'pull' | 'push',
): Promise<number> {
  // 1) Pull selected playlists to learn their member songs.
  const playlistPayloads = sel.playlists.size
    ? (await pull(source, { playlists: [...sel.playlists] })).playlists
    : [];

  // 2) Song closure = explicitly-selected songs + playlist members.
  const songUuids = new Set(sel.songs);
  for (const pl of playlistPayloads) {
    for (const su of pl.songUuids) songUuids.add(su);
  }
  const songPayloads = songUuids.size
    ? (await pull(source, { songs: [...songUuids] })).songs
    : [];

  // 3) MIDI closure = explicitly-selected files + song dependencies.
  const midiUuids = new Set(sel.midiFiles);
  for (const s of songPayloads) {
    if (s.midiFileUuid) midiUuids.add(s.midiFileUuid);
  }

  // 4) Transfer MIDI bytes for anything the target lacks or has differently.
  const sourceMidi = new Map(sourceM.midiFiles.map((m) => [m.uuid, m]));
  const targetMidi = new Map(targetM.midiFiles.map((m) => [m.uuid, m]));
  let fileCount = 0;
  for (const uuid of midiUuids) {
    const src = sourceMidi.get(uuid);
    if (!src) {
      warnings.push(`MIDI ${uuid} missing on source — skipped`);
      continue;
    }
    const tgt = targetMidi.get(uuid);
    if (tgt && tgt.contentHash === src.contentHash) continue; // already there
    onProgress?.({
      key: direction === 'push' ? 'sendFile' : 'recvFile',
      params: { name: src.name },
    });
    await transferFile(source, target, src);
    fileCount += 1;
  }

  // 5) Upsert songs then playlists on the target (apply orders them internally).
  if (songPayloads.length || playlistPayloads.length) {
    onProgress?.({
      key: direction === 'push' ? 'sendItems' : 'recvItems',
      params: { songs: songPayloads.length, playlists: playlistPayloads.length },
    });
    const res = await fetchJson<{ warnings?: string[] }>(
      `${target.base}/api/sync/apply`,
      {
        method: 'POST',
        headers: { ...target.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ songs: songPayloads, playlists: playlistPayloads }),
      },
    );
    if (res.warnings?.length) warnings.push(...res.warnings);
  }

  return songPayloads.length + playlistPayloads.length + fileCount;
}

export async function applySync(
  ctx: SyncContext,
  selections: SyncSelection[],
  onProgress?: Progress,
): Promise<ApplyOutcome> {
  const { local, remote } = peersOf(ctx);
  onProgress?.({ key: 'comparing' });
  let localM = await manifestOf(local);
  let remoteM = await manifestOf(remote);

  const warnings: string[] = [];
  let pulled = 0;
  let pushed = 0;

  const toPull = collect(selections, 'remote');
  const didPull =
    toPull.songs.size || toPull.playlists.size || toPull.midiFiles.size;
  if (didPull) {
    pulled = await transfer(
      remote,
      local,
      remoteM,
      localM,
      toPull,
      warnings,
      onProgress,
      'pull',
    );
  }

  const toPush = collect(selections, 'local');
  if (toPush.songs.size || toPush.playlists.size || toPush.midiFiles.size) {
    if (didPull) {
      // The pull just mutated the local DB; refresh both manifests so the push
      // reasons about current state (skip-by-hash + "missing on source").
      localM = await manifestOf(local);
      remoteM = await manifestOf(remote);
    }
    pushed = await transfer(
      local,
      remote,
      localM,
      remoteM,
      toPush,
      warnings,
      onProgress,
      'push',
    );
  }

  return { pulled, pushed, warnings };
}
