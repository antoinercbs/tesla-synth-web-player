import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { basename, join } from 'path';
import { MigrationInterface, QueryRunner } from 'typeorm';
import { UPLOADS_DIR } from '../../config/paths';
import { hashBytes, hashPlaylist, hashSong } from '../../sync/content-hash';

/**
 * Adds the sync identity (`uuid`, `updatedAt`, `contentHash`) to the syncable
 * parent tables (Song, MidiFile, Playlist) so the Electron app and the server
 * can be matched record-by-record and diffed (see SyncModule). Children
 * (Coil/CoilEvent/PlaylistSong) carry no identity: they are rewritten on every
 * update and synced atomically as part of the parent's content hash.
 *
 * Backfills every existing row with a uuid + updatedAt + a content hash so the
 * very first sync never sees a NULL hash. Defensive/idempotent like the others.
 */
const TABLES = ['Song', 'Playlist', 'MidiFile'];

export class AddSyncColumns1717600000000 implements MigrationInterface {
  name = 'AddSyncColumns1717600000000';

  public async up(q: QueryRunner): Promise<void> {
    for (const table of TABLES) {
      if (!(await columnExists(q, table, 'uuid'))) {
        await q.query(`ALTER TABLE "${table}" ADD COLUMN "uuid" TEXT`);
      }
      if (!(await columnExists(q, table, 'updatedAt'))) {
        await q.query(`ALTER TABLE "${table}" ADD COLUMN "updatedAt" INTEGER`);
      }
      if (!(await columnExists(q, table, 'contentHash'))) {
        await q.query(`ALTER TABLE "${table}" ADD COLUMN "contentHash" TEXT`);
      }
    }

    const now = Date.now();

    // 1) uuid + updatedAt for every row that lacks them.
    for (const table of TABLES) {
      const rows: { id: number }[] = await q.query(
        `SELECT id FROM "${table}" WHERE uuid IS NULL OR uuid = ''`,
      );
      for (const { id } of rows) {
        await q.query(
          `UPDATE "${table}" SET uuid = ?, updatedAt = COALESCE(updatedAt, ?) WHERE id = ?`,
          [randomUUID(), now, id],
        );
      }
    }

    // 2) Unique indexes (partial: only over non-null uuids).
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_song_uuid"     ON "Song"("uuid")     WHERE uuid IS NOT NULL`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_playlist_uuid" ON "Playlist"("uuid") WHERE uuid IS NOT NULL`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_midifile_uuid" ON "MidiFile"("uuid") WHERE uuid IS NOT NULL`,
    );

    // 3) MidiFile.contentHash = sha256(file bytes). Tolerate missing files
    //    (left NULL; MidiService.onModuleInit / the manifest recompute later).
    const midiFiles: { id: number; path: string }[] = await q.query(
      `SELECT id, path FROM "MidiFile" WHERE contentHash IS NULL`,
    );
    for (const file of midiFiles) {
      try {
        const buffer = await fs.readFile(join(UPLOADS_DIR, basename(file.path)));
        await q.query(`UPDATE "MidiFile" SET contentHash = ? WHERE id = ?`, [
          hashBytes(buffer),
          file.id,
        ]);
      } catch {
        // file missing/unreadable — leave NULL, recomputed on next read.
      }
    }

    // 4) Song.contentHash = hash of the normalized aggregate.
    const songs: SongRow[] = await q.query(
      `SELECT id, name, coilCount, mode, output2Mask, midiFile_id FROM "Song" WHERE contentHash IS NULL`,
    );
    for (const song of songs) {
      const midiFileUuid = await uuidOf(q, 'MidiFile', song.midiFile_id);
      const coils: CoilRow[] = await q.query(
        `SELECT coilIndex, channelMask, ontimeUs, duty FROM "Coil" WHERE song_id = ?`,
        [song.id],
      );
      const events: EventRow[] = await q.query(
        `SELECT coilIndex, atMs, param, value FROM "CoilEvent" WHERE song_id = ?`,
        [song.id],
      );
      const contentHash = hashSong({
        name: song.name,
        coilCount: song.coilCount,
        mode: song.mode,
        output2Mask: song.output2Mask,
        midiFileUuid,
        coils,
        events,
      });
      await q.query(`UPDATE "Song" SET contentHash = ? WHERE id = ?`, [
        contentHash,
        song.id,
      ]);
    }

    // 5) Playlist.contentHash = hash of {name, coilCount, ordered song uuids}.
    const playlists: PlaylistRow[] = await q.query(
      `SELECT id, name, coilCount FROM "Playlist" WHERE contentHash IS NULL`,
    );
    for (const playlist of playlists) {
      const members: { song_id: number }[] = await q.query(
        `SELECT song_id FROM "PlaylistSong" WHERE playlist_id = ? ORDER BY idx ASC`,
        [playlist.id],
      );
      const songUuids: string[] = [];
      for (const m of members) {
        const u = await uuidOf(q, 'Song', m.song_id);
        if (u) songUuids.push(u); // drop unresolved members (matches apply path)
      }
      const contentHash = hashPlaylist({
        name: playlist.name,
        coilCount: playlist.coilCount ?? 3,
        songUuids,
      });
      await q.query(`UPDATE "Playlist" SET contentHash = ? WHERE id = ?`, [
        contentHash,
        playlist.id,
      ]);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "UQ_song_uuid"`);
    await q.query(`DROP INDEX IF EXISTS "UQ_playlist_uuid"`);
    await q.query(`DROP INDEX IF EXISTS "UQ_midifile_uuid"`);
    for (const table of TABLES) {
      for (const col of ['uuid', 'updatedAt', 'contentHash']) {
        if (await columnExists(q, table, col)) {
          await q.query(`ALTER TABLE "${table}" DROP COLUMN "${col}"`);
        }
      }
    }
  }
}

interface SongRow {
  id: number;
  name: string | null;
  coilCount: number;
  mode: string;
  output2Mask: number;
  midiFile_id: number | null;
}
interface CoilRow {
  coilIndex: number;
  channelMask: number;
  ontimeUs: number;
  duty: number;
}
interface EventRow {
  coilIndex: number;
  atMs: number;
  param: string;
  value: number;
}
interface PlaylistRow {
  id: number;
  name: string | null;
  coilCount: number | null;
}

async function uuidOf(
  q: QueryRunner,
  table: string,
  id: number | null,
): Promise<string | null> {
  if (id == null) return null;
  const rows: { uuid: string | null }[] = await q.query(
    `SELECT uuid FROM "${table}" WHERE id = ?`,
    [id],
  );
  return rows[0]?.uuid ?? null;
}

async function columnExists(
  q: QueryRunner,
  table: string,
  column: string,
): Promise<boolean> {
  const rows: { name: string }[] = await q.query(`PRAGMA table_info("${table}")`);
  return rows.some((c) => c.name === column);
}
