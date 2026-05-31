import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Song } from './song.entity';

/** Maps the existing `SysexCommand` table from the Flask schema (schema.sql). */
@Entity({ name: 'SysexCommand' })
export class SysexCommand {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'command', type: 'text', nullable: true })
  command!: string;

  @Column({ name: 'value', type: 'text', nullable: true })
  value!: string;

  /** Position of the command inside its song (kept as `indexInSong` in DB). */
  @Column({ name: 'indexInSong', type: 'integer', nullable: true })
  indexInSong!: number;

  @ManyToOne(() => Song, (song) => song.sysexCommands, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'song_id' })
  song!: Song;
}
