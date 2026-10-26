import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The club's scenes: a décor and the inventory's coils posed in it, one row
 * each, its data as the front writes it. Starts empty. Mirrored in schema.sql;
 * defensive and idempotent like the others.
 */
export class Scenes1718800000000 implements MigrationInterface {
  name = 'Scenes1718800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "Scene" (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid         TEXT NOT NULL,
        name         TEXT NOT NULL,
        position     INTEGER NOT NULL DEFAULT 0,
        data         TEXT NOT NULL,
        updatedAt    INTEGER,
        contentHash  TEXT,
        editorName   TEXT
      )
    `);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS UQ_scene_uuid ON "Scene"(uuid)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS UQ_scene_uuid`);
    await q.query(`DROP TABLE IF EXISTS "Scene"`);
  }
}
