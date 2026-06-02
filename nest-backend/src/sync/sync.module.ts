import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MidiFile } from '../midi/entities/midi-file.entity';
import { PlaylistSong } from '../playlists/entities/playlist-song.entity';
import { Playlist } from '../playlists/entities/playlist.entity';
import { Coil } from '../songs/entities/coil.entity';
import { CoilEvent } from '../songs/entities/coil-event.entity';
import { Song } from '../songs/entities/song.entity';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Song,
      Coil,
      CoilEvent,
      MidiFile,
      Playlist,
      PlaylistSong,
    ]),
  ],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
