import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { midiUploadOptions } from '../midi/midi-upload.config';
import { ApplyRequestDto, PullRequestDto, UploadFileDto } from './dto/sync.dto';
import {
  ApplyResult,
  MidiFilePayload,
  PullResponse,
  SyncManifest,
  SyncService,
} from './sync.service';

/**
 * Peer-to-peer sync surface (`/api/sync/*`). The SAME module runs on the server
 * and inside the Electron app; the Electron app is the orchestrator that reads
 * its local backend on 127.0.0.1 and the remote one over HTTP (basic auth).
 */
@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  /** Lightweight {uuid, updatedAt, contentHash, name} per syncable parent. */
  @Get('manifest')
  manifest(): Promise<SyncManifest> {
    return this.syncService.manifest();
  }

  /** Full payloads for the requested uuids (per type). */
  @Post('pull')
  pull(@Body() dto: PullRequestDto): Promise<PullResponse> {
    return this.syncService.pull(dto);
  }

  /** Streams a MIDI file's bytes by its sync uuid. */
  @Get('file/:uuid')
  getFile(@Param('uuid') uuid: string): Promise<StreamableFile> {
    return this.syncService.getFileStream(uuid);
  }

  /** Receives a MIDI file's bytes + metadata; upserts the MidiFile by uuid. */
  @Post('file')
  @UseInterceptors(FileInterceptor('file', midiUploadOptions))
  receiveFile(
    @Body() dto: UploadFileDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<MidiFilePayload> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    return this.syncService.receiveFile(file, dto);
  }

  /** Idempotent upsert-by-uuid of a batch of songs then playlists. */
  @Post('apply')
  apply(@Body() dto: ApplyRequestDto): Promise<ApplyResult> {
    return this.syncService.apply(dto);
  }
}
