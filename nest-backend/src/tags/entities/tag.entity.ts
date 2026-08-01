import { Column, Entity, ManyToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Song } from '../../songs/entities/song.entity';

/**
 * A free-form song label. No sync identity on purpose (no uuid/updatedAt/
 * contentHash): tags stay local to an instance — see the README design notes.
 */
@Entity({ name: 'Tag' })
export class Tag {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'name', type: 'text' })
  name!: string;

  /** CSS colour of the pill, e.g. "#46e0ff". */
  @Column({ name: 'color', type: 'text', default: '#46e0ff' })
  color!: string;

  @ManyToMany(() => Song, (song) => song.tags)
  songs!: Song[];
}
