-- Baseline schema for fresh installs. The structured per-coil model.
-- Existing (Flask-era) databases are transformed from the old SysexCommand
-- model by the TypeORM migration CoilModel (run automatically on boot).

CREATE TABLE IF NOT EXISTS Playlist (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT,
	coilCount INTEGER NOT NULL DEFAULT 3,
	uuid TEXT,
	updatedAt INTEGER,
	contentHash TEXT,
	editorName TEXT
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
	channels		INTEGER,
	programs		TEXT,
	uuid			TEXT,
	updatedAt		INTEGER,
	contentHash		TEXT,
	editorName		TEXT
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
	editorName		TEXT,
	stereo			TEXT,
	variants		TEXT,			-- its other variants, on other coils (JSON, songs/variants.ts); NULL: none
	FOREIGN KEY (midiFile_id) REFERENCES MidiFile(id) ON DELETE SET NULL
);

-- Sync identity uniqueness. Partial (over non-null uuids) and named identically
-- to the AddSyncColumns migration, so a fresh DB and a migrated DB share the
-- exact same structure (and the migration's CREATE ... IF NOT EXISTS is a no-op).
CREATE UNIQUE INDEX IF NOT EXISTS UQ_song_uuid     ON Song(uuid)     WHERE uuid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS UQ_playlist_uuid ON Playlist(uuid) WHERE uuid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS UQ_midifile_uuid ON MidiFile(uuid) WHERE uuid IS NOT NULL;
-- A song owns its MIDI file (named like the OwnMidiFiles migration's).
CREATE UNIQUE INDEX IF NOT EXISTS UQ_song_midifile ON Song(midiFile_id) WHERE midiFile_id IS NOT NULL;

-- Per-song, per-coil configuration. Replaces the old opaque SysexCommand list:
-- the browser compiles these rows into Syntherrupter SysEx on demand.
CREATE TABLE IF NOT EXISTS Coil (
	id 				INTEGER PRIMARY KEY AUTOINCREMENT,
	song_id 		INTEGER NOT NULL,
	coilIndex		INTEGER NOT NULL,
	coilUuid		TEXT,			-- the inventory's coil (TeslaCoil.uuid) at this place; NULL: the one at coilIndex
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
	ramp			INTEGER,
	FOREIGN KEY (song_id) REFERENCES Song(id) ON DELETE CASCADE
);

-- Free-form song labels. Named identically to the MidiChannelsAndTags migration
-- so a fresh DB and a migrated one share the exact same structure.
CREATE TABLE IF NOT EXISTS Tag (
	id				INTEGER PRIMARY KEY AUTOINCREMENT,
	name			TEXT NOT NULL,
	color			TEXT NOT NULL DEFAULT '#46e0ff'
);

CREATE TABLE IF NOT EXISTS song_tags (
	songId			INTEGER NOT NULL,
	tagId			INTEGER NOT NULL,
	PRIMARY KEY (songId, tagId),
	FOREIGN KEY (songId) REFERENCES Song(id) ON DELETE CASCADE,
	FOREIGN KEY (tagId)  REFERENCES Tag(id)  ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS IDX_song_tags_song ON song_tags(songId);
CREATE INDEX IF NOT EXISTS IDX_song_tags_tag  ON song_tags(tagId);

-- Global operator config (singleton row id=1): per-coil names + default coil count.
CREATE TABLE IF NOT EXISTS AppConfig (
	id 				INTEGER PRIMARY KEY AUTOINCREMENT,
	coilNames		TEXT,
	defaultCoilCount INTEGER NOT NULL DEFAULT 3,
	wiring			TEXT			-- JSON: the coil (TeslaCoil.uuid) on each output, '' free; NULL: coil k on output k
);
INSERT OR IGNORE INTO AppConfig (id, coilNames, defaultCoilCount) VALUES (1, '[]', 3);

-- Camera-assisted primary tuning history (one row per saved tuning of a coil).
-- Named identically to the CoilTuning migration so fresh and migrated DBs match.
CREATE TABLE IF NOT EXISTS CoilTuning (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	coilIndex     INTEGER NOT NULL,
	coilName      TEXT,
	createdAt     INTEGER NOT NULL,
	location      TEXT,
	lat           REAL,
	lon           REAL,
	indoor        INTEGER,
	tempC         REAL,
	humidityPct   REAL,
	pressureHpa   REAL,
	weatherCode   INTEGER,
	ground        TEXT,
	comment       TEXT,
	primaryTurns  REAL,
	tapStep       REAL,
	tapMin        REAL,
	tapMax        REAL,
	tapTurns      REAL NOT NULL,
	bestPx        REAL,
	tone          TEXT,
	camera        TEXT,
	trials        TEXT,
	uuid          TEXT,
	updatedAt     INTEGER,
	contentHash   TEXT,
	editorName    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS UQ_coiltuning_uuid ON CoilTuning(uuid) WHERE uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS IDX_coiltuning_coil ON CoilTuning(coilIndex, createdAt);

-- User-defined Syntherrupter envelopes (programs 20-63), pushed to the device at
-- play time. Named identically to the Envelopes migration so fresh and migrated
-- DBs match. The program number is also the sync identity (no uuid).
CREATE TABLE IF NOT EXISTS Envelope (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	program      INTEGER NOT NULL,
	name         TEXT,
	steps        TEXT NOT NULL,
	updatedAt    INTEGER,
	contentHash  TEXT,
	editorName   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS UQ_envelope_program ON Envelope(program);

-- The coil inventory: one row per real Tesla coil, its spec as the front writes
-- it. Named identically to the TeslaCoils migration (which also seeds it).
CREATE TABLE IF NOT EXISTS TeslaCoil (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	uuid         TEXT NOT NULL,
	name         TEXT NOT NULL,
	position     INTEGER NOT NULL DEFAULT 0,
	spec         TEXT NOT NULL,
	twinGroup    TEXT,
	notes        TEXT,
	updatedAt    INTEGER,
	contentHash  TEXT,
	editorName   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS UQ_teslacoil_uuid ON TeslaCoil(uuid);

-- The club's scenes: a decor and the inventory's coils posed in it, its data as
-- the front writes it. Named identically to the Scenes migration.
CREATE TABLE IF NOT EXISTS Scene (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	uuid         TEXT NOT NULL,
	name         TEXT NOT NULL,
	position     INTEGER NOT NULL DEFAULT 0,
	data         TEXT NOT NULL,
	updatedAt    INTEGER,
	contentHash  TEXT,
	editorName   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS UQ_scene_uuid ON Scene(uuid);
