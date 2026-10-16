import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
import { MidiFile } from '../midi/entities/midi-file.entity';
import { MidiService } from '../midi/midi.service';
import { AppConfig } from '../settings/entities/app-config.entity';
import { hashSong } from '../sync/content-hash';
import { CreateSongDto } from './dto/create-song.dto';
import { Coil } from './entities/coil.entity';
import { CoilEvent, SONG_WIDE } from './entities/coil-event.entity';
import { PlaybackMode, Song } from './entities/song.entity';
import { Tag } from '../tags/entities/tag.entity';
import { sanitizeStereo, type SongStereo } from './stereo';

/** The song's own MIDI file, as the front needs it. */
export interface SongMidiFile {
  id: number;
  /** As it was named on the uploader's disk. */
  name: string;
  path: string;
  durationMs: number | null;
  channels: number | null;
  /** Starting instrument per note-bearing channel ({ channel: program }). */
  programs: Record<number, number> | null;
  /** Who last uploaded/edited the notes, or null. */
  editorName: string | null;
  /** The bytes' sha256: changes with the notes, so a client can tell a cached copy is stale. */
  hash: string | null;
}

/** JSON shape returned to the front (the structured per-coil model). */
export interface SongResponse {
  id: number;
  name: string;
  coilCount: number;
  mode: PlaybackMode;
  output2Mask: number;
  /** Who last edited this (server-stamped from the OIDC token), or null. */
  editorName: string | null;
  midiFile: SongMidiFile | null;
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
    ramp?: boolean;
  }[];
  tags: { id: number; name: string; color: string }[];
  stereo: SongStereo | null;
}

/** A coil a new song starts with: no channel yet, values every coil takes. */
const NEW_COIL = { channelMask: 0, ontimeUs: 40, duty: 0.05 };

@Injectable()
export class SongsService {
  constructor(
    @InjectRepository(Song)
    private readonly songRepository: Repository<Song>,
    @InjectRepository(Tag)
    private readonly tagRepository: Repository<Tag>,
    @InjectRepository(AppConfig)
    private readonly configRepository: Repository<AppConfig>,
    private readonly midi: MidiService,
  ) {}

  async findAll(): Promise<SongResponse[]> {
    const songs = await this.songRepository.find({ relations: ['tags'] });
    return songs.map((song) => this.toResponse(song));
  }

  async create(
    dto: CreateSongDto,
    editorName: string | null = null,
  ): Promise<SongResponse> {
    const song = await this.fromDto(new Song(), dto);
    song.uuid = randomUUID();
    song.midiFile = dto.midiFromSongId
      ? await this.midi.copy(await this.fileOfSong(dto.midiFromSongId), editorName)
      : null;
    this.stampSync(song, editorName);
    const saved = await this.songRepository.save(song);
    return this.findOneOrThrow(saved.id);
  }

  /** A new song from a MIDI file: named after it unless told, no channel on its coils yet. */
  async createFromFile(
    buffer: Buffer,
    fileName: string,
    name: string | undefined,
    coilCount: number,
    editorName: string | null = null,
  ): Promise<SongResponse> {
    const song = new Song();
    song.name = name?.trim() || fileName.replace(/\.(mid|midi|kar)$/i, '');
    song.coilCount = Number.isInteger(coilCount) && coilCount >= 1 && coilCount <= 6
      ? coilCount
      : await this.defaultCoilCount();
    song.mode = 'midi';
    song.output2Mask = 0;
    song.coils = Array.from({ length: song.coilCount }, (_, i) =>
      Object.assign(new Coil(), { coilIndex: i, ...NEW_COIL }),
    );
    song.events = [];
    song.stereo = null;
    song.tags = [];
    song.uuid = randomUUID();
    song.midiFile = await this.midi.create(buffer, fileName, editorName);
    this.stampSync(song, editorName);
    const saved = await this.songRepository.save(song);
    return this.findOneOrThrow(saved.id);
  }

  async update(
    id: number,
    dto: CreateSongDto,
    editorName: string | null = null,
  ): Promise<SongResponse> {
    const song = await this.songRepository.findOne({
      where: { id },
      relations: ['tags'],
    });
    if (!song) {
      throw new NotFoundException(`Song ${id} not found`);
    }
    const replaced = dto.midiFromSongId && dto.midiFromSongId !== id
      ? await this.midi.copy(await this.fileOfSong(dto.midiFromSongId), editorName)
      : null;
    // Replace coils/events wholesale (delete-then-insert). Targeted SQL works
    // regardless of whether the schema declares ON DELETE CASCADE.
    await this.songRepository.query('DELETE FROM "Coil" WHERE song_id = ?', [id]);
    await this.songRepository.query('DELETE FROM "CoilEvent" WHERE song_id = ?', [id]);
    await this.fromDto(song, dto);
    const dropped = replaced ? song.midiFile : null;
    if (replaced) song.midiFile = replaced;
    // uuid is preserved (loaded with the row); only the change signal is bumped.
    this.stampSync(song, editorName);
    await this.songRepository.save(song);
    if (dropped) await this.midi.remove(dropped);
    return this.findOneOrThrow(id);
  }

