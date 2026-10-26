import { createHash } from 'crypto';
import { MigrationInterface, QueryRunner } from 'typeorm';
import { hashTeslaCoil } from '../../sync/content-hash';

/**
 * The coil inventory: one row per real Tesla coil. Seeded from the operator's
 * coil names (AppConfig), one coil per output in use (the default coil count, or
 * further if a later output is named), each a small coil until its sheet is
 * filled. Mirrored in schema.sql; defensive and idempotent like the others.
 */
export class TeslaCoils1718500000000 implements MigrationInterface {
  name = 'TeslaCoils1718500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "TeslaCoil" (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid         TEXT NOT NULL,
        name         TEXT NOT NULL,
        position     INTEGER NOT NULL DEFAULT 0,
        spec         TEXT NOT NULL,
        twinGroup    TEXT,
        notes        TEXT,
        updatedAt    INTEGER,
        contentHash  TEXT,
        editorName   TEXT
      )
    `);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS UQ_teslacoil_uuid ON "TeslaCoil"(uuid)`);

    const existing: { c: number }[] = await q.query(`SELECT COUNT(*) AS c FROM "TeslaCoil"`);
    if (Number(existing[0]?.c ?? 0) > 0) return;
    const config: { coilNames: string | null; defaultCoilCount: number }[] = await q.query(
      `SELECT coilNames, defaultCoilCount FROM "AppConfig" ORDER BY id LIMIT 1`,
    );
    let names: string[] = [];
    try {
      names = JSON.parse(config[0]?.coilNames ?? '[]') ?? [];
    } catch {
      names = [];
    }
    const lastNamed = names.reduce((last, n, i) => (n?.trim() ? i : last), -1);
    const count = Math.max(1, Math.min(6, Math.max(Number(config[0]?.defaultCoilCount) || 3, lastNamed + 1)));
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      const row = {
        name: names[i]?.trim() || `Bobine ${i + 1}`,
        position: i,
        spec: { preset: 'petite' },
        twinGroup: null,
        notes: null,
        editorName: null,
      };
      await q.query(
        `INSERT INTO "TeslaCoil" (uuid, name, position, spec, twinGroup, notes, updatedAt, contentHash, editorName)
         VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, NULL)`,
        [seedCoilUuid(i), row.name, row.position, JSON.stringify(row.spec), now, hashTeslaCoil(row)],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS UQ_teslacoil_uuid`);
    await q.query(`DROP TABLE IF EXISTS "TeslaCoil"`);
  }
}

/**
 * The uuid of the coil seeded at position `i`. Derived, not random: the desktop
 * app and the server seed the same coils from their names, and their first
 * sync finds them the same rather than doubled.
 */
export function seedCoilUuid(i: number): string {
  const h = createHash('sha256').update(`tesla-player:seed-coil:${i}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
