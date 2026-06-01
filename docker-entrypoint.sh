#!/bin/sh
# Create the data dir + schema on first boot, then run the server. TypeORM
# migrations run automatically on app start (migrationsRun), so this only needs
# to create the baseline schema when the database file does not exist yet.
set -e

: "${DATA_ROOT:=/data}"
mkdir -p "$DATA_ROOT/uploads"

if [ ! -f "$DATA_ROOT/database.db" ]; then
  echo "[entrypoint] initialising database at $DATA_ROOT/database.db"
  node dist/scripts/init-db.js
fi

exec node dist/main.js
