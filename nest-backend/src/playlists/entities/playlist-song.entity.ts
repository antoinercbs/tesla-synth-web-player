import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Playlist } from './playlist.entity';

/** Maps the existing `PlaylistSong` join table from the Flask schema. */
@Entity({ name: 'PlaylistSong' })
export class PlaylistSong {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  /** Ordering of the song within the playlist (kept as `idx` in DB). */
  @Column({ name: 'idx', type: 'integer', nullable: true })
  idx!: number;

  @Column({ name: 'song_id', type: 'integer', nullable: true })
  songId!: number;

  @ManyToOne(() => Playlist, (playlist) => playlist.playlistSongs, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'playlist_id' })
  playlist!: Playlist;
}
