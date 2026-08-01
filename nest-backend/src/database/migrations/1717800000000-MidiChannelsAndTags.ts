import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `MidiFile.channels` (left NULL on existing rows — MidiService back-fills
 * it at boot, like durationMs/contentHash) and the tag tables. Defensive and
 * idempotent like the other migrations.
 *
 * Do NOT regenerate this with `typeorm migration:generate`. SQLite cannot ALTER
 * a constraint, so the generated diff rebuilds every table through temporary
 * copies: it drops the partial UNIQUE uuid indexes the sync module needs and the
 * PlaylistSong -> Song foreign key, and `SELECT "channels"` over a table that
 * does not have the column yet silently yields the string 'channels'.
 */
export class MidiChannelsAndTags1717800000000 implements MigrationInterface {
  name = 'MidiChannelsAndTags1717800000000';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await columnExists(q, 'MidiFile', 'channels'))) {
      await q.query(`ALTER TABLE "MidiFile" ADD COLUMN "channels" INTEGER`);
    }

    // Mirrored in schema.sql so fresh and migrated databases stay identical.
    await q.query(`
      CREATE TABLE IF NOT EXISTS "Tag" (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        name  TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#46e0ff'
      )
    `);
    await q.query(`
      CREATE TABLE IF NOT EXISTS "song_tags" (
        songId INTEGER NOT NULL,
        tagId  INTEGER NOT NULL,
        PRIMARY KEY (songId, tagId),
        FOREIGN KEY (songId) REFERENCES Song(id) ON DELETE CASCADE,
        FOREIGN KEY (tagId)  REFERENCES Tag(id)  ON DELETE CASCADE
      )
    `);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_song_tags_song" ON "song_tags" (songId)`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_song_tags_tag" ON "song_tags" (tagId)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_song_tags_tag"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_song_tags_song"`);
    await q.query(`DROP TABLE IF EXISTS "song_tags"`);
    await q.query(`DROP TABLE IF EXISTS "Tag"`);
    if (await columnExists(q, 'MidiFile', 'channels')) {
      await q.query(`ALTER TABLE "MidiFile" DROP COLUMN "channels"`);
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
