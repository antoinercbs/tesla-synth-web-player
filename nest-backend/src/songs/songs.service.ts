import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { MidiFile } from '../midi/entities/midi-file.entity';
import { hashSong } from '../sync/content-hash';
import { CreateSongDto } from './dto/create-song.dto';
import { Coil } from './entities/coil.entity';
import { CoilEvent } from './entities/coil-event.entity';
import { PlaybackMode, Song } from './entities/song.entity';

/** JSON shape returned to the front (the structured per-coil model). */
export interface SongResponse {
  id: number;
  name: string;
  coilCount: number;
  mode: PlaybackMode;
  output2Mask: number;
  /** Who last edited this (server-stamped from the OIDC token), or null. */
  editorName: string | null;
  midiFile: { id: number; name: string; path: string; durationMs: number | null } | null;
  coils: {
    coilIndex: number;
    channelMask: number;
    ontimeUs: number;
    duty: number;
  }[];
  events: {
    coilIndex: number;
    atMs: number;
    param: string;
    value: number;
  }[];
}

@Injectable()
export class SongsService {
  constructor(
    @InjectRepository(Song)
    private readonly songRepository: Repository<Song>,
    @InjectRepository(MidiFile)
    private readonly midiFileRepository: Repository<MidiFile>,
  ) {}

  async findAll(): Promise<SongResponse[]> {
    const songs = await this.songRepository.find();
    return songs.map((song) => this.toResponse(song));
  }

  async create(
    dto: CreateSongDto,
    editorName: string | null = null,
  ): Promise<SongResponse> {
    const song = await this.fromDto(new Song(), dto);
    song.uuid = randomUUID();
    this.stampSync(song, editorName);
    const saved = await this.songRepository.save(song);
    return this.findOneOrThrow(saved.id);
  }

  async update(
    id: number,
    dto: CreateSongDto,
    editorName: string | null = null,
  ): Promise<SongResponse> {
    const song = await this.songRepository.findOne({ where: { id } });
    if (!song) {
      throw new NotFoundException(`Song ${id} not found`);
    }
    // Replace coils/events wholesale (delete-then-insert). Targeted SQL works
    // regardless of whether the schema declares ON DELETE CASCADE.
    await this.songRepository.query('DELETE FROM "Coil" WHERE song_id = ?', [id]);
    await this.songRepository.query('DELETE FROM "CoilEvent" WHERE song_id = ?', [id]);
    await this.fromDto(song, dto);
    // uuid is preserved (loaded with the row); only the change signal is bumped.
    this.stampSync(song, editorName);
    await this.songRepository.save(song);
    return this.findOneOrThrow(id);
  }

  async remove(id: number): Promise<void> {
    const song = await this.songRepository.findOne({ where: { id } });
    if (!song) {
      throw new NotFoundException(`Song ${id} not found`);
    }
    await this.songRepository.query('DELETE FROM "Coil" WHERE song_id = ?', [id]);
    await this.songRepository.query('DELETE FROM "CoilEvent" WHERE song_id = ?', [id]);
    await this.songRepository.query('DELETE FROM "PlaylistSong" WHERE song_id = ?', [id]);
    await this.songRepository.delete(id);
  }

  private async findOneOrThrow(id: number): Promise<SongResponse> {
    const song = await this.songRepository.findOne({ where: { id } });
    if (!song) {
      throw new NotFoundException(`Song ${id} not found`);
    }
    return this.toResponse(song);
  }

  /** Hydrates a Song entity from a DTO (used by both create and update). */
  private async fromDto(song: Song, dto: CreateSongDto): Promise<Song> {
    song.name = dto.name;
    song.coilCount = dto.coilCount;
    song.mode = dto.mode;
    song.output2Mask = dto.output2Mask;

    const midiFileId = dto.resolvedMidiFileId;
    song.midiFile = midiFileId
      ? await this.midiFileRepository.findOne({ where: { id: midiFileId } })
      : null;

    song.coils = dto.coils.map((c) => {
      const coil = new Coil();
      coil.coilIndex = c.coilIndex;
      coil.channelMask = c.channelMask;
      coil.ontimeUs = c.ontimeUs;
      coil.duty = c.duty;
      return coil;
    });

    song.events = (dto.events ?? []).map((e) => {
      const event = new CoilEvent();
      event.coilIndex = e.coilIndex;
      event.atMs = e.atMs;
      event.param = e.param;
      event.value = e.value;
      return event;
    });

    return song;
  }

  /** Stamps the sync change-signal (updatedAt + contentHash) from the in-memory
   *  aggregate, plus the server-authoritative editorName. Call after fromDto has
   *  resolved midiFile/coils/events. */
  private stampSync(song: Song, editorName: string | null): void {
    song.updatedAt = Date.now();
    song.editorName = editorName;
    song.contentHash = hashSong({
      name: song.name,
      coilCount: song.coilCount,
      mode: song.mode,
      output2Mask: song.output2Mask,
      midiFileUuid: song.midiFile?.uuid ?? null,
      coils: song.coils ?? [],
      events: song.events ?? [],
      editorName: song.editorName,
    });
  }

  private toResponse(song: Song): SongResponse {
    return {
      id: song.id,
      name: song.name,
      coilCount: song.coilCount,
      mode: song.mode,
      output2Mask: song.output2Mask,
      editorName: song.editorName ?? null,
      midiFile: song.midiFile
        ? {
            id: song.midiFile.id,
            name: song.midiFile.name,
            path: song.midiFile.path,
            durationMs: song.midiFile.durationMs,
          }
        : null,
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
}
