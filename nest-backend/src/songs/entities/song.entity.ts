import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MidiFile } from '../../midi/entities/midi-file.entity';
import { SysexCommand } from './sysex-command.entity';

/** Maps the existing `Song` table from the Flask schema (schema.sql). */
@Entity({ name: 'Song' })
export class Song {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'name', type: 'text', nullable: true })
  name!: string;

  @Column({ name: 'output_mapping_1', type: 'integer', nullable: true })
  outputMapping1!: number;

  @Column({ name: 'output_mapping_2', type: 'integer', nullable: true })
  outputMapping2!: number;

  @ManyToOne(() => MidiFile, {
    eager: true,
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'midiFile_id' })
  midiFile!: MidiFile | null;

  @OneToMany(() => SysexCommand, (sysex) => sysex.song, {
    cascade: true,
    eager: true,
  })
  sysexCommands!: SysexCommand[];
}
