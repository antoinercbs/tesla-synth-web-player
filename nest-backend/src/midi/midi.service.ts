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
import { hashBytes } from '../sync/content-hash';
import { computeDurationMs } from './midi-duration';
import { setMidiPrograms, type ProgramSetting } from './midi-programs';
import { MidiFile } from './entities/midi-file.entity';

/** JSON shape returned to the front, identical to the original Flask output. */
export interface MidiFileResponse {
  id: number;
  name: string;
  path: string;
  durationMs: number | null;
  /** Who last uploaded/edited this (server-stamped from the OIDC token), or null. */
  editorName: string | null;
}

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
      if (needDuration || needHash) {
        const buffer = await this.readUpload(basename(file.path));
        if (buffer) {
          if (needDuration) patch.durationMs = this.durationFromBuffer(buffer);
          if (needHash) patch.contentHash = hashBytes(buffer);
        }
      }
      if (!file.uuid) patch.uuid = randomUUID();
      if (file.updatedAt == null) patch.updatedAt = Date.now();
      if (Object.keys(patch).length > 0) {
        await this.midiFileRepository.update(file.id, patch);
      }
    }
  }

  async findAll(): Promise<MidiFileResponse[]> {
    const files = await this.midiFileRepository.find();
    return files.map((file) => this.toResponse(file));
  }

  /**
   * Records an uploaded file. `storedName` is the on-disk filename produced by
   * Multer; `path` is kept in the `./uploads/<name>` form expected by the front
   * (the player does `path.substring(1)` to build the `/uploads/...` URL).
   */
  async create(
    originalName: string,
    storedName: string,
    editorName: string | null = null,
  ): Promise<MidiFileResponse> {
    const buffer = await this.readUpload(storedName);
    const midiFile = this.midiFileRepository.create({
      name: originalName,
      path: `./uploads/${storedName}`,
      durationMs: this.durationFromBuffer(buffer),
      uuid: randomUUID(),
      updatedAt: Date.now(),
      contentHash: buffer ? hashBytes(buffer) : undefined,
      // Column only — NOT part of contentHash (byte-identity dedupe stays pure).
      editorName,
    });
    const saved = await this.midiFileRepository.save(midiFile);
    return this.toResponse(saved);
  }

  /** Reads an uploaded file's bytes by on-disk name, or null if unreadable. */
  private async readUpload(filename: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(join(UPLOADS_DIR, filename));
    } catch {
      return null;
    }
  }

  /** Play length (ms) from an in-memory buffer, or null on failure. */
  private durationFromBuffer(buffer: Buffer | null): number | null {
    if (!buffer) return null;
    try {
      return computeDurationMs(buffer);
    } catch {
      return null;
    }
  }

  /**
   * Rewrite the on-disk MIDI file so each given channel plays the chosen
   * instrument (program) from the start. This edits the FILE itself, so it
   * affects every song that references it. Returns the (unchanged-metadata)
   * file record.
   */
  async setPrograms(
    id: number,
    programs: ProgramSetting[],
    editorName: string | null = null,
  ): Promise<MidiFileResponse> {
    const midiFile = await this.midiFileRepository.findOne({ where: { id } });
    if (!midiFile) {
      throw new NotFoundException(`MIDI file ${id} not found`);
    }
    const filePath = join(UPLOADS_DIR, basename(midiFile.path));
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(filePath);
    } catch {
      throw new NotFoundException(`MIDI file ${id} is missing on disk`);
    }
    let rewritten: Buffer;
    try {
      rewritten = setMidiPrograms(buffer, programs);
    } catch {
      throw new BadRequestException('Could not parse/rewrite the MIDI file');
    }
    await fs.writeFile(filePath, rewritten);
    // The file bytes changed → its sync identity must change too, otherwise two
    // peers would carry different bytes while reporting the same contentHash.
    midiFile.contentHash = hashBytes(rewritten);
    midiFile.updatedAt = Date.now();
    midiFile.editorName = editorName;
    const saved = await this.midiFileRepository.save(midiFile);
    return this.toResponse(saved);
  }

  async remove(id: number): Promise<void> {
    const midiFile = await this.midiFileRepository.findOne({ where: { id } });
    if (!midiFile) {
      throw new NotFoundException(`MIDI file ${id} not found`);
    }
    // Detach the file from any song first so the delete does not trip a foreign
    // key constraint (the existing database.db has no ON DELETE SET NULL).
    await this.midiFileRepository.query(
      'UPDATE Song SET midiFile_id = NULL WHERE midiFile_id = ?',
      [id],
    );
    await this.midiFileRepository.delete(id);
    // Stored paths are of the form "./uploads/<file>"; resolve against the
    // actual uploads directory (which may live at the repository root).
    await fs.rm(join(UPLOADS_DIR, basename(midiFile.path)), { force: true });
  }

  private toResponse(midiFile: MidiFile): MidiFileResponse {
    return {
      id: midiFile.id,
      name: midiFile.name,
      path: midiFile.path,
      durationMs: midiFile.durationMs,
      editorName: midiFile.editorName ?? null,
    };
  }
}
