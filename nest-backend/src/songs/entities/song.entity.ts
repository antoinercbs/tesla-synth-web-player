import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MidiFile } from '../../midi/entities/midi-file.entity';
import { Coil } from './coil.entity';
import { CoilEvent } from './coil-event.entity';

/** 'midi' = firmware MIDI mode (normal playback + live); 'simple' = fixed mode. */
export type PlaybackMode = 'midi' | 'simple';

/** A song: its MIDI file plus the structured per-coil configuration. */
@Entity({ name: 'Song' })
export class Song {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'name', type: 'text', nullable: true })
  name!: string;

  /** Number of physical coils this song is authored for (1..6). */
  @Column({ name: 'coilCount', type: 'integer', default: 1 })
  coilCount!: number;

  @Column({ name: 'mode', type: 'text', default: 'midi' })
  mode!: PlaybackMode;

  /** 16-bit mask of channels mirrored to the second (speaker) output. */
  @Column({ name: 'output2Mask', type: 'integer', default: 0 })
  output2Mask!: number;

  @ManyToOne(() => MidiFile, {
    eager: true,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'midiFile_id' })
  midiFile!: MidiFile | null;

  @OneToMany(() => Coil, (coil) => coil.song, { cascade: true, eager: true })
  coils!: Coil[];

  @OneToMany(() => CoilEvent, (event) => event.song, { cascade: true, eager: true })
  events!: CoilEvent[];
}
