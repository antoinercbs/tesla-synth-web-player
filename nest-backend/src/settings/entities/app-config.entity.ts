import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Global operator configuration. Singleton: a single row with id = 1. */
@Entity({ name: 'AppConfig' })
export class AppConfig {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  /** Operator-facing name of each physical coil, indexed by coil number (0..5). */
  @Column({ name: 'coilNames', type: 'simple-json', nullable: true })
  coilNames!: string[] | null;

  /** Default coil count pre-filled for new songs/playlists (1..6). */
  @Column({ name: 'defaultCoilCount', type: 'integer', default: 3 })
  defaultCoilCount!: number;
}
