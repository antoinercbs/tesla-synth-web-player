-- Baseline schema for fresh installs. The structured per-coil model.
-- Existing (Flask-era) databases are transformed from the old SysexCommand
-- model by the TypeORM migration CoilModel (run automatically on boot).

CREATE TABLE IF NOT EXISTS Playlist (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT,
	coilCount INTEGER NOT NULL DEFAULT 3,
	uuid TEXT,
	updatedAt INTEGER,
	contentHash TEXT
);

CREATE TABLE IF NOT EXISTS PlaylistSong(
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	idx INTEGER,
	playlist_id INTEGER,
	song_id INTEGER,
	FOREIGN KEY(playlist_id) REFERENCES Playlist(id) ON DELETE CASCADE,
	FOREIGN KEY(song_id) REFERENCES Song(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS MidiFile (
	id 				INTEGER PRIMARY KEY AUTOINCREMENT,
	name 			TEXT,
	path 			TEXT,
	durationMs		INTEGER,
	uuid			TEXT,
	updatedAt		INTEGER,
	contentHash		TEXT
);

CREATE TABLE IF NOT EXISTS Song (
	id 				INTEGER PRIMARY KEY AUTOINCREMENT,
	midiFile_id 	INTEGER,
	name 			TEXT,
	coilCount		INTEGER NOT NULL DEFAULT 1,
	mode			TEXT NOT NULL DEFAULT 'midi',
	output2Mask		INTEGER NOT NULL DEFAULT 0,
	uuid			TEXT,
	updatedAt		INTEGER,
	contentHash		TEXT,
	FOREIGN KEY (midiFile_id) REFERENCES MidiFile(id) ON DELETE SET NULL
);

-- Sync identity uniqueness. Partial (over non-null uuids) and named identically
-- to the AddSyncColumns migration, so a fresh DB and a migrated DB share the
-- exact same structure (and the migration's CREATE ... IF NOT EXISTS is a no-op).
CREATE UNIQUE INDEX IF NOT EXISTS UQ_song_uuid     ON Song(uuid)     WHERE uuid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS UQ_playlist_uuid ON Playlist(uuid) WHERE uuid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS UQ_midifile_uuid ON MidiFile(uuid) WHERE uuid IS NOT NULL;

-- Per-song, per-coil configuration. Replaces the old opaque SysexCommand list:
-- the browser compiles these rows into Syntherrupter SysEx on demand.
CREATE TABLE IF NOT EXISTS Coil (
	id 				INTEGER PRIMARY KEY AUTOINCREMENT,
	song_id 		INTEGER NOT NULL,
	coilIndex		INTEGER NOT NULL,
	channelMask		INTEGER NOT NULL DEFAULT 0,
	ontimeUs		INTEGER NOT NULL DEFAULT 0,
	duty			REAL NOT NULL DEFAULT 0,
	UNIQUE (song_id, coilIndex),
	FOREIGN KEY (song_id) REFERENCES Song(id) ON DELETE CASCADE
);

-- Mid-song parameter-change events (ontime/duty at a given time). UI lands later.
CREATE TABLE IF NOT EXISTS CoilEvent (
	id 				INTEGER PRIMARY KEY AUTOINCREMENT,
	song_id 		INTEGER NOT NULL,
	coilIndex		INTEGER NOT NULL,
	atMs			INTEGER NOT NULL,
	param			TEXT NOT NULL,
	value			REAL NOT NULL,
	FOREIGN KEY (song_id) REFERENCES Song(id) ON DELETE CASCADE
);

-- Global operator config (singleton row id=1): per-coil names + default coil count.
CREATE TABLE IF NOT EXISTS AppConfig (
	id 				INTEGER PRIMARY KEY AUTOINCREMENT,
	coilNames		TEXT,
	defaultCoilCount INTEGER NOT NULL DEFAULT 3
);
INSERT OR IGNORE INTO AppConfig (id, coilNames, defaultCoilCount) VALUES (1, '[]', 3);
