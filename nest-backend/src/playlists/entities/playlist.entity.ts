import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { PlaylistSong } from './playlist-song.entity';

/** Maps the existing `Playlist` table from the Flask schema (schema.sql). */
@Entity({ name: 'Playlist' })
export class Playlist {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'name', type: 'text', nullable: true })
  name!: string;

  @OneToMany(() => PlaylistSong, (playlistSong) => playlistSong.playlist, {
    cascade: true,
    eager: true,
  })
  playlistSongs!: PlaylistSong[];
}
