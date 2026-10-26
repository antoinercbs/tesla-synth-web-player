import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `Song.stereo` (the spatialisation settings, JSON). NULL = off, which is
 * what every existing song gets. Defensive and idempotent like the other
 * migrations; do NOT regenerate it with `migration:generate` (see MidiChannelsAndTags).
 */
export class SongStereo1718200000000 implements MigrationInterface {
  name = 'SongStereo1718200000000';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await columnExists(q, 'Song', 'stereo'))) {
      await q.query(`ALTER TABLE "Song" ADD COLUMN "stereo" TEXT`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await columnExists(q, 'Song', 'stereo')) {
      await q.query(`ALTER TABLE "Song" DROP COLUMN "stereo"`);
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
