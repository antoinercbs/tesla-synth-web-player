import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the Envelope table (user-defined Syntherrupter envelopes, programs 20-63).
 * Mirrored in schema.sql so a fresh DB and a migrated one share the same
 * structure. Defensive and idempotent like the other migrations; do NOT
 * regenerate it with `migration:generate` (see MidiChannelsAndTags).
 */
export class Envelopes1718100000000 implements MigrationInterface {
  name = 'Envelopes1718100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "Envelope" (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        program      INTEGER NOT NULL,
        name         TEXT,
        steps        TEXT NOT NULL,
        updatedAt    INTEGER,
        contentHash  TEXT,
        editorName   TEXT
      )
    `);
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS UQ_envelope_program ON "Envelope"(program)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS UQ_envelope_program`);
    await q.query(`DROP TABLE IF EXISTS "Envelope"`);
  }
}
