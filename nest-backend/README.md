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

New migrations are **written by hand** (see `1717700000000-AddEditorName.ts` for
the shape) and registered in `database/data-source.ts`. Do NOT use
`typeorm migration:generate`: SQLite cannot ALTER a constraint, so the generated
diff rebuilds every table through temporary copies and silently drops things it
was never asked to touch — the partial UNIQUE uuid indexes the sync module needs
and the PlaylistSong → Song foreign key. Keep migrations additive and idempotent
(`IF NOT EXISTS` / a `PRAGMA table_info` guard), and mirror any new table in
`schema.sql` so fresh and migrated databases stay identical.

## API

All routes are under the global `/api` prefix.

| Method | Route                    | Notes |
|--------|--------------------------|-------|
| GET    | `/api/ping`              | `{ "ping": "pong" }` |
| GET    | `/api/songs`             | full nested representation (coils + events + tags) |
| POST   | `/api/songs`             | returns the created song |
| PUT    | `/api/songs/:id`         | id in the path (RESTful) |
| DELETE | `/api/songs/:id`         | cascades coils + playlist entries |
| GET    | `/api/midi`              | |
| POST   | `/api/midi`              | multipart `file` field |
| PUT    | `/api/midi/:id/file`     | replaces the bytes in place, keeping the path/uuid (affects every song using it) |
| PATCH  | `/api/midi/:id/name`     | renames the library entry (does not touch the file on disk) |
| PATCH  | `/api/midi/:id/programs` | rewrites the file's per-channel instruments (affects every song using it) |
| DELETE | `/api/midi/:id`          | also deletes the file on disk |
| GET    | `/api/playlists`         | |
| POST   | `/api/playlists`         | |
| PUT    | `/api/playlists/:id`     | id in the path (RESTful) |
| DELETE | `/api/playlists/:id`     | |
| GET    | `/api/tags`              | every tag known to this instance |
| PUT    | `/api/tags/sync`         | full desired tag list; creates/updates/deletes to match (LOCAL-ONLY, see below) |
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
- **Tags are local-only, on purpose (for now).** `Tag` / `song_tags` carry no
  `uuid`/`updatedAt`/`contentHash`, are absent from the sync manifest, and are
  deliberately NOT folded into `hashSong` — so tagging a song never shows up as a
  sync conflict, and tags simply do not travel between instances. Making them
  syncable means giving them a sync identity first (see `sync/content-hash.ts`).
