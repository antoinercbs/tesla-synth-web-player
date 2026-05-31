import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PUBLIC_DIR, UPLOADS_DIR_ABS } from './config/paths';
import { dataSourceOptions } from './database/data-source';
import { HealthModule } from './health/health.module';
import { MidiModule } from './midi/midi.module';
import { PlaylistsModule } from './playlists/playlists.module';
import { SongsModule } from './songs/songs.module';

@Module({
  imports: [
    // Schema is owned by schema.sql (baseline) + TypeORM migrations, which run
    // automatically on boot (migrationsRun). synchronize stays off.
    TypeOrmModule.forRoot({
      ...dataSourceOptions,
      migrationsRun: true,
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
  ],
})
export class AppModule {}
