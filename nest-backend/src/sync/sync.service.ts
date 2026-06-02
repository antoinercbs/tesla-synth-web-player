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
import { computeDurationMs } from '../midi/midi-duration';
import { MidiFile } from '../midi/entities/midi-file.entity';
import { PlaylistSong } from '../playlists/entities/playlist-song.entity';
import { Playlist } from '../playlists/entities/playlist.entity';
import { Coil } from '../songs/entities/coil.entity';
import { CoilEvent } from '../songs/entities/coil-event.entity';
import { Song } from '../songs/entities/song.entity';
import { hashBytes, hashPlaylist, hashSong } from './content-hash';
import {
  ApplyRequestDto,
  PlaylistPayloadDto,
  PullRequestDto,
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
}

export interface MidiFilePayload {
  uuid: string;
  updatedAt: number;
  contentHash: string;
  name: string;
  durationMs: number | null;
}

export interface PullResponse {
  songs: SongPayloadDto[];
  playlists: PlaylistPayloadDto[];
  midiFiles: MidiFilePayload[];
}

export interface ApplyResult {
  applied: {
    type: 'song' | 'playlist';
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
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // ---------------------------------------------------------------- manifest

  async manifest(): Promise<SyncManifest> {
    const [songs, playlists, midiFiles] = await Promise.all([
      this.songRepository.find(),
      this.playlistRepository.find(),
      this.midiFileRepository.find(),
    ]);
    return {
      songs: songs.map((s) => this.entryOf(s)),
      playlists: playlists.map((p) => this.entryOf(p)),
      midiFiles: await Promise.all(midiFiles.map((m) => this.midiEntryOf(m))),
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

    const songs = songUuids.length
      ? await this.songRepository.find({ where: { uuid: In(songUuids) } })
      : [];
    const playlists = playlistUuids.length
      ? await this.playlistRepository.find({ where: { uuid: In(playlistUuids) } })
      : [];
    const midiFiles = midiUuids.length
      ? await this.midiFileRepository.find({ where: { uuid: In(midiUuids) } })
      : [];

    return {
      songs: songs.map((s) => this.songPayloadOf(s)),
      playlists: await Promise.all(
        playlists.map((p) => this.playlistPayloadOf(p)),
      ),
      midiFiles: midiFiles.map((m) => this.midiPayloadOf(m)),
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
      coils: [...(song.coils ?? [])]
        .sort((a, b) => a.coilIndex - b.coilIndex)
        .map((c) => ({
          coilIndex: c.coilIndex,
          channelMask: c.channelMask,
          ontimeUs: c.ontimeUs,
          duty: c.duty,
        })),
      events: [...(song.events ?? [])].map((e) => ({
        coilIndex: e.coilIndex,
        atMs: e.atMs,
        param: e.param,
        value: e.value,
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
    const storedName = file.filename;
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
        existing.name = dto.name;
        existing.updatedAt = dto.updatedAt;
        const saved = await this.midiFileRepository.save(existing);
        if (oldName !== storedName) {
          await fs.rm(join(UPLOADS_DIR, oldName), { force: true });
        }
        return this.midiPayloadOf(saved);
      }

      const created = this.midiFileRepository.create({
        uuid: dto.uuid,
        name: dto.name,
        path: `./uploads/${storedName}`,
        contentHash: actualHash,
        durationMs,
        updatedAt: dto.updatedAt,
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

  // ------------------------------------------------------------------- apply

  /**
   * Idempotent upsert-by-uuid of songs then playlists (FK order). MIDI bytes
   * must already be present (transferred via /sync/file first). Each item runs
   * in its own transaction; the stored contentHash is RECOMPUTED from what is
   * actually written, so the manifest never lies about local state.
   */
  async apply(dto: ApplyRequestDto): Promise<ApplyResult> {
    const result: ApplyResult = { applied: [], warnings: [] };

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
    let effectiveMidiUuid: string | null = null;
    if (payload.midiFileUuid) {
      midiFile = await manager.findOne(MidiFile, {
        where: { uuid: payload.midiFileUuid },
      });
      if (midiFile) {
        effectiveMidiUuid = midiFile.uuid;
      } else {
        warnings.push(
          `song ${payload.uuid}: MIDI file ${payload.midiFileUuid} not found — left without one`,
        );
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
    song.midiFile = midiFile;
    song.updatedAt = payload.updatedAt;

    // De-dupe coils by index (keep last) to honor UNIQUE(song_id, coilIndex).
    const coilByIndex = new Map<number, Coil>();
    for (const c of payload.coils) {
      const coil = new Coil();
      coil.coilIndex = c.coilIndex;
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
      return event;
    });

    // Recompute from what is actually stored (honest manifest, idempotent
    // when nothing degraded; honest conflict when the MIDI dep was missing).
    song.contentHash = hashSong({
      name: song.name,
      coilCount: song.coilCount,
      mode: song.mode,
      output2Mask: song.output2Mask,
      midiFileUuid: effectiveMidiUuid,
      coils: song.coils,
      events: song.events,
    });

    await manager.save(song);
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
    playlist.contentHash = hashPlaylist({
      name: playlist.name,
      coilCount: playlist.coilCount,
      songUuids: resolvedUuids,
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
