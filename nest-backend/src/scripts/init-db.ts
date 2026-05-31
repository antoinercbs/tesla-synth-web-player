/**
 * Creates the SQLite schema, mirroring the Flask `init_db.py`.
 * Run with: `npm run init:db`
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import * as sqlite3 from 'sqlite3';
import { DATABASE_PATH } from '../config/paths';

const schema = readFileSync(join(process.cwd(), 'schema.sql'), 'utf-8');
const db = new sqlite3.Database(DATABASE_PATH);

db.exec(schema, (err) => {
  if (err) {
    console.error('Failed to initialise the database:', err.message);
    process.exit(1);
  }
  console.log(`Database initialised at ${DATABASE_PATH}`);
  db.close();
});
