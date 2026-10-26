import { MigrationInterface, QueryRunner } from 'typeorm';
import { giveEachSongItsFile, ownFileUuid, unusedFiles } from '../../songs/own-files';

/**
 * One MIDI file per song: there is no file library any more. A file several
 * songs shared is copied so each has its own; a file no song used becomes a
 * song of its own (named after it, no channel on any coil yet) rather than
 * vanishing. Every file is re-keyed by ownFileUuid, so the server and a desktop
 * app migrating the same data apart land on the same uuids, and every song is
 * rehashed (its hash now holds its file's bytes too). Then a unique index keeps
 * two songs from sharing a file again.
 *
 * Defensive and idempotent like the other migrations; do NOT regenerate it with
 * `migration:generate` (see MidiChannelsAndTags).
 */
export class OwnMidiFiles1718400000000 implements MigrationInterface {
  name = 'OwnMidiFiles1718400000000';

  public async up(q: QueryRunner): Promise<void> {
    const query = (sql: string, params?: unknown[]) => q.query(sql, params);

    const orphans = await unusedFiles(query);
    if (orphans.length) {
      const coilCount = await defaultCoilCount(q);
      for (const f of orphans) {
        const uuid = ownFileUuid(f.uuid ?? String(f.id), 'song');
        await q.query(
          `INSERT INTO "Song" (midiFile_id, name, coilCount, mode, output2Mask, uuid, updatedAt, editorName)
           VALUES (?, ?, ?, 'midi', 0, ?, ?, ?)`,
          [f.id, (f.name ?? '').replace(/\.(mid|midi|kar)$/i, ''), coilCount, uuid, f.updatedAt ?? Date.now(), f.editorName],
        );
      }
    }

    await giveEachSongItsFile(query, true);

    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_song_midifile" ON "Song"("midiFile_id") WHERE midiFile_id IS NOT NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    // the copies stay: each song keeps its own file
    await q.query(`DROP INDEX IF EXISTS "UQ_song_midifile"`);
  }
}

async function defaultCoilCount(q: QueryRunner): Promise<number> {
  try {
    const rows: { defaultCoilCount: number | null }[] = await q.query(`SELECT defaultCoilCount FROM "AppConfig" LIMIT 1`);
    const n = Number(rows[0]?.defaultCoilCount);
    return Number.isInteger(n) && n >= 1 && n <= 6 ? n : 3;
  } catch {
    return 3;
  }
}
