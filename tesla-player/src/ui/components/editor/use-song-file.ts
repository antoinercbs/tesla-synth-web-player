import axios from 'axios';
import { computed, markRaw, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import type { MidiFile } from '@/model/domain';
import { MidFile, type MidiAnalysis } from '@/model/midi/analyze';
import { MidEditor } from '@/model/midi/edit/editor';
import { parseSmf } from '@/engine/midi/smf';
import { fileUrl } from '@/app/song-file';

/**
 * The song's file in the atelier: its bytes and its notes, analysed, read again
 * when it changes on the server (a new URL, see fileUrl); with the envelopes
 * changed here (`programs`, by channel), the analysis the board's release
 * follows and a copy the player hears before they are saved (`previewUrl`).
 */
export function useSongFile(file: () => MidiFile | null, programs: () => Record<number, number>) {
  // thousands of notes, replaced whole: kept out of Vue's deep proxies
  const fileAnalysis = shallowRef<MidiAnalysis | null>(null);
  const fileBytes = shallowRef<Uint8Array | null>(null);
  const analysis = computed<MidiAnalysis | null>(() => {
    const a = fileAnalysis.value;
    const p = programs();
    if (!a || !Object.keys(p).length) return a;
    return markRaw({ ...a, programByChannel: { ...a.programByChannel, ...p } });
  });

  /** Another song's notes must not stand in while its own load. */
  function clear(): void {
    fileAnalysis.value = null;
    fileBytes.value = null;
  }

  let seq = 0;
  async function read(url: string | null): Promise<void> {
    const mine = ++seq;
    if (!url) {
      clear();
      return;
    }
    try {
      const { data } = await axios.get(url, { responseType: 'arraybuffer' });
      if (mine !== seq) return;
      const bytes = new Uint8Array(data as ArrayBuffer);
      fileBytes.value = markRaw(bytes);
      fileAnalysis.value = markRaw(new MidFile(parseSmf(bytes)).analysis());
    } catch {
      if (mine !== seq) return;
      clear();
    }
  }
  watch(() => {
    const f = file();
    return f ? fileUrl(f) : null;
  }, read, { immediate: true });

  /** The file with the envelopes changed here; null without the file. */
  function withPrograms(): Uint8Array<ArrayBuffer> | null {
    return fileBytes.value ? MidEditor.withPrograms(fileBytes.value, programs()) : null;
  }

  const previewUrl = ref<string | null>(null);
  watch([programs, fileBytes], () => {
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = null;
    if (!fileBytes.value || !Object.keys(programs()).length) return;
    try {
      previewUrl.value = URL.createObjectURL(new Blob([withPrograms()!], { type: 'audio/midi' }));
    } catch (err) {
      console.error('Envelope preview failed', err);
    }
  }, { deep: true });
  onBeforeUnmount(() => {
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  });

  return { fileAnalysis, fileBytes, analysis, previewUrl, clear, withPrograms };
}
