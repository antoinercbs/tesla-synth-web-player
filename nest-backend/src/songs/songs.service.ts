import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MidiFile } from '../midi/entities/midi-file.entity';
import { CreateSongDto } from './dto/create-song.dto';
import { Song } from './entities/song.entity';
import { SysexCommand } from './entities/sysex-command.entity';

/** JSON shape returned to the front, identical to the original Flask output. */
export interface SongResponse {
  id: number;
  name: string;
  outputMapping1: number;
  outputMapping2: number;
  sysex: { command: string; value: string; idx: number }[];
  // Always an object, even when no file is associated (id/name/path null).
  // This matches the original Flask json_object output, which the front relies
  // on (it reads song.midiFile.name / .id without a null guard).
  midiFile: {
    id: number | null;
    name: string | null;
    path: string | null;
  };
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

  async create(dto: CreateSongDto): Promise<SongResponse> {
    const song = await this.fromDto(new Song(), dto);
    const saved = await this.songRepository.save(song);
    return this.findOneOrThrow(saved.id);
  }

  async update(id: number, dto: CreateSongDto): Promise<SongResponse> {
    const song = await this.songRepository.findOne({ where: { id } });
    if (!song) {
      throw new NotFoundException(`Song ${id} not found`);
    }
    // Replace the sysex commands wholesale (delete-then-insert, like Flask).
    // Done with a targeted statement so it works regardless of whether the
    // database schema declares ON DELETE CASCADE.
    await this.songRepository.query(
      'DELETE FROM SysexCommand WHERE song_id = ?',
      [id],
    );
    await this.fromDto(song, dto);
    await this.songRepository.save(song);
    return this.findOneOrThrow(id);
  }

  async remove(id: number): Promise<void> {
    const song = await this.songRepository.findOne({ where: { id } });
    if (!song) {
      throw new NotFoundException(`Song ${id} not found`);
    }
    // Clean up dependents first so the delete works even when the schema has
    // no ON DELETE CASCADE (the existing Flask-created database.db).
    await this.songRepository.query(
      'DELETE FROM SysexCommand WHERE song_id = ?',
      [id],
    );
    await this.songRepository.query(
      'DELETE FROM PlaylistSong WHERE song_id = ?',
      [id],
    );
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
    song.outputMapping1 = dto.outputMapping1;
    song.outputMapping2 = dto.outputMapping2;

    const midiFileId = dto.resolvedMidiFileId;
    song.midiFile = midiFileId
      ? await this.midiFileRepository.findOne({ where: { id: midiFileId } })
      : null;

    song.sysexCommands = dto.sysex.map((sysex, idx) => {
      const command = new SysexCommand();
      command.command = sysex.command ?? '';
      command.value = sysex.value;
      command.indexInSong = idx;
      return command;
    });
    return song;
  }

  private toResponse(song: Song): SongResponse {
    const sysex = [...(song.sysexCommands ?? [])]
      .sort((a, b) => a.indexInSong - b.indexInSong)
      .map((command) => ({
        command: command.command,
        value: command.value,
        idx: command.indexInSong,
      }));

    return {
      id: song.id,
      name: song.name,
      outputMapping1: song.outputMapping1,
      outputMapping2: song.outputMapping2,
      sysex,
      midiFile: song.midiFile
        ? {
            id: song.midiFile.id,
            name: song.midiFile.name,
            path: song.midiFile.path,
          }
        : { id: null, name: null, path: null },
    };
  }
}
