# tesla-player-backend (NestJS)

NestJS + TypeScript replacement for the original Flask backend (`../flask-backend`).
Uses TypeORM over SQLite and reproduces the full API surface with validated DTOs.

## Run

```bash
npm install
npm run init:db        # creates the schema if missing (idempotent, no-op on an existing DB)
npm run start:dev      # watch mode on http://localhost:5000
# or
npm run build && npm run start:prod
```

The server listens on `:5000` (override with `PORT`), matching the front's
`VITE_BASE_URL`. CORS is enabled. The built front-end can be dropped into
`public/` to be served at `/`; uploaded MIDI files are served from `/uploads`.

### Data location

By default the SQLite database and the `uploads/` folder are read from the
**repository root** (one level above this backend), where the existing
`database.db` and MIDI files live. Override via environment variables:

- `DATA_ROOT` — base folder for the database/uploads (default: `..`, the repo root)
- `DATABASE_PATH` — explicit SQLite file path (default: `<DATA_ROOT>/database.db`)
- `UPLOADS_DIR` — explicit uploads folder (default: `<DATA_ROOT>/uploads`)

`init:db` uses `CREATE TABLE IF NOT EXISTS`, so running it against the existing
database is a no-op and never touches existing rows.

## API

All routes are under the global `/api` prefix.

| Method | Route                  | Notes |
|--------|------------------------|-------|
| GET    | `/api/ping`            | `{ "ping": "pong" }` |
| GET    | `/api/songs`           | full nested representation |
| POST   | `/api/songs`           | returns the created song |
| PUT    | `/api/songs/:id`       | id in the path (RESTful) |
| DELETE | `/api/songs/:id`       | cascades sysex + playlist entries |
| GET    | `/api/midi`            | |
| POST   | `/api/midi`            | multipart `file` field |
| DELETE | `/api/midi/:id`        | also deletes the file on disk |
| GET    | `/api/playlists`       | |
| POST   | `/api/playlists`       | |
| PUT    | `/api/playlists/:id`   | id in the path (RESTful) |
| DELETE | `/api/playlists/:id`   | |
| POST   | `/api/translate-sysex` | `{ "sysexCommand": "..." }` -> hex string |

### Differences from the Flask backend (intentional)

- **RESTful item routes.** `PUT`/`DELETE` take the id in the path
  (`/api/songs/:id`) instead of a query param / body id. The v2 front already
  moved to `PUT /api/songs/:id`. The front's *playlist* CRUD and *delete* calls
  still need to be (re)wired to these routes — see the migration notes.
- **Foreign keys are enforced.** TypeORM turns on `PRAGMA foreign_keys = ON`
  (the Python `sqlite3` driver had it off). Deletes therefore cascade cleanly via
  the `ON DELETE CASCADE` / `SET NULL` clauses in `schema.sql`, instead of
  leaving dangling rows.
- **Syfoh is invoked safely.** `SyfohService` calls the Python CLI with an
  argument array (no shell), so it is not exposed to the command injection the
  Flask version had. Configure with `PYTHON_BIN` and `SYFOH_SCRIPT`
  (default: `../flask-backend/Syfoh/Syfoh.py`).

The long-term plan is to drop the Syfoh CLI call entirely and do the sysex
conversion in the front; that work is isolated to `src/syfoh/`.
