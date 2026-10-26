import {
  BadRequestException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createReadStream, existsSync, promises as fs } from 'fs';
import { basename, join } from 'path';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { UPLOADS_DIR } from '../config/paths';
import {
  Envelope,
  envelopeSyncKey,
  programOfSyncKey,
} from '../envelopes/entities/envelope.entity';
import { normalizeSteps } from '../envelopes/envelopes.service';
import { TeslaCoil } from '../coils/entities/tesla-coil.entity';
import { Scene } from '../scenes/entities/scene.entity';
import { computeChannels, computePrograms } from '../midi/midi-channels';
import { computeDurationMs } from '../midi/midi-duration';
import { MidiFile } from '../midi/entities/midi-file.entity';
import { PlaylistSong } from '../playlists/entities/playlist-song.entity';
import { Playlist } from '../playlists/entities/playlist.entity';
import { Coil } from '../songs/entities/coil.entity';
import { CoilEvent } from '../songs/entities/coil-event.entity';
import { Song } from '../songs/entities/song.entity';
import { copyFileRow, dropFileIfUnused, ownFileUuid, rehashSong } from '../songs/own-files';
import { sanitizeStereo } from '../songs/stereo';
import { sanitizeVariants } from '../songs/variants';
import { hashBytes, hashEnvelope, hashPlaylist, hashScene, hashSong, hashTeslaCoil } from './content-hash';
import {
  ApplyRequestDto,
  EnvelopePayloadDto,
  TeslaCoilPayloadDto,
  PlaylistPayloadDto,
  PullRequestDto,
  ScenePayloadDto,
  SongPayloadDto,
  UploadFileDto,
} from './dto/sync.dto';

export interface ManifestEntry {
  uuid: string;
  updatedAt: number;
  contentHash: string;
  name: string;
}

export interface SyncManifest {
  songs: ManifestEntry[];
  playlists: ManifestEntry[];
  midiFiles: ManifestEntry[];
  envelopes: ManifestEntry[];
  coils: ManifestEntry[];
  scenes: ManifestEntry[];
}

export interface MidiFilePayload {
  uuid: string;
  updatedAt: number;
  contentHash: string;
  name: string;
  durationMs: number | null;
  editorName: string | null;
  /** Lets the orchestrator bring along the envelopes a synced file plays. */
  programs: Record<number, number> | null;
}

export interface PullResponse {
  songs: SongPayloadDto[];
  playlists: PlaylistPayloadDto[];
  midiFiles: MidiFilePayload[];
  envelopes: EnvelopePayloadDto[];
  coils: TeslaCoilPayloadDto[];
  scenes: ScenePayloadDto[];
}

export interface ApplyResult {
  applied: {
    type: 'song' | 'playlist' | 'envelope' | 'coil' | 'scene';
    uuid: string;
    action: 'created' | 'updated';
  }[];
  warnings: string[];
}

