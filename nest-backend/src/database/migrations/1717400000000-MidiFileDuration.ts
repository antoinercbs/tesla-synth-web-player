import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a cached play-length (in ms) to each MIDI file. Populated on upload and
 * back-filled at boot for existing files (see MidiService). Nullable so rows
 * that predate the column — or files that fail to parse — simply read as
 * "unknown" in the UI.
 *
 * Defensive: no-op if the column already exists.
 */
export class MidiFileDuration1717400000000 implements MigrationInterface {
  name = 'MidiFileDuration1717400000000';

  public async up(q: QueryRunner): Promise<void> {
    if (!(await columnExists(q, 'MidiFile', 'durationMs'))) {
      await q.query(`ALTER TABLE "MidiFile" ADD COLUMN "durationMs" INTEGER`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    if (await columnExists(q, 'MidiFile', 'durationMs')) {
      await q.query(`ALTER TABLE "MidiFile" DROP COLUMN "durationMs"`);
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
