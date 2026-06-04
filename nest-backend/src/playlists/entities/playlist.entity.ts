import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { PlaylistSong } from './playlist-song.entity';

/** Maps the existing `Playlist` table from the Flask schema (schema.sql). */
@Entity({ name: 'Playlist' })
export class Playlist {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'name', type: 'text', nullable: true })
  name!: string;

  /** Tesla-coil count this playlist targets (1..6). Only songs with the same
   *  coilCount are meant to play; default 3. */
  @Column({ name: 'coilCount', type: 'integer', default: 3 })
  coilCount!: number;

  @OneToMany(() => PlaylistSong, (playlistSong) => playlistSong.playlist, {
    cascade: true,
    eager: true,
  })
  playlistSongs!: PlaylistSong[];

  /**
   * Sync identity (see SyncModule). Stable across instances: generated once on
   * create, preserved on apply. The UNIQUE index is created by the
   * AddSyncColumns migration (nullable here to match the ALTER path).
   */
  @Column({ name: 'uuid', type: 'text', nullable: true })
  uuid!: string;

  /** Epoch ms of the last content change. Default "newer wins" hint for sync. */
  @Column({ name: 'updatedAt', type: 'integer', nullable: true })
  updatedAt!: number;

  /** sha256 of the normalized aggregate (name + coilCount + ordered song uuids). */
  @Column({ name: 'contentHash', type: 'text', nullable: true })
  contentHash!: string;

  /** "prénom nom" of who last edited this, stamped server-side from the OIDC
   *  token. Null when auth is off / no identity. Travels with the entity on sync. */
  @Column({ name: 'editorName', type: 'text', nullable: true })
  editorName!: string | null;
}
