import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { markRaw, watch, type WatchStopHandle } from 'vue';
import type { Output } from 'webmidi';
import { useMidiStore } from '@/stores/midi';
import type { MidiSink } from '@/audio/tesla-synth';
import type { AppConfig, AppTag, MidiFile, Song } from '@/types/domain';
import type { TuningDraft, TuningRecord } from '@/tuning/api';
import { SessionLink } from '@/tuning/session-link';
import { buildDemoLibrary, DEMO_PATH_PREFIX, type DemoLibrary } from './data';
import { fakeTuningRequest, resetFakeCamera } from './fake-camera';

/**
 * Demo mode, for the guided tour: the app runs on the sample library of data.ts
 * without any component knowing. Reads the app makes through axios (songs, files,
 * playlists, settings, MIDI bytes) are answered from the library; every write to
 * /api is refused, so nothing reaches the server, except saving a tuning, kept
 * in the library for the rest of the tour. The tuning form's weather and place
 * name (fetch, not axios) get demo answers too. On exit the store gets the real
 * data back and views holding their own (playlists, tunings) re-read it.
 *
 * The tour presses Play on a demo song and runs tuning trials: the outputs are
 * swapped for a silent sink for the whole demo (and put back if anything
 * re-selects a real one meanwhile), so no note ever reaches real coils. The
 * tuning relay talks to a fake phone (fake-camera.ts).
 */
// the store hands outputs back unwrapped by Vue; they are the same (markRaw'd) objects
type Outputs = { output: MidiSink | null; output2: Output | null };
let lib: DemoLibrary | null = null;
let interceptor: number | null = null;
let guard: WatchStopHandle | null = null;
let saved: ({ files: MidiFile[]; songs: Song[]; tags: AppTag[]; config: AppConfig; storage: Record<string, string | null> } & Outputs) | null = null;
const realTransport = SessionLink.defaultTransport;
const realFetch = window.fetch;

const DEMO_WEATHER = { current: { temperature_2m: 17.4, relative_humidity_2m: 63, surface_pressure: 1014, weather_code: 2, precipitation: 0, is_day: 1 } };
const DEMO_ADDRESS = { address: { road: 'Jardin', city: 'Demo' } };
function demoFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
  const answer = url.hostname === 'api.open-meteo.com' ? DEMO_WEATHER : url.hostname === 'nominatim.openstreetmap.org' ? DEMO_ADDRESS : null;
  if (!answer) return realFetch(input, init);
  return Promise.resolve(new Response(JSON.stringify(answer), { headers: { 'Content-Type': 'application/json' } }));
}

// what the pages read from storage when they mount: the player opens on the coil
// lanes (the editor's dock), the tuning page on short trials over the fake phone's range
const DEMO_STORAGE: Record<string, string> = {
  playerViz: 'lanes',
  tuneMode: 'tune',
  tuningSetup: JSON.stringify({
    coilIndex: 0, fiberIndex: 0, primaryTurns: 8, tapMin: 4, tapMax: 8, tapStep: 0.25,
    notes: [48, 60], holdMs: 2000, gapMs: 500, ontimeUs: 40, duty: 0.05, program: null,
  }),
};

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
  const url = new URL(axios.getUri(config), window.location.origin);
  const path = url.pathname;
  const method = (config.method ?? 'get').toLowerCase();
  if (path.startsWith('/api/tuning/sessions')) {
    return (c) => {
      const data = fakeTuningRequest(method, url, typeof c.data === 'string' ? JSON.parse(c.data) : c.data);
      return data === undefined ? Promise.reject(new AxiosError('Demo mode: no such session', 'ERR_DEMO', c)) : reply(c, data);
    };
  }
  if (method === 'post' && path === '/api/tunings') {
    return (c) => {
      const draft = (typeof c.data === 'string' ? JSON.parse(c.data) : c.data) as TuningDraft;
      const record: TuningRecord = { ...draft, id: 9400 + l.tunings.length, uuid: null, updatedAt: null, editorName: null };
      l.tunings.unshift(record);
      return reply(c, structuredClone(record));
    };
  }
  if (method !== 'get') {
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
    '/api/tunings': l.tunings,
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
    storage: Object.fromEntries(Object.keys(DEMO_STORAGE).map((k) => [k, localStorage.getItem(k)])),
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
  for (const [k, v] of Object.entries(DEMO_STORAGE)) localStorage.setItem(k, v);
  SessionLink.defaultTransport = () => 'poll';
  window.fetch = demoFetch;
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
  const viz = saved?.storage.playerViz ?? null;
  guard?.();
  guard = null;
  if (interceptor !== null) axios.interceptors.request.eject(interceptor);
  interceptor = null;
  lib = null;
  SessionLink.defaultTransport = realTransport;
  window.fetch = realFetch;
  resetFakeCamera();
  const store = useMidiStore();
  if (saved) {
    // instant restore, then the server's current state (also covers a raced start)
    store.setMidiFileList(saved.files);
    store.setMidiSongList(saved.songs);
    store.setTagList(saved.tags);
    store.setAppConfig(saved.config);
    for (const [k, v] of Object.entries(saved.storage)) {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    }
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
