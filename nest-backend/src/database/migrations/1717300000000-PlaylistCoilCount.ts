import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a per-playlist Tesla-coil count (1..6, default 3). A playlist then only
 * accepts songs authored for that coil count; existing playlist-song links are
 * kept untouched (incompatible songs are flagged in the UI, not deleted).
 *
 * Defensive: no-op if the column already exists (fresh DB from baseline schema).
 */
export class PlaylistCoilCount1717300000000 implements MigrationInterface {
  name = 'PlaylistCoilCount1717300000000';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await columnExists(q, 'Playlist', 'coilCount'))) {
      await q.query(
        `ALTER TABLE "Playlist" ADD COLUMN "coilCount" INTEGER NOT NULL DEFAULT 3`,
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await columnExists(q, 'Playlist', 'coilCount')) {
      await q.query(`ALTER TABLE "Playlist" DROP COLUMN "coilCount"`);
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
