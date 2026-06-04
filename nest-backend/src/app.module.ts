import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { PUBLIC_DIR, UPLOADS_DIR_ABS } from './config/paths';
import { dataSourceOptions } from './database/data-source';
import { DownloadsModule } from './downloads/downloads.module';
import { HealthModule } from './health/health.module';
import { MidiModule } from './midi/midi.module';
import { PlaylistsModule } from './playlists/playlists.module';
import { SettingsModule } from './settings/settings.module';
import { SongsModule } from './songs/songs.module';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [
    // Schema is owned by schema.sql (baseline) + TypeORM migrations, which run
    // automatically on boot (migrationsRun). synchronize stays off.
    TypeOrmModule.forRoot({
      ...dataSourceOptions,
      migrationsRun: true,
    }),
    // Serve uploaded MIDI files at /uploads/<file> (matches the stored paths).
    // nosniff so a stored file can never be interpreted as anything but its
    // declared (audio/midi) type, regardless of its bytes.
    ServeStaticModule.forRoot({
      rootPath: UPLOADS_DIR_ABS,
      serveRoot: '/uploads',
      serveStaticOptions: {
        setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
      },
    }),
    // Serve the built front-end (production) from public/.
    ServeStaticModule.forRoot({
      rootPath: PUBLIC_DIR,
    }),
    // AuthModule registers the global OIDC guard (a no-op unless OIDC_ISSUER is
    // set), so it must be present for every other module's routes to be gated.
    AuthModule,
    HealthModule,
    SongsModule,
    MidiModule,
    PlaylistsModule,
    SettingsModule,
    SyncModule,
    DownloadsModule,
  ],
})
export class AppModule {}
