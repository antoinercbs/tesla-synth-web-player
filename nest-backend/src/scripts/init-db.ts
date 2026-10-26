/**
 * Creates the SQLite schema, mirroring the Flask `init_db.py`.
 * Run with: `npm run init:db`
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as sqlite3 from 'sqlite3';
import { DATABASE_PATH } from '../config/paths';

// Resolve schema.sql relative to this compiled file ({dist,src}/scripts -> root)
// so it works regardless of the caller's cwd (Docker, ts-node, Electron fork);
// fall back to cwd for any unusual invocation.
function resolveSchemaPath(): string {
  const candidates = [
    join(__dirname, '..', '..', 'schema.sql'),
    join(process.cwd(), 'schema.sql'),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

const schema = readFileSync(resolveSchemaPath(), 'utf-8');
const db = new sqlite3.Database(DATABASE_PATH);

db.exec(schema, (err) => {
  if (err) {
    console.error('Failed to initialise the database:', err.message);
    process.exit(1);
  }
  console.log(`Database initialised at ${DATABASE_PATH}`);
  // Exit explicitly after closing: the native sqlite3 addon can otherwise keep
  // the event loop alive, leaving a forked init-db process hanging (which would
  // block the Electron app's first-run startup with no window).
  db.close(() => process.exit(0));
});
