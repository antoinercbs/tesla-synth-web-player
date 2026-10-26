import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Songs get their other ways to be played, on other coils: `Song.variants`
 * (JSON, songs/variants.ts). Left null: the song has its own coils only, and
 * its sync hash stays the same.
 * Defensive and idempotent like the other migrations; do NOT regenerate it with
 * `migration:generate` (see MidiChannelsAndTags).
 */
export class SongVariants1718700000000 implements MigrationInterface {
  name = 'SongVariants1718700000000';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await columnExists(q, 'Song', 'variants'))) {
      await q.query(`ALTER TABLE "Song" ADD COLUMN "variants" TEXT`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await columnExists(q, 'Song', 'variants')) {
      await q.query(`ALTER TABLE "Song" DROP COLUMN "variants"`);
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
