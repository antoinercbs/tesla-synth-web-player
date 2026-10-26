import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the CoilTuning table (camera-assisted primary tuning history). Mirrored
 * in schema.sql so a fresh DB and a migrated one share the same structure.
 * Defensive and idempotent like the other migrations.
 */
export class CoilTuning1717900000000 implements MigrationInterface {
  name = 'CoilTuning1717900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "CoilTuning" (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        coilIndex     INTEGER NOT NULL,
        coilName      TEXT,
        createdAt     INTEGER NOT NULL,
        location      TEXT,
        lat           REAL,
        lon           REAL,
        indoor        INTEGER,
        tempC         REAL,
        humidityPct   REAL,
        pressureHpa   REAL,
        weatherCode   INTEGER,
        ground        TEXT,
        comment       TEXT,
        primaryTurns  REAL,
        tapStep       REAL,
        tapMin        REAL,
        tapMax        REAL,
        tapTurns      REAL NOT NULL,
        bestPx        REAL,
        tone          TEXT,
        camera        TEXT,
        trials        TEXT,
        uuid          TEXT,
        updatedAt     INTEGER,
        contentHash   TEXT,
        editorName    TEXT
      )
    `);
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS UQ_coiltuning_uuid ON "CoilTuning"(uuid) WHERE uuid IS NOT NULL`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS IDX_coiltuning_coil ON "CoilTuning"(coilIndex, createdAt)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS IDX_coiltuning_coil`);
    await q.query(`DROP INDEX IF EXISTS UQ_coiltuning_uuid`);
    await q.query(`DROP TABLE IF EXISTS "CoilTuning"`);
  }
}
