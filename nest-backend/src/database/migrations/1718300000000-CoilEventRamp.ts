import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `CoilEvent.ramp` (1 = reached by a linear ramp from the previous point,
 * NULL/0 = a step). Existing events stay steps. Song-wide power points need no
 * schema change: they are events with coilIndex -1 and param 'power'.
 * Defensive and idempotent like the other migrations; do NOT regenerate it with
 * `migration:generate` (see MidiChannelsAndTags).
 */
export class CoilEventRamp1718300000000 implements MigrationInterface {
  name = 'CoilEventRamp1718300000000';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await columnExists(q, 'CoilEvent', 'ramp'))) {
      await q.query(`ALTER TABLE "CoilEvent" ADD COLUMN "ramp" INTEGER`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await columnExists(q, 'CoilEvent', 'ramp')) {
      await q.query(`ALTER TABLE "CoilEvent" DROP COLUMN "ramp"`);
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
