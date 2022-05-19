CREATE TABLE Playlist (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT
);

CREATE TABLE PlaylistSong(
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	idx INTEGER,
	playlist_id INTEGER,
	song_id INTEGER,
	FOREIGN KEY(playlist_id) REFERENCES Playlist(id),
	FOREIGN KEY(song_id) REFERENCES Song(id)
);

CREATE TABLE Song (
	id 				INTEGER PRIMARY KEY AUTOINCREMENT,
	midiFile_id 	INTEGER,
	name 			TEXT,
	output_mapping_1 INTEGER,
	output_mapping_2 INTEGER,
	FOREIGN KEY (midiFile_id) REFERENCES MidiFile(id)
);

CREATE TABLE MidiFile (
	id 				INTEGER PRIMARY KEY AUTOINCREMENT,
	name 			TEXT,
	path 			TEXT
);

CREATE TABLE SysexCommand (
	id 				INTEGER PRIMARY KEY AUTOINCREMENT,
	song_id 		INTEGER,
	command 		TEXT,
	value 			TEXT,
	indexInSong		INTEGER,
	FOREIGN KEY (song_id) REFERENCES Song(id)
);





