import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { markRaw, watch, type WatchStopHandle } from 'vue';
import type { Output } from 'webmidi';
import { useMidiStore } from '@/stores/midi';
import type { MidiSink } from '@/audio/tesla-synth';
import type { AppConfig, AppTag, MidiFile, Song } from '@/types/domain';
import { buildDemoLibrary, DEMO_PATH_PREFIX, type DemoLibrary } from './data';

/**
 * Demo mode, for the guided tour: the app runs on the sample library of data.ts
 * without any component knowing. Reads the app makes through axios (songs, files,
 * playlists, settings, MIDI bytes) are answered from the library; every write to
 * /api is refused, so nothing reaches the server. On exit the store gets the real
 * data back and views holding their own (playlists, tunings) re-read it.
 *
 * The tour presses Play on a demo song: the outputs are swapped for a silent sink
 * for the whole demo (and put back if anything re-selects a real one meanwhile),
 * so no note ever reaches real coils.
 */
// the store hands outputs back unwrapped by Vue; they are the same (markRaw'd) objects
type Outputs = { output: MidiSink | null; output2: Output | null };
let lib: DemoLibrary | null = null;
let interceptor: number | null = null;
let guard: WatchStopHandle | null = null;
let saved: ({ files: MidiFile[]; songs: Song[]; tags: AppTag[]; config: AppConfig; viz: string | null } & Outputs) | null = null;

const silent: MidiSink = markRaw({
  id: '__tour_demo__',
  name: 'Tour demo (silent)',
  send: () => {},
  sendSysex: () => {},
  sendAllSoundOff: () => {},
  clear: () => {},
});

/** True while the player can only reach the silent sink: the tour's Play depends on it. */
export function isDemoOutputActive(): boolean {
  const store = useMidiStore();
  return lib !== null && store.midiOutput === silent && store.midiOutput2 === null;
}

const reply = (config: InternalAxiosRequestConfig, data: unknown): Promise<AxiosResponse> =>
  Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config, request: {} });

function adapterFor(config: InternalAxiosRequestConfig, l: DemoLibrary): ((c: InternalAxiosRequestConfig) => Promise<AxiosResponse>) | null {
  const path = new URL(axios.getUri(config), window.location.origin).pathname;
  if ((config.method ?? 'get').toLowerCase() !== 'get') {
    return path.startsWith('/api/')
      ? (c) => Promise.reject(new AxiosError('Demo mode: nothing is saved', 'ERR_DEMO', c))
      : null;
  }
  const json: Record<string, unknown> = {
    '/api/midi': l.files,
    '/api/songs': l.songs,
    '/api/tags': l.tags,
    '/api/settings': l.config,
    '/api/playlists': l.playlists,
    '/api/tunings': [],
  };
  if (path in json) return (c) => reply(c, structuredClone(json[path]));
  const bytes = path.startsWith(DEMO_PATH_PREFIX) ? l.bytes.get(path) : undefined;
  if (bytes) {
    return (c) => reply(c, c.responseType === 'blob'
      ? new Blob([bytes as BlobPart], { type: 'audio/midi' })
      : bytes.slice().buffer);
  }
  return null; // anything else (auth, ping, …) goes to the server as usual
}

function applyLibrary(l: DemoLibrary): void {
  const store = useMidiStore();
  store.setMidiFileList(structuredClone(l.files));
  store.setMidiSongList(structuredClone(l.songs));
  store.setTagList(structuredClone(l.tags));
  store.setAppConfig(structuredClone(l.config));
}

export function enterDemo(lang: string): void {
  if (lib) return;
  const l = buildDemoLibrary(lang);
  lib = l;
  interceptor = axios.interceptors.request.use((config) => {
    const adapter = adapterFor(config, l);
    if (adapter) config.adapter = adapter;
    return config;
  });
  const store = useMidiStore();
  saved = {
    files: store.midiFileList,
    songs: store.midiSongList,
    tags: store.tagList,
    config: store.appConfig,
    viz: localStorage.getItem('playerViz'),
    output: store.midiOutput,
    output2: store.midiOutput2 as Output | null,
  };
  applyLibrary(l);
  store.setMidiOutput(silent);
  store.setMidiOutput2(null);
  // a device plugged in (or the sidebar re-resolving) must not slip a real output back in
  guard = watch(() => [store.midiOutput, store.midiOutput2] as const, ([out, out2]) => {
    if (!saved) return;
    if (out !== silent) {
      saved.output = out;
      store.setMidiOutput(silent);
    }
    if (out2 !== null) {
      saved.output2 = out2 as Output;
      store.setMidiOutput2(null);
    }
  });
  // the tour shows the player in the editor's dock: open it on the coil lanes
  localStorage.setItem('playerViz', 'lanes');
  store.bumpDataRevision();
}

/**
 * Put the sample library back if real data landed in the meantime: requests the
 * app sent just before the tour started (first visit) answer after it.
 */
export function reassertDemo(): void {
  if (!lib) return;
  const store = useMidiStore();
  if (!store.midiSongList.some((s) => s.id === lib?.songs[0].id)) applyLibrary(lib);
}

/** Leave demo mode; returns the player view the user had (see the overlay's cleanup). */
export function exitDemo(): string | null {
  if (!lib) return null;
  const viz = saved?.viz ?? null;
  guard?.();
  guard = null;
  if (interceptor !== null) axios.interceptors.request.eject(interceptor);
  interceptor = null;
  lib = null;
  const store = useMidiStore();
  if (saved) {
    // instant restore, then the server's current state (also covers a raced start)
    store.setMidiFileList(saved.files);
    store.setMidiSongList(saved.songs);
    store.setTagList(saved.tags);
    store.setAppConfig(saved.config);
    if (saved.viz === null) localStorage.removeItem('playerViz');
    else localStorage.setItem('playerViz', saved.viz);
    store.setMidiOutput(saved.output);
    store.setMidiOutput2(saved.output2);
  }
  saved = null;
  axios.get('/api/midi').then((r) => store.setMidiFileList(r.data)).catch(() => {});
  axios.get('/api/songs').then((r) => store.setMidiSongList(r.data)).catch(() => {});
  axios.get('/api/settings').then((r) => store.setAppConfig(r.data)).catch(() => {});
  axios.get('/api/tags').then((r) => store.setTagList(r.data)).catch(() => {});
  store.bumpDataRevision();
  return viz;
}
