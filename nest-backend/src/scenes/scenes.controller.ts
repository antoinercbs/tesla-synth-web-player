import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { EditorName } from '../auth/editor-name.decorator';
import { SceneDto } from './dto/scene.dto';
import { SceneResponse, ScenesService } from './scenes.service';

@Controller('scenes')
export class ScenesController {
  constructor(private readonly scenesService: ScenesService) {}

  @Get()
  findAll(): Promise<SceneResponse[]> {
    return this.scenesService.findAll();
  }

  @Post()
  create(@Body() dto: SceneDto, @EditorName() editorName: string | null): Promise<SceneResponse> {
    return this.scenesService.create(dto, editorName);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SceneDto,
    @EditorName() editorName: string | null,
  ): Promise<SceneResponse> {
    return this.scenesService.update(id, dto, editorName);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<string> {
    await this.scenesService.remove(id);
    return 'OK';
  }
}
