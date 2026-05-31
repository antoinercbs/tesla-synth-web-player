import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migrates the Flask-era SysexCommand model to the structured per-coil model.
 *
 * Each song's opaque list of pre-compiled SysEx frames is decoded into
 * Coil rows (channelMask / ontimeUs / duty) plus Song.coilCount / Song.mode,
 * then the legacy SysexCommand table and the two output_mapping columns are
 * dropped. The "deactivated channels" model is abandoned: output 1 is the
 * implicit union of coil masks, output 2 is the explicit Song.output2Mask
 * (defaulting to 0).
 *
 * Fully defensive so it is a no-op on a fresh database (created from the new
 * baseline schema.sql, which has no SysexCommand) and transforms an existing
 * Flask database exactly once.
 */
export class CoilModel1717200000000 implements MigrationInterface {
  name = 'CoilModel1717200000000';

  public async up(q: QueryRunner): Promise<void> {
    // --- 1. New tables (no-op if the baseline schema already created them) ---
    await q.query(`CREATE TABLE IF NOT EXISTS "Coil" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "song_id" INTEGER NOT NULL,
      "coilIndex" INTEGER NOT NULL,
      "channelMask" INTEGER NOT NULL DEFAULT 0,
      "ontimeUs" INTEGER NOT NULL DEFAULT 0,
      "duty" REAL NOT NULL DEFAULT 0,
      CONSTRAINT "UQ_coil_song_index" UNIQUE ("song_id", "coilIndex"),
      FOREIGN KEY ("song_id") REFERENCES "Song" ("id") ON DELETE CASCADE
    )`);
    await q.query(`CREATE TABLE IF NOT EXISTS "CoilEvent" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "song_id" INTEGER NOT NULL,
      "coilIndex" INTEGER NOT NULL,
      "atMs" INTEGER NOT NULL,
      "param" TEXT NOT NULL,
      "value" REAL NOT NULL,
      FOREIGN KEY ("song_id") REFERENCES "Song" ("id") ON DELETE CASCADE
    )`);

    // --- 2. New Song columns (only if missing) ---
    if (!(await columnExists(q, 'Song', 'coilCount'))) {
      await q.query(`ALTER TABLE "Song" ADD COLUMN "coilCount" INTEGER NOT NULL DEFAULT 1`);
    }
    if (!(await columnExists(q, 'Song', 'mode'))) {
      await q.query(`ALTER TABLE "Song" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'midi'`);
    }
    if (!(await columnExists(q, 'Song', 'output2Mask'))) {
      await q.query(`ALTER TABLE "Song" ADD COLUMN "output2Mask" INTEGER NOT NULL DEFAULT 0`);
    }

    // --- 3. Backfill from SysexCommand (existing songs only) ---
    if (await tableExists(q, 'SysexCommand')) {
      const songs: { id: number }[] = await q.query(`SELECT id FROM "Song"`);
      for (const { id } of songs) {
        const rows: { value: string }[] = await q.query(
          `SELECT value FROM "SysexCommand" WHERE song_id = ? AND value IS NOT NULL AND value <> ''`,
          [id],
        );

        const coils = new Map<number, CoilRow>();

        for (const { value } of rows) {
          const f = decodeFrame(value);
          // The enable frame (0x20) only selects the firmware mode; every
          // migrated song is MIDI mode ('midi'). Per-coil data is 0x60/0x21/0x22.
          if (f.pn !== PN_CHANNEL_MAP && f.pn !== PN_ONTIME && f.pn !== PN_DUTY) {
            continue;
          }
          const coil =
            coils.get(f.coil) ??
            { coilIndex: f.coil, channelMask: 0, ontimeUs: 0, duty: 0 };
          if (f.pn === PN_CHANNEL_MAP) coil.channelMask = f.valueInt;
          else if (f.pn === PN_ONTIME) coil.ontimeUs = f.valueInt;
          else if (f.pn === PN_DUTY) coil.duty = f.valueFloat;
          coils.set(f.coil, coil);
        }

        const list = [...coils.values()].sort((a, b) => a.coilIndex - b.coilIndex);
        const coilCount = clamp(
          list.length ? Math.max(...list.map((c) => c.coilIndex)) + 1 : 1,
          1,
          6,
        );

        await q.query(
          `UPDATE "Song" SET "coilCount" = ?, "mode" = 'midi', "output2Mask" = 0 WHERE id = ?`,
          [coilCount, id],
        );
        for (const c of list) {
          await q.query(
            `INSERT INTO "Coil" ("song_id", "coilIndex", "channelMask", "ontimeUs", "duty")
             VALUES (?, ?, ?, ?, ?)`,
            [id, c.coilIndex, c.channelMask, c.ontimeUs, c.duty],
          );
        }
      }

      // --- 4. Drop the legacy table ---
      await q.query(`DROP TABLE "SysexCommand"`);
    }

    // --- 5. Drop the legacy output_mapping columns ---
    if (await columnExists(q, 'Song', 'output_mapping_1')) {
      await q.query(`ALTER TABLE "Song" DROP COLUMN "output_mapping_1"`);
    }
    if (await columnExists(q, 'Song', 'output_mapping_2')) {
      await q.query(`ALTER TABLE "Song" DROP COLUMN "output_mapping_2"`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    // Best-effort rollback: restore the legacy structure (data is not recovered).
    if (!(await columnExists(q, 'Song', 'output_mapping_1'))) {
      await q.query(`ALTER TABLE "Song" ADD COLUMN "output_mapping_1" INTEGER`);
    }
    if (!(await columnExists(q, 'Song', 'output_mapping_2'))) {
      await q.query(`ALTER TABLE "Song" ADD COLUMN "output_mapping_2" INTEGER`);
    }
    await q.query(`CREATE TABLE IF NOT EXISTS "SysexCommand" (
      "id" INTEGER PRIMARY KEY AUTOINCREMENT,
      "song_id" INTEGER,
      "command" TEXT,
      "value" TEXT,
      "indexInSong" INTEGER,
      FOREIGN KEY ("song_id") REFERENCES "Song" ("id") ON DELETE CASCADE
    )`);
    await q.query(`DROP TABLE IF EXISTS "CoilEvent"`);
    await q.query(`DROP TABLE IF EXISTS "Coil"`);
  }
}

// ---------------------------------------------------------------------------
// SysEx decoding (kept inline so the migration is self-contained; mirrors the
// browser encoder in tesla-player/src/sysex/syntherrupter.ts).
// ---------------------------------------------------------------------------

const PN_ENABLE = 0x20;
const PN_ONTIME = 0x21;
const PN_DUTY = 0x22;
const PN_CHANNEL_MAP = 0x60;

interface CoilRow {
  coilIndex: number;
  channelMask: number;
  ontimeUs: number;
  duty: number;
}

function unpack7(bytes: number[]): number {
  return bytes.reduce((acc, b, i) => acc + ((b & 0x7f) << (i * 7)), 0);
}

function bitsToFloat(bits: number): number {
  const view = new DataView(new ArrayBuffer(4));
  view.setInt32(0, bits);
  return view.getFloat32(0);
}

function decodeFrame(hex: string): {
  pn: number;
  coil: number;
  valueInt: number;
  valueFloat: number;
} {
  const b = hex.trim().split(/\s+/).map((s) => parseInt(s, 16));
  const valueInt = unpack7(b.slice(10, 15));
  return { pn: b[6], coil: b[8], valueInt, valueFloat: bitsToFloat(valueInt) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function tableExists(q: QueryRunner, name: string): Promise<boolean> {
  const rows = await q.query(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [name],
  );
  return rows.length > 0;
}

async function columnExists(
  q: QueryRunner,
  table: string,
  column: string,
): Promise<boolean> {
  const rows: { name: string }[] = await q.query(`PRAGMA table_info("${table}")`);
  return rows.some((c) => c.name === column);
}
