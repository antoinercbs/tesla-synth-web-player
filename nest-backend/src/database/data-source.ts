import { DataSource, DataSourceOptions } from 'typeorm';
import { DATABASE_PATH } from '../config/paths';
import { MidiFile } from '../midi/entities/midi-file.entity';
import { PlaylistSong } from '../playlists/entities/playlist-song.entity';
import { Playlist } from '../playlists/entities/playlist.entity';
import { AppConfig } from '../settings/entities/app-config.entity';
import { Coil } from '../songs/entities/coil.entity';
import { CoilEvent } from '../songs/entities/coil-event.entity';
import { Song } from '../songs/entities/song.entity';
import { CoilModel1717200000000 } from './migrations/1717200000000-CoilModel';
import { PlaylistCoilCount1717300000000 } from './migrations/1717300000000-PlaylistCoilCount';
import { MidiFileDuration1717400000000 } from './migrations/1717400000000-MidiFileDuration';
import { AppConfig1717500000000 } from './migrations/1717500000000-AppConfig';
import { AddSyncColumns1717600000000 } from './migrations/1717600000000-AddSyncColumns';
import { AddEditorName1717700000000 } from './migrations/1717700000000-AddEditorName';

/**
 * Shared TypeORM configuration, used both by the Nest app (app.module) and the
 * TypeORM CLI (migration:run / migration:revert). Migrations are listed
 * explicitly (not via a glob) so the same array resolves under ts-node and the
 * compiled build alike.
 */
export const dataSourceOptions: DataSourceOptions = {
  type: 'sqlite',
  database: DATABASE_PATH,
  entities: [Song, Coil, CoilEvent, MidiFile, Playlist, PlaylistSong, AppConfig],
  migrations: [
    CoilModel1717200000000,
    PlaylistCoilCount1717300000000,
    MidiFileDuration1717400000000,
    AppConfig1717500000000,
    AddSyncColumns1717600000000,
    AddEditorName1717700000000,
  ],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false,
};

export default new DataSource(dataSourceOptions);
