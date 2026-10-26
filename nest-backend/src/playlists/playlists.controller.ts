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
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { PlaylistResponse, PlaylistsService } from './playlists.service';

@Controller('playlists')
export class PlaylistsController {
  constructor(private readonly playlistsService: PlaylistsService) {}

  @Get()
  findAll(): Promise<PlaylistResponse[]> {
    return this.playlistsService.findAll();
  }

  @Post()
  create(
    @Body() dto: CreatePlaylistDto,
    @EditorName() editorName: string | null,
  ): Promise<PlaylistResponse> {
    return this.playlistsService.create(dto, editorName);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreatePlaylistDto,
    @EditorName() editorName: string | null,
  ): Promise<PlaylistResponse> {
    return this.playlistsService.update(id, dto, editorName);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<string> {
    await this.playlistsService.remove(id);
    return 'OK';
  }
}
