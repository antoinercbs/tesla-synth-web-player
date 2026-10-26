import { createHash } from 'crypto';
import { existsSync, promises as fs } from 'fs';
import { basename, join } from 'path';
import { UPLOADS_DIR } from '../config/paths';
import { hashSong } from '../sync/content-hash';
import { sanitizeStereo } from './stereo';
import { sanitizeVariants } from './variants';

/**
 * A song owns its MIDI file: no other song points at it, editing it changes
 * that song alone. These helpers restore the rule on data that predates it (the
 * OwnMidiFiles migration, an old backup, a peer that has not migrated) through
 * plain SQL, so a migration's QueryRunner and a service's EntityManager share them.
 */

/** A QueryRunner's or an EntityManager's `query`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Query = (sql: string, params?: unknown[]) => Promise<any>;

/**
 * The uuid of song `songUuid`'s own copy of file `fileUuid`. Derived, not
 * random: two instances splitting the same shared file give each song the same
 * copy, so their next sync finds the songs equal.
 */
export function ownFileUuid(fileUuid: string, songUuid: string): string {
  const h = createHash('sha256').update(`${fileUuid}:${songUuid}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** A free name in the uploads dir for a file first named `original`. */
export function storedName(original: string): string {
  const safe = original.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 200) || 'file.mid';
  for (;;) {
    const name = `${Math.floor(Math.random() * 1_000_000)}_${safe}`;
    if (!existsSync(join(UPLOADS_DIR, name))) return name;
  }
}

/** The on-disk name without the random prefix storedName put in front. */
function originalOf(path: string): string {
  return basename(path).replace(/^\d+_/, '');
}

interface FileRow {
  id: number;
  name: string | null;
  path: string;
  durationMs: number | null;
  channels: number | null;
  programs: string | null;
  uuid: string | null;
  updatedAt: number | null;
  contentHash: string | null;
  editorName: string | null;
}

/**
 * Splits every file several songs share: each song gets its own copy, keyed by
 * ownFileUuid. With `all`, files used once are re-keyed the same way too: the
 * migration does it, so an instance that never shared a file still lands on the
 * same uuids as one that did. Returns the songs whose file changed.
 */
export async function giveEachSongItsFile(query: Query, all = false): Promise<number[]> {
  const rows: { songId: number; songUuid: string | null; fileId: number; fileUuid: string | null }[] = await query(
    `SELECT s.id AS songId, s.uuid AS songUuid, f.id AS fileId, f.uuid AS fileUuid
       FROM "Song" s JOIN "MidiFile" f ON f.id = s.midiFile_id ORDER BY s.id`,
  );
  const byFile = new Map<number, typeof rows>();
  for (const r of rows) byFile.set(r.fileId, [...(byFile.get(r.fileId) ?? []), r]);

  const touched: number[] = [];
  for (const [fileId, songs] of byFile) {
    if (songs.length < 2 && !all) continue;
    for (const [i, s] of songs.entries()) {
      const uuid = ownFileUuid(s.fileUuid ?? String(fileId), s.songUuid ?? String(s.songId));
      if (i === 0) {
        if (uuid !== s.fileUuid && !(await fileIdOf(query, uuid))) {
          await query(`UPDATE "MidiFile" SET uuid = ? WHERE id = ?`, [uuid, fileId]);
        }
      } else {
        // already there (a peer sent it): taken as it is, else copied
        const id = (await fileIdOf(query, uuid)) ?? (await copyFileRow(query, fileId, uuid));
        await query(`UPDATE "Song" SET midiFile_id = ? WHERE id = ?`, [id, s.songId]);
      }
      touched.push(s.songId);
    }
  }
  for (const id of touched) await rehashSong(query, id);
  return touched;
}

async function fileIdOf(query: Query, uuid: string): Promise<number | null> {
  const rows: { id: number }[] = await query(`SELECT id FROM "MidiFile" WHERE uuid = ?`, [uuid]);
  return rows[0]?.id ?? null;
}

/** A new row and new bytes on disk, the same as file `fileId`'s. */
export async function copyFileRow(query: Query, fileId: number, uuid: string): Promise<number> {
  const [f]: FileRow[] = await query(`SELECT * FROM "MidiFile" WHERE id = ?`, [fileId]);
  const name = storedName(originalOf(f.path ?? 'file.mid'));
  try {
    await fs.copyFile(join(UPLOADS_DIR, basename(f.path)), join(UPLOADS_DIR, name));
  } catch {
    // missing on disk: the copy is as missing as the original
  }
  await query(
    `INSERT INTO "MidiFile" (name, path, durationMs, channels, programs, uuid, updatedAt, contentHash, editorName)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [f.name, `./uploads/${name}`, f.durationMs, f.channels, f.programs, uuid, f.updatedAt, f.contentHash, f.editorName],
  );
  return (await fileIdOf(query, uuid)) as number;
}

