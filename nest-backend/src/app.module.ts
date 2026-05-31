import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DATABASE_PATH, PUBLIC_DIR, UPLOADS_DIR_ABS } from './config/paths';
import { HealthModule } from './health/health.module';
import { MidiFile } from './midi/entities/midi-file.entity';
import { MidiModule } from './midi/midi.module';
import { PlaylistSong } from './playlists/entities/playlist-song.entity';
import { Playlist } from './playlists/entities/playlist.entity';
import { PlaylistsModule } from './playlists/playlists.module';
import { Song } from './songs/entities/song.entity';
import { SysexCommand } from './songs/entities/sysex-command.entity';
import { SongsModule } from './songs/songs.module';
import { SyfohModule } from './syfoh/syfoh.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: DATABASE_PATH,
      entities: [Song, SysexCommand, MidiFile, Playlist, PlaylistSong],
      // The schema is owned by schema.sql (run `npm run init:db`); TypeORM does
      // not manage migrations here to keep parity with the Flask backend.
      synchronize: false,
    }),
    // Serve uploaded MIDI files at /uploads/<file> (matches the stored paths).
    ServeStaticModule.forRoot({
      rootPath: UPLOADS_DIR_ABS,
      serveRoot: '/uploads',
    }),
    // Serve the built front-end (production) from public/.
    ServeStaticModule.forRoot({
      rootPath: PUBLIC_DIR,
    }),
    HealthModule,
    SongsModule,
    MidiModule,
    PlaylistsModule,
    SyfohModule,
  ],
})
export class AppModule {}
