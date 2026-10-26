import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { EditorName } from '../auth/editor-name.decorator';
import { songMidiUploadOptions } from '../midi/midi-upload.config';
import { CreateSongDto } from './dto/create-song.dto';
import { SongResponse, SongsService } from './songs.service';

/**
 * Multer reads a part's filename as latin1: a UTF-8 name ("Hymne à la
 * joie.mid") arrives mangled. Read back as UTF-8 unless that breaks it.
 */
function uploadedName(file: Express.Multer.File): string {
  const utf8 = Buffer.from(file.originalname, 'latin1').toString('utf8');
  return utf8.includes('�') ? file.originalname : utf8;
}

@Controller('songs')
export class SongsController {
  constructor(private readonly songsService: SongsService) {}

  @Get()
  findAll(): Promise<SongResponse[]> {
    return this.songsService.findAll();
  }

  @Post()
  create(
    @Body() dto: CreateSongDto,
    @EditorName() editorName: string | null,
  ): Promise<SongResponse> {
    return this.songsService.create(dto, editorName);
  }

  /** A new song from its MIDI file (multipart `file`; `name` and `coilCount` optional). */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', songMidiUploadOptions))
  createFromFile(
    @EditorName() editorName: string | null,
    @UploadedFile() file?: Express.Multer.File,
    @Body('name') name?: string,
    @Body('coilCount') coilCount?: string,
  ): Promise<SongResponse> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    return this.songsService.createFromFile(file.buffer, uploadedName(file), name, Number(coilCount), editorName);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateSongDto,
    @EditorName() editorName: string | null,
  ): Promise<SongResponse> {
    return this.songsService.update(id, dto, editorName);
  }

  /** New bytes for the song's MIDI file (multipart `file`): the MIDI editor's save, or another file. */
  @Put(':id/midi')
  @UseInterceptors(FileInterceptor('file', songMidiUploadOptions))
  replaceMidi(
    @Param('id', ParseIntPipe) id: number,
    @EditorName() editorName: string | null,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<SongResponse> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    return this.songsService.replaceMidi(id, file.buffer, uploadedName(file), editorName);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<string> {
    await this.songsService.remove(id);
    return 'OK';
  }
}
