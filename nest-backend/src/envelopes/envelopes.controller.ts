import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { EditorName } from '../auth/editor-name.decorator';
import { EnvelopeDto } from './dto/envelope.dto';
import { EnvelopeResponse, EnvelopesService } from './envelopes.service';

@Controller('envelopes')
export class EnvelopesController {
  constructor(private readonly envelopesService: EnvelopesService) {}

  @Get()
  findAll(): Promise<EnvelopeResponse[]> {
    return this.envelopesService.findAll();
  }

  @Post()
  create(
    @Body() dto: EnvelopeDto,
    @EditorName() editorName: string | null,
  ): Promise<EnvelopeResponse> {
    return this.envelopesService.create(dto, editorName);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EnvelopeDto,
    @EditorName() editorName: string | null,
  ): Promise<EnvelopeResponse> {
    return this.envelopesService.update(id, dto, editorName);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<string> {
    await this.envelopesService.remove(id);
    return 'OK';
  }
}
