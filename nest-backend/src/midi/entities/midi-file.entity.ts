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

  /**
   * Sync identity (see SyncModule). Stable across instances: generated once on
   * create, preserved on apply. The UNIQUE index is created by the
   * AddSyncColumns migration (nullable here to match the ALTER path).
   */
  @Column({ name: 'uuid', type: 'text', nullable: true })
  uuid!: string;

  /** Epoch ms of the last content change. Used as the default "newer wins" hint. */
  @Column({ name: 'updatedAt', type: 'integer', nullable: true })
  updatedAt!: number;

  /** sha256 of the file BYTES — the file's identity for dedupe/transfer-skip. */
  @Column({ name: 'contentHash', type: 'text', nullable: true })
  contentHash!: string;
}
