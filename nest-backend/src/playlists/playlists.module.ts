import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Song } from '../songs/entities/song.entity';
import { PlaylistSong } from './entities/playlist-song.entity';
import { Playlist } from './entities/playlist.entity';
import { PlaylistsController } from './playlists.controller';
import { PlaylistsService } from './playlists.service';

@Module({
  // Song is read-only here (to resolve member song uuids for the content hash).
  imports: [TypeOrmModule.forFeature([Playlist, PlaylistSong, Song])],
  controllers: [PlaylistsController],
  providers: [PlaylistsService],
})
export class PlaylistsModule {}
