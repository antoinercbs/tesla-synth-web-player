import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'fs';
import { basename, join } from 'path';
import { Repository } from 'typeorm';
import { UPLOADS_DIR } from '../config/paths';
import { MidiFile } from './entities/midi-file.entity';

/** JSON shape returned to the front, identical to the original Flask output. */
export interface MidiFileResponse {
  id: number;
  name: string;
  path: string;
}

@Injectable()
export class MidiService {
  constructor(
    @InjectRepository(MidiFile)
    private readonly midiFileRepository: Repository<MidiFile>,
  ) {}

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
    });
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
    return { id: midiFile.id, name: midiFile.name, path: midiFile.path };
  }
}
