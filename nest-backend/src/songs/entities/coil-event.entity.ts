import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Song } from './song.entity';

export type CoilEventParam = 'ontime' | 'duty';

/**
 * A mid-song parameter change scheduled at a point in time. The authoring UI
 * lands in a later milestone; the table ships now so the model is stable.
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

  /** Ontime µs when param='ontime', duty fraction when param='duty'. */
  @Column({ name: 'value', type: 'real' })
  value!: number;

  @ManyToOne(() => Song, (song) => song.events, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'song_id' })
  song!: Song;
}
