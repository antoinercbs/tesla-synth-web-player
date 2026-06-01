import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'fs';
import { basename, join } from 'path';
import { IsNull, Repository } from 'typeorm';
import { UPLOADS_DIR } from '../config/paths';
import { computeDurationMs } from './midi-duration';
import { setMidiPrograms, type ProgramSetting } from './midi-programs';
import { MidiFile } from './entities/midi-file.entity';

/** JSON shape returned to the front, identical to the original Flask output. */
export interface MidiFileResponse {
  id: number;
  name: string;
  path: string;
  durationMs: number | null;
}

@Injectable()
export class MidiService implements OnModuleInit {
  constructor(
    @InjectRepository(MidiFile)
    private readonly midiFileRepository: Repository<MidiFile>,
  ) {}

  /** Back-fill the play length for any file uploaded before the column existed. */
  async onModuleInit(): Promise<void> {
    const pending = await this.midiFileRepository.find({
      where: { durationMs: IsNull() },
    });
    for (const file of pending) {
      const durationMs = await this.durationOf(basename(file.path));
      if (durationMs != null) {
        await this.midiFileRepository.update(file.id, { durationMs });
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
  ): Promise<MidiFileResponse> {
    const midiFile = this.midiFileRepository.create({
      name: originalName,
      path: `./uploads/${storedName}`,
      durationMs: await this.durationOf(storedName),
    });
    const saved = await this.midiFileRepository.save(midiFile);
    return this.toResponse(saved);
  }

  /** Play length (ms) of an uploaded file by its on-disk name, or null on failure. */
  private async durationOf(filename: string): Promise<number | null> {
    try {
      const buffer = await fs.readFile(join(UPLOADS_DIR, filename));
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
    return this.toResponse(midiFile);
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
    };
  }
}
