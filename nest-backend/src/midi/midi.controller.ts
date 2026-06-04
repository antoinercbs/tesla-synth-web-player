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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { EditorName } from '../auth/editor-name.decorator';
import { SetProgramsDto } from './dto/set-programs.dto';
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
    return this.midiService.create(file.originalname, file.filename, editorName);
  }

  /**
   * Rewrite the per-channel instruments (Program Changes) of the MIDI FILE.
   * This edits the file on disk → it affects every song that uses it.
   */
  @Patch(':id/programs')
  setPrograms(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetProgramsDto,
    @EditorName() editorName: string | null,
  ): Promise<MidiFileResponse> {
    return this.midiService.setPrograms(id, dto.programs, editorName);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<string> {
    await this.midiService.remove(id);
    return 'OK';
  }
}
