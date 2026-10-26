import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { EditorName } from '../auth/editor-name.decorator';
import { TeslaCoilDto, TeslaCoilOrderDto } from './dto/tesla-coil.dto';
import { CoilsService, TeslaCoilResponse } from './coils.service';

@Controller('coils')
export class CoilsController {
  constructor(private readonly coilsService: CoilsService) {}

  @Get()
  findAll(): Promise<TeslaCoilResponse[]> {
    return this.coilsService.findAll();
  }

  @Post()
  create(@Body() dto: TeslaCoilDto, @EditorName() editorName: string | null): Promise<TeslaCoilResponse> {
    return this.coilsService.create(dto, editorName);
  }

  @Put('order')
  reorder(@Body() dto: TeslaCoilOrderDto, @EditorName() editorName: string | null): Promise<TeslaCoilResponse[]> {
    return this.coilsService.reorder(dto.ids, editorName);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TeslaCoilDto,
    @EditorName() editorName: string | null,
  ): Promise<TeslaCoilResponse> {
    return this.coilsService.update(id, dto, editorName);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<string> {
    await this.coilsService.remove(id);
    return 'OK';
  }
}
