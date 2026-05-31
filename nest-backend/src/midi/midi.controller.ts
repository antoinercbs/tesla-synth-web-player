import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<MidiFileResponse> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    return this.midiService.create(file.originalname, file.filename);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<string> {
    await this.midiService.remove(id);
    return 'OK';
  }
}
