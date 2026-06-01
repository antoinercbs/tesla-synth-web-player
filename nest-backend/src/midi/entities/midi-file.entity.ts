import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Maps the existing `MidiFile` table from the Flask schema (schema.sql). */
@Entity({ name: 'MidiFile' })
export class MidiFile {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'name', type: 'text', nullable: true })
  name!: string;

  @Column({ name: 'path', type: 'text', nullable: true })
  path!: string;

  /** Total play length in milliseconds (computed from the MIDI file). */
  @Column({ name: 'durationMs', type: 'integer', nullable: true })
  durationMs!: number | null;
}
