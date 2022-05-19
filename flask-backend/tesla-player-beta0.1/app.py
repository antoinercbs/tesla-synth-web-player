from fileinput import filename
from random import Random
from flask import Flask, request, g, jsonify, url_for, send_from_directory
from werkzeug.utils import secure_filename
import json
from flask_cors import CORS
import sqlite3
import os
import random

app = Flask(__name__,
            static_url_path='', 
            static_folder='public')
CORS(app)

# --------------------------------------------------
# -------------  CONFIGURATION  --------------------
# --------------------------------------------------

DATABASE = './database.db'
UPLOAD_FOLDER = './uploads'
ALLOWED_EXTENSIONS = {'mid', 'midi'}

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER


# --------------------------------------------------
# -------------  STATIC ROUTES  --------------------
# --------------------------------------------------

@app.route('/api/ping')
def send_pong():
    return jsonify({"ping": "pong"})

@app.route('/')
def send_index():
    return send_from_directory('public', 'index.html')

@app.route('/uploads/<path:path>', methods=['GET'])
def send_upload(path):
    return send_from_directory('uploads', path)

@app.route('/editor/')
def send_editor():
    return send_from_directory('public/editor', 'edit.html')

# --------------------------------------------------
# -------------  DB MANAGEMENT  --------------------
# --------------------------------------------------

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
    return db

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def init_db():
    with app.app_context():
        db = get_db()
        with app.open_resource('schema.sql', mode='r') as f:
            db.cursor().executescript(f.read())
        db.commit()

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()
        
# --------------------------------------------------
# -------------  SYSEX API  ------------------------
# --------------------------------------------------

@app.route("/api/translate-sysex", methods=['POST'])
def translate_sysex():
    sysex_command = request.get_json()['sysexCommand']
    stream = os.popen('python3 ./Syfoh/Syfoh.py -i "{}" -m HEX --log-no-index'.format(sysex_command))
    output = stream.read()
    output = output[output.index('Out: ')+5:len(output)-1]
    return output


# --------------------------------------------------
# -------------  SONG API  -------------------------
# --------------------------------------------------

@app.route("/api/songs", methods=['POST'])
def create_song():
    db = get_db()
    jsonSong = request.get_json()
    cursor = db.execute("""
               insert into Song
               (name, midiFile_id, output_mapping_1, output_mapping_2) values (?, ?, ?, ?)
               """, 
               [jsonSong['name'], jsonSong['midiFileId'], jsonSong['outputMapping1'], jsonSong['outputMapping2']])
    songId = cursor.lastrowid
    for idx, sysex in enumerate(jsonSong['sysex']):
        db.execute("""
                   insert into SysexCommand 
                   (song_id, command, value, indexInSong) values (?, ?, ?, ?)
                   """, 
                   [songId, sysex['command'], sysex['value'], idx])
    db.commit()
    return jsonify({"id": songId
                    })


@app.route("/api/songs", methods=['PUT'])
def update_song():
    db = get_db()
    jsonSong = request.get_json()
    db.execute("""
                UPDATE Song
                SET name = ?, midiFile_id = ?, output_mapping_1 = ?, output_mapping_2 = ?
                WHERE id = ?
               """, 
               [jsonSong['name'],
                jsonSong['midiFileId'],
                jsonSong['outputMapping1'],
                jsonSong['outputMapping2'],
                jsonSong['id']])
    db.execute("""
                DELETE FROM SysexCommand
                WHERE song_id = ?
               """,
               [jsonSong['id']])
    db.commit()
    for idx, sysex in enumerate(jsonSong['sysex']):
        db.execute("""
                   insert into SysexCommand 
                   (song_id, command, value, indexInSong) values (?, ?, ?, ?)
                   """, 
                   [jsonSong['id'], sysex['command'], sysex['value'], idx])
    db.commit()
    return jsonify({"id": jsonSong['id']})
    
    
@app.route("/api/songs", methods=['GET'])
def get_songs():
    db = get_db()
    songs = db.execute("""
                        SELECT json_object(
                           'id', Song.id,
                           'name', Song.name,
                           'outputMapping1', Song.output_mapping_1,
                           'outputMapping2', Song.output_mapping_2,
                           'sysex', json_group_array(
                                json_object(
                                    'command', SysexCommand.command,
                                    'value', SysexCommand.value,
                                    'idx', SysexCommand.indexInSong
                                ) 
                            ),
                            'midiFile', json_object(
                                'id', MidiFile.id,
                                'name', MidiFile.name,
                                'path', MidiFile.path
                            )
                        )
                        FROM Song
                        LEFT JOIN SysexCommand ON Song.id = SysexCommand.song_id 
                        LEFT JOIN MidiFile ON Song.midiFile_id = MidiFile.id
                        GROUP BY Song.id
                       """).fetchall()
    songList = list(map(lambda x: json.loads(x[0]), songs))
    return jsonify(songList)

