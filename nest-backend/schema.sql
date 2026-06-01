-- Baseline schema for fresh installs. The structured per-coil model.
-- Existing (Flask-era) databases are transformed from the old SysexCommand
-- model by the TypeORM migration CoilModel (run automatically on boot).

CREATE TABLE IF NOT EXISTS Playlist (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT,
	coilCount INTEGER NOT NULL DEFAULT 3
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
	durationMs		INTEGER
);

CREATE TABLE IF NOT EXISTS Song (
	id 				INTEGER PRIMARY KEY AUTOINCREMENT,
	midiFile_id 	INTEGER,
	name 			TEXT,
	coilCount		INTEGER NOT NULL DEFAULT 1,
	mode			TEXT NOT NULL DEFAULT 'midi',
	output2Mask		INTEGER NOT NULL DEFAULT 0,
	FOREIGN KEY (midiFile_id) REFERENCES MidiFile(id) ON DELETE SET NULL
);

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
