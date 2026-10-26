import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the nullable `editorName` column (who last edited this, server-stamped
 * from the OIDC token) to the syncable parent tables. Defensive/idempotent like
 * the other migrations.
 *
 * NO backfill and NO content-hash recompute: existing rows keep editorName NULL,
 * and content-hash.ts deliberately omits a null/empty editor from the canonical
 * JSON, so every existing hash is unchanged and no phantom sync conflict appears.
 */
const TABLES = ['Song', 'Playlist', 'MidiFile'];

export class AddEditorName1717700000000 implements MigrationInterface {
  name = 'AddEditorName1717700000000';

  public async up(q: QueryRunner): Promise<void> {
    for (const table of TABLES) {
      if (!(await columnExists(q, table, 'editorName'))) {
        await q.query(`ALTER TABLE "${table}" ADD COLUMN "editorName" TEXT`);
      }
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of TABLES) {
      if (await columnExists(q, table, 'editorName')) {
        await q.query(`ALTER TABLE "${table}" DROP COLUMN "editorName"`);
      }
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
