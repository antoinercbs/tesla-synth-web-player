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
  create(@Body() dto: CreatePlaylistDto): Promise<PlaylistResponse> {
    return this.playlistsService.create(dto);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreatePlaylistDto,
  ): Promise<PlaylistResponse> {
    return this.playlistsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<string> {
    await this.playlistsService.remove(id);
    return 'OK';
  }
}
