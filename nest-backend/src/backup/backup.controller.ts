import {
  BadRequestException,
  Controller,
  Get,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { BackupService, RestoreResult } from './backup.service';

/** A library of MIDI files in base64 stays well under this; the cap bounds memory. */
const MAX_BACKUP_BYTES = 256 * 1024 * 1024;

/**
 * The whole library as one file (`GET /api/backup`), and back (`POST`, the file
 * as multipart `file`). Behind the same login as every other route.
 */
@Controller('backup')
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  @Get()
  async download(): Promise<StreamableFile> {
    const data = await this.backup.export();
    const day = new Date(data.exportedAt).toISOString().slice(0, 10);
    return new StreamableFile(Buffer.from(JSON.stringify(data)), {
      type: 'application/json',
      disposition: `attachment; filename="tesla-player-${day}.json"`,
    });
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_BACKUP_BYTES } }))
  async restore(@UploadedFile() file?: Express.Multer.File): Promise<RestoreResult> {
    if (!file) throw new BadRequestException('No file provided');
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.buffer.toString('utf8'));
    } catch {
      throw new BadRequestException('Not a Tesla Player backup');
    }
    return this.backup.restore(parsed);
  }
}
