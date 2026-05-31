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
import { CreateSongDto } from './dto/create-song.dto';
import { SongResponse, SongsService } from './songs.service';

@Controller('songs')
export class SongsController {
  constructor(private readonly songsService: SongsService) {}

  @Get()
  findAll(): Promise<SongResponse[]> {
    return this.songsService.findAll();
  }

  @Post()
  create(@Body() dto: CreateSongDto): Promise<SongResponse> {
    return this.songsService.create(dto);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateSongDto,
  ): Promise<SongResponse> {
    return this.songsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<string> {
    await this.songsService.remove(id);
    return 'OK';
  }
}
