# tesla-player-backend (NestJS)

The project's backend: NestJS + TypeScript over TypeORM/SQLite. Serves the REST
API under `/api` with validated DTOs, and (in production) the built front-end.

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
database is a no-op and never touches existing rows. TypeORM migrations run
automatically on app start (`migrationsRun`).

## API

All routes are under the global `/api` prefix.

| Method | Route                    | Notes |
|--------|--------------------------|-------|
| GET    | `/api/ping`              | `{ "ping": "pong" }` |
| GET    | `/api/songs`             | full nested representation (coils + events) |
| POST   | `/api/songs`             | returns the created song |
| PUT    | `/api/songs/:id`         | id in the path (RESTful) |
| DELETE | `/api/songs/:id`         | cascades coils + playlist entries |
| GET    | `/api/midi`              | |
| POST   | `/api/midi`              | multipart `file` field |
| PATCH  | `/api/midi/:id/programs` | rewrites the file's per-channel instruments (affects every song using it) |
| DELETE | `/api/midi/:id`          | also deletes the file on disk |
| GET    | `/api/playlists`         | |
| POST   | `/api/playlists`         | |
| PUT    | `/api/playlists/:id`     | id in the path (RESTful) |
| DELETE | `/api/playlists/:id`     | |
| GET    | `/api/settings`          | operator config (coil names, default coil count) |
| PUT    | `/api/settings`          | update the operator config |

### Design notes

- **RESTful item routes.** `PUT`/`DELETE` take the id in the path
  (`/api/songs/:id`) instead of a query param / body id.
- **Foreign keys are enforced.** TypeORM turns on `PRAGMA foreign_keys = ON`, so
  deletes cascade cleanly via the `ON DELETE CASCADE` / `SET NULL` clauses in
  `schema.sql` instead of leaving dangling rows.
- **SysEx is compiled in the browser.** The per-coil song model is turned into
  Syntherrupter SysEx frames on the front (`tesla-player/src/sysex/`); the
  backend only stores the structured config — there is no server-side sysex/CLI.
