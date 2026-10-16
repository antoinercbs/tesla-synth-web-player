import axios from 'axios';
import { useMidiStore } from '@/stores/midi';
import type { CoilConfig, MidiFile, Song } from '@/types/domain';
import { songPayload } from '@/midi/song-payload';

/**
 * Each song owns its MIDI file: a song is made from a file (or from a copy of
 * another song's), and its notes change through it alone. The store holds what
 * the server answers.
 */

/** What the server takes as a MIDI file (it checks the bytes too). */
export const MIDI_FILE_NAME = /\.(mid|midi)$/i;

/** A file's name without its extension: a song made from it starts with that name. */
export function baseName(name: string): string {
  return name.replace(/\.(mid|midi|kar)$/i, '');
}

/**
 * Where a song's file is read from. The bytes are rewritten in place when the
 * notes change: their hash in the URL keeps a cached copy from standing in.
 */
export function fileUrl(file: MidiFile): string {
  const path = file.path.replace(/^\./, '');
  return file.hash ? `${path}?v=${file.hash.slice(0, 16)}` : path;
}

/** A coil a new song starts with: no channel yet (the server's own, see SongsService). */
export function newCoil(coilIndex: number): CoilConfig {
  return { coilIndex, channelMask: 0, ontimeUs: 40, duty: 0.05 };
}

/** A new song from a MIDI file, named after it. */
export async function createSongFromFile(file: File): Promise<Song> {
  const store = useMidiStore();
  const form = new FormData();
  form.append('file', file);
  form.append('name', baseName(file.name));
  form.append('coilCount', String(store.appConfig.defaultCoilCount || 3));
  // No manual Content-Type: the browser sets multipart/form-data + boundary.
  const { data } = await axios.post<Song>('/api/songs/upload', form);
  store.addMidiSongToList(data);
  return data;
}

/** A song per MIDI file among `files`, in order; the others are left out. */
export async function createSongsFromFiles(files: File[]): Promise<Song[]> {
  const made: Song[] = [];
  for (const f of files) if (MIDI_FILE_NAME.test(f.name)) made.push(await createSongFromFile(f));
  return made;
}

/** A new song on a copy of `from`'s MIDI file, named after the file, its coils still to set. */
export async function createSongFromSong(from: Song): Promise<Song> {
  const store = useMidiStore();
  const coilCount = store.appConfig.defaultCoilCount || 3;
  const { data } = await axios.post<Song>('/api/songs', {
    name: baseName(from.midiFile?.name ?? from.name),
    coilCount,
    mode: 'midi',
    output2Mask: 0,
    coils: Array.from({ length: coilCount }, (_, i) => newCoil(i)),
    events: [],
    tagIds: [],
    midiFromSongId: from.id,
  });
  store.addMidiSongToList(data);
  return data;
}

/** A copy of `song` as saved: its settings, tags, and a copy of its file. */
export async function duplicateSong(song: Song, name: string): Promise<Song> {
  const { data } = await axios.post<Song>('/api/songs', { ...songPayload(song), name, midiFromSongId: song.id });
  useMidiStore().addMidiSongToList(data);
  return data;
}

/** New notes for the song: the MIDI editor's bytes, or another file. Its settings stay. */
export async function replaceSongMidi(songId: number, bytes: Blob, fileName: string): Promise<Song> {
  const form = new FormData();
  form.append('file', bytes, MIDI_FILE_NAME.test(fileName) ? fileName : `${fileName}.mid`);
  const { data } = await axios.put<Song>(`/api/songs/${songId}/midi`, form);
  useMidiStore().updateMidiSong(data);
  return data;
}
