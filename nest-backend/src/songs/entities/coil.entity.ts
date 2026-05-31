import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Song } from './song.entity';

/**
 * Per-song, per-coil configuration. Replaces the old SysexCommand rows: the
 * browser compiles these into Syntherrupter SysEx on demand.
 */
@Entity({ name: 'Coil' })
@Unique('UQ_coil_song_index', ['song', 'coilIndex'])
export class Coil {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  /** 0-based coil index within the song (0..5). */
  @Column({ name: 'coilIndex', type: 'integer' })
  coilIndex!: number;

  /** 16-bit mask: bit i set => MIDI channel i feeds this coil. */
  @Column({ name: 'channelMask', type: 'integer', default: 0 })
  channelMask!: number;

  /** Ontime in microseconds. */
  @Column({ name: 'ontimeUs', type: 'integer', default: 0 })
  ontimeUs!: number;

  /** Duty as a fraction (0..1), stored as a float to match the wire format. */
  @Column({ name: 'duty', type: 'real', default: 0 })
  duty!: number;

  @ManyToOne(() => Song, (song) => song.coils, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'song_id' })
  song!: Song;
}
