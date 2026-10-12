import axios from 'axios';
import { useMidiStore } from '@/stores/midi';
import type { MidiFile } from '@/types/domain';

/** Sends a .mid to the library; the store holds it once the server has. */
export async function uploadMidiFile(file: File): Promise<MidiFile> {
  const form = new FormData();
  form.append('file', file);
  // No manual Content-Type: the browser sets multipart/form-data + boundary.
  const { data } = await axios.post<MidiFile>('/api/midi', form);
  useMidiStore().addMidiFileToList(data);
  return data;
}

/** A file's name without its extension: a song made from it starts with that name. */
export function baseName(name: string): string {
  return name.replace(/\.(mid|midi|kar)$/i, '');
}
