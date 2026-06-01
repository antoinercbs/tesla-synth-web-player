import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Global operator configuration (coil names + default coil count). A single
 * singleton row (id = 1) is seeded so the front always has something to read.
 *
 * Defensive: no-op if the table already exists (fresh DB from baseline schema).
 */
export class AppConfig1717500000000 implements MigrationInterface {
  name = 'AppConfig1717500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE IF NOT EXISTS "AppConfig" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "coilNames" TEXT,
      "defaultCoilCount" INTEGER NOT NULL DEFAULT 3
    )`);
    const rows: { c: number }[] = await q.query(`SELECT COUNT(*) AS c FROM "AppConfig"`);
    if (!rows[0] || Number(rows[0].c) === 0) {
      await q.query(
        `INSERT INTO "AppConfig" ("id", "coilNames", "defaultCoilCount") VALUES (1, '[]', 3)`,
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "AppConfig"`);
  }
}
