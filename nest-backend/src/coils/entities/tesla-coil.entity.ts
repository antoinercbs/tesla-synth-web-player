import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A real Tesla coil of the club's inventory. Its spec (dimensions, primary, MMC,
 * bridge, OCD, outlet tube...) is the front's: the server keeps it as given and
 * only hashes it. `position` orders the inventory; until songs pick their coils,
 * the coil at position k is the one on output k.
 */
@Entity({ name: 'TeslaCoil' })
export class TeslaCoil {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'uuid', type: 'text', unique: true })
  uuid!: string;

  @Column({ name: 'name', type: 'text' })
  name!: string;

  @Column({ name: 'position', type: 'integer', default: 0 })
  position!: number;

  @Column({ name: 'spec', type: 'simple-json' })
  spec!: Record<string, unknown>;

  /** Coils sharing a group are twins: built alike, one plays for another. */
  @Column({ name: 'twinGroup', type: 'text', nullable: true })
  twinGroup!: string | null;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'updatedAt', type: 'integer', nullable: true })
  updatedAt!: number;

  @Column({ name: 'contentHash', type: 'text', nullable: true })
  contentHash!: string;

  @Column({ name: 'editorName', type: 'text', nullable: true })
  editorName!: string | null;
}