@app.route("/api/songs", methods=['DELETE'])
def delete_song():
    id = request.args.get('id')
    db = get_db()
    db.execute("""
                DELETE FROM Song
                WHERE id = ?
                """,
                [id])
    db.execute("""
                DELETE FROM PlaylistSong
                WHERE song_id = ?
               """,
               [id])
    db.commit()
    return "OK"

# --------------------------------------------------
# -------------  MIDI API  -------------------------
# --------------------------------------------------

@app.route("/api/midi", methods=['POST'])
def upload_midi():
    if 'file' not in request.files:
        return
    file = request.files['file']
    if file.filename == 'blob':
        file.filename = request.form['name']
    for f in os.listdir(app.config['UPLOAD_FOLDER']):
        if (f == file.filename):
            file.save(os.path.join(app.config['UPLOAD_FOLDER'], file.filename))
            return jsonify({"name": file.filename})
    if file and allowed_file(file.filename):
        filename = str(random.randint(0, 1000000)) + '_'+ secure_filename(file.filename)
        path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(path)
        db = get_db()
        cursor = db.execute("""
               insert into MidiFile
               (name, path) values (?, ?)
               """, 
               [file.filename, path])
        fileId = cursor.lastrowid
        db.commit()
        return jsonify({"id": fileId, "name": file.filename, "path": path})
    
@app.route("/api/midi", methods=['GET'])
def get_midis():
    db = get_db()
    midis = db.execute("""
                        SELECT json_object(
                           'id', MidiFile.id,
                           'name', MidiFile.name,
                           'path', MidiFile.path
                        )
                        FROM MidiFile
                       """).fetchall()
    midiList = list(map(lambda x: json.loads(x[0]), midis))
    return jsonify(midiList)

@app.route("/api/midi", methods=['DELETE'])
def delete_midi():
    id = request.args.get('id')
    db = get_db()
    path = db.execute("""
                       SELECT path
                       FROM MidiFile
                       WHERE id = ?
                      """,
                      [id]).fetchone()[0]
    db.execute("""
                DELETE FROM MidiFile
                WHERE id = ?
                """,
                [id])
    db.commit()
    os.remove(path)
    return "OK"

# --------------------------------------------------
# -------------  PLAYLIST API  ---------------------
# --------------------------------------------------

@app.route("/api/playlists", methods=['POST'])
def create_playlist():
    db = get_db()
    jsonPlaylist = request.get_json()
    cursor = db.execute("""
               INSERT INTO Playlist
               (name) VALUES (?)
               """, 
               [jsonPlaylist['name']])
    playlistId = cursor.lastrowid
    for idx, songId in enumerate(jsonPlaylist['songIds']):
        db.execute("""
                INSERT INTO PlaylistSong
                (playlist_id, song_id, idx) VALUES (?, ?, ?)
                """,
                [playlistId, songId, idx])
    db.commit()
    return jsonify({"id": playlistId,
                    "name": jsonPlaylist['name'],
                    "songIds": jsonPlaylist['songIds']})
    
@app.route("/api/playlists", methods=['PUT'])
def update_playlist():
    db = get_db()
    jsonPlaylist = request.get_json()
    db.execute("""
               UPDATE Playlist
               SET name = ?
               WHERE id = ?
               """, 
               [jsonPlaylist['name'], jsonPlaylist['id']])
    db.execute("""
                DELETE FROM PlaylistSong
                WHERE playlist_id = ?
               """,
               [jsonPlaylist['id']])
    db.commit()
    for idx, songId in enumerate(jsonPlaylist['songIds']):
        db.execute("""
                    INSERT INTO PlaylistSong
                    (playlist_id, song_id, idx) VALUES (?, ?, ?)
                    """,
                    [jsonPlaylist['id'], songId, idx])
    db.commit()
    return jsonify({"id": jsonPlaylist['id'],
                    "name": jsonPlaylist['name'],
                    "songIds": jsonPlaylist['songIds']})
    
@app.route("/api/playlists", methods=['GET'])
def get_playlists():
    db = get_db()
    playlists = db.execute("""
                        SELECT json_object(
                           'id', Playlist.id,
                           'name', Playlist.name,
                           'songIds', json_group_array(
                                PlaylistSong.song_id
                            )
                        )
                        FROM Playlist
                        LEFT JOIN PlaylistSong ON Playlist.id = PlaylistSong.playlist_id
                        GROUP BY Playlist.id
                        ORDER BY PlaylistSong.idx
                       """).fetchall()
    playlistList = list(map(lambda x: json.loads(x[0]), playlists))
    return jsonify(playlistList)
    
@app.route("/api/playlists", methods=['DELETE'])
def delete_playlist():
    id = request.args.get('id')
    db = get_db()
    db.execute("""
                DELETE FROM Playlist
                WHERE id = ?
                """,
                [id])
    db.execute("""
                DELETE FROM PlaylistSong
                WHERE playlist_id = ?
               """,
               [id])
    db.commit()
    return "OK"

    
if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0')