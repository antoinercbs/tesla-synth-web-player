import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { EditorName } from '../auth/editor-name.decorator';
import { midiUploadOptions } from './midi-upload.config';
import { MidiFileResponse, MidiService } from './midi.service';

@Controller('midi')
export class MidiController {
  constructor(private readonly midiService: MidiService) {}

  @Get()
  findAll(): Promise<MidiFileResponse[]> {
    return this.midiService.findAll();
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', midiUploadOptions))
  upload(
    @EditorName() editorName: string | null,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<MidiFileResponse> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    const nameWithoutExt = file.originalname.replace(/\.[^/.]+$/, '');
    return this.midiService.create(nameWithoutExt, file.filename, editorName);
  }

  /**
   * Swap the bytes of an existing entry, keeping its path and uuid (the MIDI
   * editor saves through here). This edits the FILE → it affects every song that
   * uses it (their per-coil channel masks are NOT remapped). The library name is kept: it may
   * have been chosen through :id/name and is not tied to the file on disk.
   *
   * No `storage` here on purpose — the default memory storage is what gives us
   * `file.buffer` to hash and to write over the existing path.
   */
  @Put(':id/file')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: midiUploadOptions.limits,
      fileFilter: midiUploadOptions.fileFilter,
    }),
  )
  replaceFile(
    @Param('id', ParseIntPipe) id: number,
    @EditorName() editorName: string | null,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<MidiFileResponse> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    return this.midiService.replaceFile(id, file.buffer, editorName);
  }

  @Patch(':id/name')
  rename(
    @Param('id', ParseIntPipe) id: number,
    @Body('name') name: string,
    @EditorName() editorName: string | null,
  ): Promise<MidiFileResponse> {
    const trimmed = (name ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('Name cannot be empty');
    }
    return this.midiService.rename(id, trimmed, editorName);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<string> {
    await this.midiService.remove(id);
    return 'OK';
  }
}
