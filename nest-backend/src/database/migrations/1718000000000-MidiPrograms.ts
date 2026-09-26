import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `MidiFile.programs` (starting instrument per note-bearing channel, JSON).
 * Left NULL on existing rows: MidiService back-fills it at boot from the bytes,
 * like durationMs/channels. Defensive and idempotent like the other migrations;
 * do NOT regenerate it with `migration:generate` (see MidiChannelsAndTags).
 */
export class MidiPrograms1718000000000 implements MigrationInterface {
  name = 'MidiPrograms1718000000000';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await columnExists(q, 'MidiFile', 'programs'))) {
      await q.query(`ALTER TABLE "MidiFile" ADD COLUMN "programs" TEXT`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await columnExists(q, 'MidiFile', 'programs')) {
      await q.query(`ALTER TABLE "MidiFile" DROP COLUMN "programs"`);
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
