import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { basename, join } from 'path';
import { Repository } from 'typeorm';
import { UPLOADS_DIR } from '../config/paths';
import { rehashSong, storedName } from '../songs/own-files';
import { hashBytes } from '../sync/content-hash';
import { computeDurationMs } from './midi-duration';
import { MidiFile } from './entities/midi-file.entity';
import { computeChannels, computePrograms } from './midi-channels';

/**
 * A song's MIDI file: its bytes on disk, what they hold (length, channels,
 * instruments) and their sync identity. Each song owns its file (see
 * songs/own-files.ts), so nothing here has to ask who else plays it.
 */
@Injectable()
export class MidiService implements OnModuleInit {
  constructor(
    @InjectRepository(MidiFile)
    private readonly midiFileRepository: Repository<MidiFile>,
  ) {}

  /**
   * Back-fill, at boot, anything missing on existing rows: the play length
   * (column added later), and the sync identity (uuid/updatedAt/contentHash).
   * Acts as a safety net beyond the AddSyncColumns migration — e.g. a file that
   * was unreadable when the migration ran but is present now.
   */
  async onModuleInit(): Promise<void> {
    const files = await this.midiFileRepository.find();
    for (const file of files) {
      const patch: Partial<MidiFile> = {};
      const needDuration = file.durationMs == null;
      const needHash = !file.contentHash;
      const needChannels = file.channels == null;
      const needPrograms = file.programs == null;
      if (needDuration || needHash || needChannels || needPrograms) {
        const buffer = await this.read(file);
        if (buffer) {
          if (needDuration) patch.durationMs = durationOf(buffer);
          if (needHash) patch.contentHash = hashBytes(buffer);
          if (needChannels) patch.channels = channelsOf(buffer);
          if (needPrograms) patch.programs = computePrograms(buffer);
        }
      }
      if (!file.uuid) patch.uuid = randomUUID();
      if (file.updatedAt == null) patch.updatedAt = Date.now();
      if (Object.keys(patch).length > 0) {
        await this.midiFileRepository.update(file.id, patch);
        // the song's hash holds its file's
        if (patch.contentHash) await this.rehashSongsOf(file.id);
      }
    }
  }

  /** A new file from uploaded bytes, named as it was on the sender's disk. */
  async create(
    buffer: Buffer,
    originalName: string,
    editorName: string | null = null,
  ): Promise<MidiFile> {
    assertMidi(buffer);
    const stored = storedName(originalName);
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    await fs.writeFile(join(UPLOADS_DIR, stored), buffer);
    return this.midiFileRepository.save(
      this.midiFileRepository.create({
        name: originalName,
        path: `./uploads/${stored}`,
        ...meta(buffer),
        uuid: randomUUID(),
        updatedAt: Date.now(),
        // Column only — NOT part of contentHash (byte-identity dedupe stays pure).
        editorName,
      }),
    );
  }

  /** Another song's file, bytes included, for a song of its own. */
  async copy(file: MidiFile, editorName: string | null = null): Promise<MidiFile> {
    const buffer = await this.read(file);
    if (!buffer) throw new NotFoundException(`MIDI file of "${file.name}" is missing on disk`);
    return this.create(buffer, file.name ?? 'file.mid', editorName);
  }

  /** New bytes for `file`, written over the old ones; uuid and path stay. */
  async replace(
    file: MidiFile,
    buffer: Buffer,
    name: string,
    editorName: string | null = null,
  ): Promise<MidiFile> {
    assertMidi(buffer);
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    await fs.writeFile(join(UPLOADS_DIR, basename(file.path)), buffer);
    Object.assign(file, meta(buffer), { name, updatedAt: Date.now(), editorName });
    return this.midiFileRepository.save(file);
  }

  async remove(file: MidiFile): Promise<void> {
    await this.midiFileRepository.delete(file.id);
    // Stored paths are of the form "./uploads/<file>"; resolve against the
    // actual uploads directory (which may live at the repository root).
    const name = basename(file.path ?? '');
    if (name) await fs.rm(join(UPLOADS_DIR, name), { force: true });
  }

  /** A file's bytes, or null if unreadable. */
  read(file: MidiFile): Promise<Buffer | null> {
    return fs.readFile(join(UPLOADS_DIR, basename(file.path ?? ''))).catch(() => null);
  }

  private async rehashSongsOf(fileId: number): Promise<void> {
    const query = (sql: string, params?: unknown[]) => this.midiFileRepository.query(sql, params);
    const songs: { id: number }[] = await query(`SELECT id FROM "Song" WHERE midiFile_id = ?`, [fileId]);
    for (const s of songs) await rehashSong(query, s.id);
  }
}

/** The client's extension check only proves a name: the bytes must open as a Standard MIDI File. */
function assertMidi(buffer: Buffer): void {
  if (buffer.length < 14 || buffer.toString('ascii', 0, 4) !== 'MThd') {
    throw new BadRequestException('Not a MIDI file');
  }
}

/** Everything the bytes tell, for the row. */
function meta(buffer: Buffer): Pick<MidiFile, 'durationMs' | 'channels' | 'programs' | 'contentHash'> {
  return {
    durationMs: durationOf(buffer),
    channels: channelsOf(buffer),
    programs: computePrograms(buffer),
    contentHash: hashBytes(buffer),
  };
}

function durationOf(buffer: Buffer): number | null {
  try {
    return computeDurationMs(buffer);
  } catch {
    return null;
  }
}

function channelsOf(buffer: Buffer): number | null {
  try {
    return computeChannels(buffer);
  } catch {
    return null;
  }
}