@Injectable()
export class SyncService {
  constructor(
    @InjectRepository(Song)
    private readonly songRepository: Repository<Song>,
    @InjectRepository(Playlist)
    private readonly playlistRepository: Repository<Playlist>,
    @InjectRepository(MidiFile)
    private readonly midiFileRepository: Repository<MidiFile>,
    @InjectRepository(Envelope)
    private readonly envelopeRepository: Repository<Envelope>,
    @InjectRepository(TeslaCoil)
    private readonly coilRepository: Repository<TeslaCoil>,
    @InjectRepository(Scene)
    private readonly sceneRepository: Repository<Scene>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // ---------------------------------------------------------------- manifest

  async manifest(): Promise<SyncManifest> {
    const [songs, playlists, midiFiles, envelopes, coils, scenes] = await Promise.all([
      this.songRepository.find(),
      this.playlistRepository.find(),
      this.midiFileRepository.find(),
      this.envelopeRepository.find(),
      this.coilRepository.find(),
      this.sceneRepository.find(),
    ]);
    return {
      songs: songs.map((s) => this.entryOf(s)),
      playlists: playlists.map((p) => this.entryOf(p)),
      midiFiles: await Promise.all(midiFiles.map((m) => this.midiEntryOf(m))),
      envelopes: envelopes.map((e) =>
        this.entryOf({
          uuid: envelopeSyncKey(e.program),
          updatedAt: e.updatedAt,
          contentHash: e.contentHash,
          name: `P${e.program} · ${e.name ?? ''}`,
        }),
      ),
      coils: coils.map((c) => this.entryOf(c)),
      scenes: scenes.map((s) => this.entryOf(s)),
    };
  }

  private entryOf(row: {
    uuid: string;
    updatedAt: number;
    contentHash: string;
    name: string | null;
  }): ManifestEntry {
    return {
      uuid: row.uuid,
      updatedAt: row.updatedAt ?? 0,
      contentHash: row.contentHash ?? '',
      name: row.name ?? '',
    };
  }

  /** Lazily computes + persists a MIDI file's byte hash if it is still missing. */
  private async midiEntryOf(file: MidiFile): Promise<ManifestEntry> {
    if (!file.contentHash) {
      try {
        const buffer = await fs.readFile(join(UPLOADS_DIR, basename(file.path)));
        file.contentHash = hashBytes(buffer);
        await this.midiFileRepository.update(file.id, {
          contentHash: file.contentHash,
        });
      } catch {
        // file unreadable — leave empty; the orchestrator will see a mismatch.
      }
    }
    return this.entryOf(file);
  }

  // -------------------------------------------------------------------- pull

  async pull(dto: PullRequestDto): Promise<PullResponse> {
    const songUuids = dto.songs ?? [];
    const playlistUuids = dto.playlists ?? [];
    const midiUuids = dto.midiFiles ?? [];
    const envelopePrograms = (dto.envelopes ?? [])
      .map(programOfSyncKey)
      .filter((p): p is number => p != null);

    const songs = songUuids.length
      ? await this.songRepository.find({ where: { uuid: In(songUuids) } })
      : [];
    const playlists = playlistUuids.length
      ? await this.playlistRepository.find({ where: { uuid: In(playlistUuids) } })
      : [];
    const midiFiles = midiUuids.length
      ? await this.midiFileRepository.find({ where: { uuid: In(midiUuids) } })
      : [];
    const envelopes = envelopePrograms.length
      ? await this.envelopeRepository.find({ where: { program: In(envelopePrograms) } })
      : [];
    const coils = dto.coils?.length
      ? await this.coilRepository.find({ where: { uuid: In(dto.coils) } })
      : [];
    const scenes = dto.scenes?.length
      ? await this.sceneRepository.find({ where: { uuid: In(dto.scenes) } })
      : [];

    return {
      songs: songs.map((s) => this.songPayloadOf(s)),
      playlists: await Promise.all(
        playlists.map((p) => this.playlistPayloadOf(p)),
      ),
      midiFiles: midiFiles.map((m) => this.midiPayloadOf(m)),
      envelopes: envelopes.map((e) => this.envelopePayloadOf(e)),
      coils: coils.map((c) => this.coilPayloadOf(c)),
      scenes: scenes.map((s) => this.scenePayloadOf(s)),
    };
  }

  private scenePayloadOf(s: Scene): ScenePayloadDto {
    return {
      uuid: s.uuid,
      updatedAt: s.updatedAt ?? 0,
      contentHash: s.contentHash ?? '',
      name: s.name ?? '',
      position: s.position ?? 0,
      data: s.data ?? {},
      editorName: s.editorName ?? null,
    };
  }

  private coilPayloadOf(c: TeslaCoil): TeslaCoilPayloadDto {
    return {
      uuid: c.uuid,
      updatedAt: c.updatedAt ?? 0,
      contentHash: c.contentHash ?? '',
      name: c.name ?? '',
      position: c.position ?? 0,
      spec: c.spec ?? {},
      twinGroup: c.twinGroup ?? null,
      notes: c.notes ?? null,
      editorName: c.editorName ?? null,
    };
  }

  private envelopePayloadOf(e: Envelope): EnvelopePayloadDto {
    return {
      uuid: envelopeSyncKey(e.program),
      updatedAt: e.updatedAt ?? 0,
      contentHash: e.contentHash ?? '',
      program: e.program,
      name: e.name ?? '',
      editorName: e.editorName ?? null,
      steps: e.steps,
    };
  }

  private songPayloadOf(song: Song): SongPayloadDto {
    return {
      uuid: song.uuid,
      updatedAt: song.updatedAt ?? 0,
      contentHash: song.contentHash ?? '',
      name: song.name ?? '',
      coilCount: song.coilCount,
      mode: song.mode,
      output2Mask: song.output2Mask,
      midiFileUuid: song.midiFile?.uuid ?? null,
      editorName: song.editorName ?? null,
      stereo: song.stereo ? { ...song.stereo } : null,
      ...(song.variants?.length ? { variants: song.variants.map((v) => ({ ...v })) } : {}),
      coils: [...(song.coils ?? [])]
        .sort((a, b) => a.coilIndex - b.coilIndex)
        .map((c) => ({
          coilIndex: c.coilIndex,
          ...(c.coilUuid ? { coilUuid: c.coilUuid } : {}),
          channelMask: c.channelMask,
          ontimeUs: c.ontimeUs,
          duty: c.duty,
        })),
      events: [...(song.events ?? [])].map((e) => ({
        coilIndex: e.coilIndex,
        atMs: e.atMs,
        param: e.param,
        value: e.value,
        ...(e.ramp ? { ramp: true } : {}),
      })),
    };
  }

  private async playlistPayloadOf(
    playlist: Playlist,
  ): Promise<PlaylistPayloadDto> {
    const ordered = [...(playlist.playlistSongs ?? [])].sort(
      (a, b) => a.idx - b.idx,
    );
    const ids = ordered.map((ps) => ps.songId);
    let songUuids: string[] = [];
    if (ids.length) {
      const rows = await this.songRepository.find({
        where: { id: In(ids) },
        select: { id: true, uuid: true },
      });
      const byId = new Map(rows.map((r) => [r.id, r.uuid]));
      songUuids = ids
        .map((id) => byId.get(id))
        .filter((u): u is string => typeof u === 'string');
    }
    return {
      uuid: playlist.uuid,
      updatedAt: playlist.updatedAt ?? 0,
      contentHash: playlist.contentHash ?? '',
      name: playlist.name ?? '',
      coilCount: playlist.coilCount ?? 3,
      editorName: playlist.editorName ?? null,
      songUuids,
    };
  }

  private midiPayloadOf(file: MidiFile): MidiFilePayload {
    return {
      uuid: file.uuid,
      updatedAt: file.updatedAt ?? 0,
      contentHash: file.contentHash ?? '',
      name: file.name ?? '',
      durationMs: file.durationMs,
      editorName: file.editorName ?? null,
      programs: file.programs ?? null,
    };
  }

  // -------------------------------------------------------------- file bytes

  /** Streams the MIDI bytes for a file identified by its sync uuid. */
  async getFileStream(uuid: string): Promise<StreamableFile> {
    const file = await this.midiFileRepository.findOne({ where: { uuid } });
    if (!file) {
      throw new NotFoundException(`MIDI file ${uuid} not found`);
    }
    const name = basename(file.path);
    const filePath = join(UPLOADS_DIR, name);
    if (!existsSync(filePath)) {
      throw new NotFoundException(`MIDI file ${uuid} is missing on disk`);
    }
    return new StreamableFile(createReadStream(filePath), {
      type: 'application/octet-stream',
      disposition: `attachment; filename="${name}"`,
    });
  }

  /**
   * Receives a MIDI file's bytes (already written to the uploads dir by Multer
   * under `file.filename`) and upserts the MidiFile row by uuid. Idempotent:
   * identical bytes for a known uuid discard the upload and keep the existing
   * row. Matches files by uuid + bytes hash, never by path.
   */
  async receiveFile(
    file: Express.Multer.File,
    dto: UploadFileDto,
  ): Promise<MidiFilePayload> {
    return this.receiveStored(file.filename, dto);
  }

  /** receiveFile for bytes already written to the uploads dir as `storedName` (a backup being restored). */
  async receiveStored(
    storedName: string,
    dto: UploadFileDto,
  ): Promise<MidiFilePayload> {
    const storedPath = join(UPLOADS_DIR, storedName);
    try {
      // FileInterceptor already wrote the file before validation ran (DTO fields
      // are optional at the pipe), so validate here where cleanup is in scope.
      if (!dto.uuid || !dto.name || !dto.contentHash || dto.updatedAt == null) {
        throw new BadRequestException('Missing uuid/name/contentHash/updatedAt');
      }
      const buffer = await fs.readFile(storedPath);
      // Reject anything that is not a Standard MIDI File (header 'MThd'); the
      // client-supplied hash only proves transit integrity, not MIDI-ness.
      if (buffer.length < 4 || buffer.toString('ascii', 0, 4) !== 'MThd') {
        throw new BadRequestException('Uploaded file is not a valid MIDI file');
      }
      const actualHash = hashBytes(buffer);
      if (actualHash !== dto.contentHash) {
        throw new BadRequestException('Uploaded bytes do not match contentHash');
      }
      const durationMs = this.durationOf(buffer);
      const channels = this.channelsOf(buffer);
      const programs = computePrograms(buffer);

      const existing = await this.midiFileRepository.findOne({
        where: { uuid: dto.uuid },
      });
      if (existing) {
        if (existing.contentHash === actualHash) {
          // Already have these exact bytes — drop the redundant upload.
          await fs.rm(storedPath, { force: true });
          return this.midiPayloadOf(existing);
        }
        const oldName = basename(existing.path);
        existing.path = `./uploads/${storedName}`;
        existing.contentHash = actualHash;
        existing.durationMs = durationMs;
        existing.channels = channels;
        existing.programs = programs;
        existing.name = dto.name;
        existing.updatedAt = dto.updatedAt;
        existing.editorName = dto.editorName ?? null;
        const saved = await this.midiFileRepository.save(existing);
        if (oldName !== storedName) {
          await fs.rm(join(UPLOADS_DIR, oldName), { force: true });
        }
        // the song's hash holds its file's: honest even if its own apply never comes
        const query = (sql: string, params?: unknown[]) => this.dataSource.query(sql, params);
        const songs: { id: number }[] = await query(`SELECT id FROM "Song" WHERE midiFile_id = ?`, [saved.id]);
        for (const s of songs) await rehashSong(query, s.id);
        return this.midiPayloadOf(saved);
      }

      const created = this.midiFileRepository.create({
        uuid: dto.uuid,
        name: dto.name,
        path: `./uploads/${storedName}`,
        contentHash: actualHash,
        durationMs,
        channels,
        programs,
        updatedAt: dto.updatedAt,
        editorName: dto.editorName ?? null,
      });
      const saved = await this.midiFileRepository.save(created);
      return this.midiPayloadOf(saved);
    } catch (err) {
      // Never leave the just-uploaded temp file orphaned on any failure.
      await fs.rm(storedPath, { force: true });
      throw err;
    }
  }

  private durationOf(buffer: Buffer): number | null {
    try {
      return computeDurationMs(buffer);
    } catch {
      return null;
    }
  }

  private channelsOf(buffer: Buffer): number | null {
    try {
      return computeChannels(buffer);
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------- apply

  /**
   * Idempotent upsert-by-uuid of envelopes, songs then playlists (FK order;
   * envelopes have no FK, songs only reach them through their file). MIDI bytes
   * must already be present (transferred via /sync/file first). Each item runs
   * in its own transaction; the stored contentHash is RECOMPUTED from what is
   * actually written, so the manifest never lies about local state.
   */
  async apply(dto: ApplyRequestDto): Promise<ApplyResult> {
    const result: ApplyResult = { applied: [], warnings: [] };

    for (const payload of dto.envelopes ?? []) {
      await this.dataSource.transaction(async (manager) => {
        const action = await this.applyEnvelope(manager, payload);
        result.applied.push({ type: 'envelope', uuid: payload.uuid, action });
      });
    }

    for (const payload of dto.coils ?? []) {
      await this.dataSource.transaction(async (manager) => {
        const action = await this.applyCoil(manager, payload);
        result.applied.push({ type: 'coil', uuid: payload.uuid, action });
      });
    }

    for (const payload of dto.scenes ?? []) {
      await this.dataSource.transaction(async (manager) => {
        const action = await this.applyScene(manager, payload);
        result.applied.push({ type: 'scene', uuid: payload.uuid, action });
      });
    }

    for (const payload of dto.songs ?? []) {
      await this.dataSource.transaction(async (manager) => {
        const action = await this.applySong(manager, payload, result.warnings);
        result.applied.push({ type: 'song', uuid: payload.uuid, action });
      });
    }

    for (const payload of dto.playlists ?? []) {
      await this.dataSource.transaction(async (manager) => {
        const action = await this.applyPlaylist(
          manager,
          payload,
          result.warnings,
        );
        result.applied.push({ type: 'playlist', uuid: payload.uuid, action });
      });
    }

    return result;
  }

  private async applySong(
    manager: EntityManager,
    payload: SongPayloadDto,
    warnings: string[],
  ): Promise<'created' | 'updated'> {
    // Resolve the MIDI file by uuid (bytes were transferred beforehand).
    let midiFile: MidiFile | null = null;
    if (payload.midiFileUuid) {
      midiFile = await manager.findOne(MidiFile, {
        where: { uuid: payload.midiFileUuid },
      });
      if (!midiFile) {
        warnings.push(
          `song ${payload.uuid}: MIDI file ${payload.midiFileUuid} not found — left without one`,
        );
      }
    }
    // A peer from before songs owned their file may point two songs at one:
    // this one takes its own copy, as the OwnMidiFiles migration would give it.
    if (midiFile) {
      const owner = await manager.findOne(Song, {
        where: { midiFile: { id: midiFile.id } },
        select: { id: true, uuid: true },
      });
      if (owner && owner.uuid !== payload.uuid) {
        const uuid = ownFileUuid(midiFile.uuid, payload.uuid);
        const query = (sql: string, params?: unknown[]) => manager.query(sql, params);
        midiFile =
          (await manager.findOne(MidiFile, { where: { uuid } })) ??
          (await manager.findOne(MidiFile, { where: { id: await copyFileRow(query, midiFile.id, uuid) } }));
      }
    }

    let song = await manager.findOne(Song, { where: { uuid: payload.uuid } });
    const action: 'created' | 'updated' = song ? 'updated' : 'created';
    if (song) {
      await manager.query('DELETE FROM "Coil" WHERE song_id = ?', [song.id]);
      await manager.query('DELETE FROM "CoilEvent" WHERE song_id = ?', [song.id]);
    } else {
      song = new Song();
      song.uuid = payload.uuid;
    }

    song.name = payload.name ?? '';
    song.coilCount = payload.coilCount;
    song.mode = payload.mode;
    song.output2Mask = payload.output2Mask;
    const previousFile = song.midiFile ?? null;
    song.midiFile = midiFile;
    song.updatedAt = payload.updatedAt;
    // Preserve authorship from the payload (historical metadata) — NOT the
    // syncing user's token.
    song.editorName = payload.editorName ?? null;
    song.stereo = sanitizeStereo(payload.stereo);
    song.variants = sanitizeVariants(payload.variants);

    // De-dupe coils by index (keep last) to honor UNIQUE(song_id, coilIndex).
    const coilByIndex = new Map<number, Coil>();
    for (const c of payload.coils) {
      const coil = new Coil();
      coil.coilIndex = c.coilIndex;
      coil.coilUuid = c.coilUuid || null;
      coil.channelMask = c.channelMask;
      coil.ontimeUs = c.ontimeUs;
      coil.duty = c.duty;
      coilByIndex.set(c.coilIndex, coil);
    }
    song.coils = [...coilByIndex.values()];

    song.events = payload.events.map((e) => {
      const event = new CoilEvent();
      event.coilIndex = e.coilIndex;
      event.atMs = e.atMs;
      event.param = e.param;
      event.value = e.value;
      event.ramp = e.ramp ? true : null;
      return event;
    });

    // Recompute from what is actually stored (honest manifest, idempotent
    // when nothing degraded; honest conflict when the MIDI dep was missing).
    song.contentHash = hashSong({
      name: song.name,
      coilCount: song.coilCount,
      mode: song.mode,
      output2Mask: song.output2Mask,
      midiFileUuid: midiFile?.uuid ?? null,
      midiFileHash: midiFile?.contentHash ?? null,
      coils: song.coils,
      events: song.events,
      stereo: song.stereo,
      variants: song.variants,
      editorName: song.editorName,
    });

    await manager.save(song);
    // the file it played before, if it now has another: nobody can reach it any more
    if (previousFile && previousFile.id !== midiFile?.id) {
      await dropFileIfUnused((sql, params) => manager.query(sql, params), previousFile.id);
    }
    return action;
  }

  /** Upserts by uuid; the hash is recomputed from what is written. */
  private async applyCoil(manager: EntityManager, payload: TeslaCoilPayloadDto): Promise<'created' | 'updated'> {
    let coil = await manager.findOne(TeslaCoil, { where: { uuid: payload.uuid } });
    const action: 'created' | 'updated' = coil ? 'updated' : 'created';
    coil ??= new TeslaCoil();
    coil.uuid = payload.uuid;
    coil.name = payload.name ?? '';
    coil.position = payload.position ?? 0;
    coil.spec = payload.spec ?? {};
    coil.twinGroup = payload.twinGroup ?? null;
    coil.notes = payload.notes ?? null;
    coil.updatedAt = payload.updatedAt;
    coil.editorName = payload.editorName ?? null;
    coil.contentHash = hashTeslaCoil(coil);
    await manager.save(coil);
    return action;
  }

  /** Upserts by uuid; the hash is recomputed from what is written. */
  private async applyScene(manager: EntityManager, payload: ScenePayloadDto): Promise<'created' | 'updated'> {
    let scene = await manager.findOne(Scene, { where: { uuid: payload.uuid } });
    const action: 'created' | 'updated' = scene ? 'updated' : 'created';
    scene ??= new Scene();
    scene.uuid = payload.uuid;
    scene.name = payload.name ?? '';
    scene.position = payload.position ?? 0;
    scene.data = payload.data ?? {};
    scene.updatedAt = payload.updatedAt;
    scene.editorName = payload.editorName ?? null;
    scene.contentHash = hashScene(scene);
    await manager.save(scene);
    return action;
  }

  /** Upserts by program slot: the slot is the identity (see Envelope). */
  private async applyEnvelope(
    manager: EntityManager,
    payload: EnvelopePayloadDto,
  ): Promise<'created' | 'updated'> {
    let envelope = await manager.findOne(Envelope, {
      where: { program: payload.program },
    });
    const action: 'created' | 'updated' = envelope ? 'updated' : 'created';
    envelope ??= new Envelope();
    envelope.program = payload.program;
    envelope.name = payload.name ?? '';
    envelope.steps = normalizeSteps(payload.steps);
    envelope.updatedAt = payload.updatedAt;
    // Preserve authorship from the payload, as for songs.
    envelope.editorName = payload.editorName ?? null;
    envelope.contentHash = hashEnvelope(envelope);
    await manager.save(envelope);
    return action;
  }

  private async applyPlaylist(
    manager: EntityManager,
    payload: PlaylistPayloadDto,
    warnings: string[],
  ): Promise<'created' | 'updated'> {
    // Resolve member song uuids -> local ids, preserving order; drop unknowns.
    const resolvedUuids: string[] = [];
    const songIds: number[] = [];
    for (const uuid of payload.songUuids) {
      const s = await manager.findOne(Song, {
        where: { uuid },
        select: { id: true, uuid: true },
      });
      if (s) {
        resolvedUuids.push(s.uuid);
        songIds.push(s.id);
      } else {
        warnings.push(
          `playlist ${payload.uuid}: song ${uuid} not found — dropped`,
        );
      }
    }

    let playlist = await manager.findOne(Playlist, {
      where: { uuid: payload.uuid },
    });
    const action: 'created' | 'updated' = playlist ? 'updated' : 'created';
    if (playlist) {
      await manager.query('DELETE FROM "PlaylistSong" WHERE playlist_id = ?', [
        playlist.id,
      ]);
    } else {
      playlist = new Playlist();
      playlist.uuid = payload.uuid;
    }

    playlist.name = payload.name ?? '';
    playlist.coilCount = payload.coilCount ?? 3;
    playlist.updatedAt = payload.updatedAt;
    // Preserve authorship from the payload (historical metadata) — NOT the
    // syncing user's token.
    playlist.editorName = payload.editorName ?? null;
    playlist.contentHash = hashPlaylist({
      name: playlist.name,
      coilCount: playlist.coilCount,
      songUuids: resolvedUuids,
      editorName: playlist.editorName,
    });
    playlist.playlistSongs = songIds.map((songId, idx) => {
      const ps = new PlaylistSong();
      ps.songId = songId;
      ps.idx = idx;
      return ps;
    });

    await manager.save(playlist);
    return action;
  }
}
