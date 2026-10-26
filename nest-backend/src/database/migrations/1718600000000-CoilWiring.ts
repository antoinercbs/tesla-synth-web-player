import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Songs pick their coils, the board's outputs are wired to them:
 * - `Coil.coilUuid`: the inventory's coil (TeslaCoil.uuid) at each place of a
 *   song. Left null on the songs there are: null reads as the inventory's coil
 *   at that place, as before, and their sync hash stays the same.
 * - `AppConfig.wiring`: the coil on each output of the board ('' free). Left
 *   null: the inventory's coil k on output k, as before.
 * Defensive and idempotent like the other migrations; do NOT regenerate it with
 * `migration:generate` (see MidiChannelsAndTags).
 */
export class CoilWiring1718600000000 implements MigrationInterface {
  name = 'CoilWiring1718600000000';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await columnExists(q, 'Coil', 'coilUuid'))) {
      await q.query(`ALTER TABLE "Coil" ADD COLUMN "coilUuid" TEXT`);
    }
    if (!(await columnExists(q, 'AppConfig', 'wiring'))) {
      await q.query(`ALTER TABLE "AppConfig" ADD COLUMN "wiring" TEXT`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await columnExists(q, 'Coil', 'coilUuid')) {
      await q.query(`ALTER TABLE "Coil" DROP COLUMN "coilUuid"`);
    }
    if (await columnExists(q, 'AppConfig', 'wiring')) {
      await q.query(`ALTER TABLE "AppConfig" DROP COLUMN "wiring"`);
    }
  }
}

async function columnExists(
  q: QueryRunner,
  table: string,
  column: string,
): Promise<boolean> {
  const rows: { name: string }[] = await q.query(`PRAGMA table_info("${table}")`);
  return rows.some((c) => c.name === column);
}
