import { isAbsolute, join, resolve } from 'path';

/**
 * Runtime data locations.
 *
 * By default the data lives at the repository root (where `database.db` and the
 * `uploads/` folder were dropped). The root is derived from this file's own
 * location (`nest-backend/{dist,src}/config` -> three levels up), so it is
 * correct regardless of the current working directory. Everything is
 * overridable via environment variables:
 *   - DATA_ROOT     base folder for database/uploads (default: repo root)
 *   - DATABASE_PATH explicit path to the SQLite file
 *   - UPLOADS_DIR   explicit path to the uploads folder
 */
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');

const DATA_ROOT = process.env.DATA_ROOT
  ? resolve(process.cwd(), process.env.DATA_ROOT)
  : PROJECT_ROOT;

function fromRoot(envValue: string | undefined, fallback: string): string {
  if (!envValue) {
    return join(DATA_ROOT, fallback);
  }
  return isAbsolute(envValue) ? envValue : resolve(process.cwd(), envValue);
}

export const DATABASE_PATH = fromRoot(process.env.DATABASE_PATH, 'database.db');
export const UPLOADS_DIR = fromRoot(process.env.UPLOADS_DIR, 'uploads');
export const UPLOADS_DIR_ABS = UPLOADS_DIR;
export const PUBLIC_DIR = resolve(__dirname, '..', '..', 'public');