  /** New notes for the song (the MIDI editor saves through here, a new upload too). */
  async replaceMidi(
    id: number,
    buffer: Buffer,
    fileName: string,
    editorName: string | null = null,
  ): Promise<SongResponse> {
    const song = await this.songRepository.findOne({ where: { id } });
    if (!song) {
      throw new NotFoundException(`Song ${id} not found`);
    }
    song.midiFile = song.midiFile
      ? await this.midi.replace(song.midiFile, buffer, fileName, editorName)
      : await this.midi.create(buffer, fileName, editorName);
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
    if (song.midiFile) await this.midi.remove(song.midiFile);
  }

  private async fileOfSong(id: number): Promise<MidiFile> {
    const from = await this.songRepository.findOne({ where: { id } });
    if (!from?.midiFile) {
      throw new NotFoundException(`Song ${id} has no MIDI file`);
    }
    return from.midiFile;
  }

  private async defaultCoilCount(): Promise<number> {
    const [config] = await this.configRepository.find({ take: 1 });
    const n = config?.defaultCoilCount;
    return n && n >= 1 && n <= 6 ? n : 3;
  }

  private async findOneOrThrow(id: number): Promise<SongResponse> {
    const song = await this.songRepository.findOne({
      where: { id },
      relations: ['tags'],
    });
    if (!song) {
      throw new NotFoundException(`Song ${id} not found`);
    }
    return this.toResponse(song);
  }

  /** Hydrates a Song entity from a DTO (used by both create and update); the file is not its business. */
  private async fromDto(song: Song, dto: CreateSongDto): Promise<Song> {
    song.name = dto.name;
    song.coilCount = dto.coilCount;
    song.mode = dto.mode;
    song.output2Mask = dto.output2Mask;

    song.coils = dto.coils.map((c) => {
      const coil = new Coil();
      coil.coilIndex = c.coilIndex;
      coil.channelMask = c.channelMask;
      coil.ontimeUs = c.ontimeUs;
      coil.duty = c.duty;
      return coil;
    });

    song.events = (dto.events ?? [])
      // a coil point needs a coil, and a song-wide one none
      .filter((e) => (e.param === 'power') === (e.coilIndex === SONG_WIDE))
      .map((e) => {
        const event = new CoilEvent();
        event.coilIndex = e.coilIndex;
        event.atMs = e.atMs;
        event.param = e.param;
        event.value = e.value;
        event.ramp = e.ramp ? true : null;
        return event;
      });

    if (dto.stereo !== undefined) song.stereo = sanitizeStereo(dto.stereo);

    // Left untouched when the payload omits tagIds, so a client that predates
    // tags cannot silently clear them. Unknown ids are dropped rather than
    // inserted as dangling song_tags rows.
    if (dto.tagIds) {
      song.tags = dto.tagIds.length
        ? await this.tagRepository.findBy({ id: In(dto.tagIds) })
        : [];
    }

    return song;
  }

  /** Stamps the sync change-signal (updatedAt + contentHash) from the in-memory
   *  aggregate, plus the server-authoritative editorName. Call once midiFile,
   *  coils and events are the ones to store. */
  private stampSync(song: Song, editorName: string | null): void {
    song.updatedAt = Date.now();
    song.editorName = editorName;
    song.contentHash = hashSong({
      name: song.name,
      coilCount: song.coilCount,
      mode: song.mode,
      output2Mask: song.output2Mask,
      midiFileUuid: song.midiFile?.uuid ?? null,
      midiFileHash: song.midiFile?.contentHash ?? null,
      coils: song.coils ?? [],
      events: song.events ?? [],
      stereo: song.stereo ?? null,
      editorName: song.editorName,
    });
  }

  private toResponse(song: Song): SongResponse {
    const file = song.midiFile;
    return {
      id: song.id,
      name: song.name,
      coilCount: song.coilCount,
      mode: song.mode,
      output2Mask: song.output2Mask,
      editorName: song.editorName ?? null,
      stereo: song.stereo ?? null,
      midiFile: file
        ? {
            id: file.id,
            name: file.name,
            path: file.path,
            durationMs: file.durationMs,
            channels: file.channels ?? null,
            programs: file.programs ?? null,
            editorName: file.editorName ?? null,
            hash: file.contentHash ?? null,
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
        ...(e.ramp ? { ramp: true } : {}),
      })),
      tags: (song.tags ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
      })),
    };
  }
}
