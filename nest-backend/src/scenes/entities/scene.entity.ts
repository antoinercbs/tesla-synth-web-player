import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A scene of the club: a décor and the inventory's coils posed in it. Its data
 * is the front's (coils/scene.ts): the server keeps it as given and only hashes
 * it, like a coil's spec. `position` orders the list.
 */
@Entity({ name: 'Scene' })
export class Scene {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'uuid', type: 'text', unique: true })
  uuid!: string;

  @Column({ name: 'name', type: 'text' })
  name!: string;

  @Column({ name: 'position', type: 'integer', default: 0 })
  position!: number;

  @Column({ name: 'data', type: 'simple-json' })
  data!: Record<string, unknown>;

  @Column({ name: 'updatedAt', type: 'integer', nullable: true })
  updatedAt!: number;

  @Column({ name: 'contentHash', type: 'text', nullable: true })
  contentHash!: string;

  @Column({ name: 'editorName', type: 'text', nullable: true })
  editorName!: string | null;
}
