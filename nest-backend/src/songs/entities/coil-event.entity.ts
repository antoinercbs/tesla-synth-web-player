import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Song } from './song.entity';

export type CoilEventParam = 'ontime' | 'duty' | 'power';

/** coilIndex of the song-wide power points (param 'power'): they scale every coil. */
export const SONG_WIDE = -1;

/**
 * A point of a song's power automation: a coil's ontime or duty, or (coilIndex
 * -1, param 'power') the whole song's power, which multiplies them.
 */
@Entity({ name: 'CoilEvent' })
export class CoilEvent {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'coilIndex', type: 'integer' })
  coilIndex!: number;

  /** Offset from song start, in milliseconds. */
  @Column({ name: 'atMs', type: 'integer' })
  atMs!: number;

  @Column({ name: 'param', type: 'text' })
  param!: CoilEventParam;

  /** A ratio of the coil's configured value (1 = 100%). */
  @Column({ name: 'value', type: 'real' })
  value!: number;

  /** Reached by a linear ramp from the previous point of its curve; else a step. */
  @Column({ name: 'ramp', type: 'boolean', nullable: true })
  ramp!: boolean | null;

  @ManyToOne(() => Song, (song) => song.events, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'song_id' })
  song!: Song;
}