/**
 * The song's contentHash from what is stored, its file included. updatedAt is
 * left as it is: nothing changed for whoever edits the song.
 */
export async function rehashSong(query: Query, songId: number): Promise<void> {
  const [song]: {
    name: string | null; coilCount: number; mode: string; output2Mask: number;
    stereo: string | null; variants: string | null; editorName: string | null; fileUuid: string | null; fileHash: string | null;
  }[] = await query(
    `SELECT s.name, s.coilCount, s.mode, s.output2Mask, s.stereo, s.variants, s.editorName, f.uuid AS fileUuid, f.contentHash AS fileHash
       FROM "Song" s LEFT JOIN "MidiFile" f ON f.id = s.midiFile_id WHERE s.id = ?`,
    [songId],
  );
  if (!song) return;
  const coils = await query(`SELECT coilIndex, coilUuid, channelMask, ontimeUs, duty FROM "Coil" WHERE song_id = ?`, [songId]);
  const events: { coilIndex: number; atMs: number; param: string; value: number; ramp: number | null }[] = await query(
    `SELECT coilIndex, atMs, param, value, ramp FROM "CoilEvent" WHERE song_id = ?`,
    [songId],
  );
  const parsed = (text: string | null): unknown => {
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  };
  const contentHash = hashSong({
    name: song.name,
    coilCount: song.coilCount,
    mode: song.mode,
    output2Mask: song.output2Mask,
    midiFileUuid: song.fileUuid,
    midiFileHash: song.fileHash,
    coils,
    events: events.map((e) => ({ ...e, ramp: !!e.ramp })),
    stereo: sanitizeStereo(parsed(song.stereo)),
    variants: sanitizeVariants(parsed(song.variants)),
    editorName: song.editorName,
  });
  await query(`UPDATE "Song" SET contentHash = ? WHERE id = ?`, [contentHash, songId]);
}

/** Files no song points at: unreachable now that there is no file library. */
export async function unusedFiles(query: Query): Promise<FileRow[]> {
  return query(
    `SELECT f.* FROM "MidiFile" f WHERE NOT EXISTS (SELECT 1 FROM "Song" s WHERE s.midiFile_id = f.id)`,
  );
}

/** Deletes a file row and its bytes, unless a song still points at it. */
export async function dropFileIfUnused(query: Query, fileId: number): Promise<void> {
  const used: unknown[] = await query(`SELECT 1 FROM "Song" WHERE midiFile_id = ? LIMIT 1`, [fileId]);
  if (used.length) return;
  const [f]: FileRow[] = await query(`SELECT path FROM "MidiFile" WHERE id = ?`, [fileId]);
  if (!f) return;
  await query(`DELETE FROM "MidiFile" WHERE id = ?`, [fileId]);
  const name = basename(f.path ?? '');
  if (name) await fs.rm(join(UPLOADS_DIR, name), { force: true });
}
