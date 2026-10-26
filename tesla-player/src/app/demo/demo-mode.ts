import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { markRaw, watch, type WatchStopHandle } from 'vue';
import type { Output } from 'webmidi';
import { useMidiStore } from '@/app/stores/midi';
import { useScenesStore } from '@/app/stores/scenes';
import type { MidiSink } from '@/engine/audio/synth';
import type { DeviceLink } from '@/model/devices/device-link';
import { DevCoilLimits, type CoilLimits } from '@/model/devices/coil-limits';
import type { AppConfig, AppTag, CustomEnvelope, Song } from '@/model/domain';
import type { TuningDraft, TuningRecord } from '@/api/tuning';
import type { TeslaCoil } from '@/model/coils/inventory';
import { listScenes, type SceneRecord } from '@/api/scenes';
import { SessionLink } from '@/api/tuning-session';
import { buildDemoLibrary, DEMO_PATH_PREFIX, type DemoLibrary } from './data';
import { fakeCamera } from './fake-camera';
import { fakeDeviceLink } from './fake-device';

/**
 * Demo mode, for the guided tour: the app runs on the sample library of data.ts
 * without any component knowing. Reads the app makes through axios (songs,
 * playlists, settings, the songs' MIDI bytes) are answered from the library; every write to
 * /api is refused, so nothing reaches the server, except saving a tuning, kept
 * in the library for the rest of the tour. The tuning form's weather and place
 * name (fetch, not axios) get demo answers too. On exit the store gets the real
 * data back and views holding their own (playlists, tunings) re-read it.
 *
 * The tour presses Play on a demo song and runs tuning trials: the outputs are
 * swapped for a silent sink for the whole demo (and put back if anything
 * re-selects a real one meanwhile), so no note ever reaches real coils. The
 * tuning relay talks to a fake phone (fake-camera.ts), the Syntherrupter page
 * to a fake device (fake-device.ts), guarded the same way.
 */
// the store hands outputs back unwrapped by Vue; they are the same (markRaw'd) objects
type Outputs = { output: MidiSink | null; output2: Output | null; deviceLink: DeviceLink | null };
/** What demo mode puts aside, to give it back. */
type Saved = {
  songs: Song[]; tags: AppTag[]; envelopes: CustomEnvelope[]; config: AppConfig; coils: TeslaCoil[]; scenes: SceneRecord[];
  storage: Record<string, string | null>; lastLimits: CoilLimits[];
} & Outputs;
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

// what the pages read from storage when they mount: the player opens on the coils'
// load, the play page on songs (its tour switches to Live and back), the tuning
// page on short trials over the fake phone's range
const DEMO_STORAGE: Record<string, string> = {
  playerViz: 'load',
  playMode: 'playback',
  playQueue: '{}',
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

const reply = (config: InternalAxiosRequestConfig, data: unknown): Promise<AxiosResponse> =>
  Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config, request: {} });

function adapterFor(config: InternalAxiosRequestConfig, l: DemoLibrary): ((c: InternalAxiosRequestConfig) => Promise<AxiosResponse>) | null {
  const url = new URL(axios.getUri(config), window.location.origin);
  const path = url.pathname;
  const method = (config.method ?? 'get').toLowerCase();
  if (path.startsWith('/api/tuning/sessions')) {
    return (c) => {
      const data = fakeCamera.request(method, url, typeof c.data === 'string' ? JSON.parse(c.data) : c.data);
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
    '/api/songs': l.songs,
    '/api/tags': l.tags,
    '/api/settings': l.config,
    '/api/playlists': l.playlists,
    '/api/tunings': l.tunings,
    '/api/envelopes': l.envelopes,
    '/api/coils': l.coils,
    // the sample coils are not the club's: none of its scenes poses them, the demo's own does
    '/api/scenes': l.scenes,
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
  store.setMidiSongList(structuredClone(l.songs));
  store.setTagList(structuredClone(l.tags));
  store.setEnvelopeList(structuredClone(l.envelopes));
  store.setAppConfig(structuredClone(l.config));
  store.setCoilList(structuredClone(l.coils));
  useScenesStore().setList(structuredClone(l.scenes));
}

/** Demo mode (see the module comment): on while the tour runs. */
export class DemoMode {
  private lib: DemoLibrary | null = null;
  private interceptor: number | null = null;
  private guard: WatchStopHandle | null = null;
  private saved: Saved | null = null;

  /** True while the player can only reach the silent sink: the tour's Play depends on it. */
  get outputSilenced(): boolean {
    const store = useMidiStore();
    return this.lib !== null && store.midiOutput === silent && store.midiOutput2 === null;
  }

  enter(lang: string): void {
    if (this.lib) return;
    const l = buildDemoLibrary(lang);
    this.lib = l;
    this.interceptor = axios.interceptors.request.use((config) => {
      const adapter = adapterFor(config, l);
      if (adapter) config.adapter = adapter;
      return config;
    });
    const store = useMidiStore();
    this.saved = {
      songs: store.midiSongList,
      tags: store.tagList,
      envelopes: store.envelopeList,
      config: store.appConfig,
      coils: store.coilList,
      scenes: useScenesStore().list,
      // the fake board's limits must not stand as the real board's last reading
      storage: Object.fromEntries([...Object.keys(DEMO_STORAGE), DevCoilLimits.storageKey(store.boardId)].map((k) => [k, localStorage.getItem(k)])),
      lastLimits: store.lastCoilLimits,
      output: store.midiOutput,
      output2: store.midiOutput2 as Output | null,
      deviceLink: store.deviceLink,
    };
    applyLibrary(l);
    store.setMidiOutput(silent);
    store.setMidiOutput2(null);
    store.setDeviceLink(fakeDeviceLink);
    // a device plugged in (or the sidebar re-resolving) must not slip a real output back in
    this.guard = watch(() => [store.midiOutput, store.midiOutput2, store.deviceLink] as const, ([out, out2, link]) => {
      if (!this.saved) return;
      if (out !== silent) {
        this.saved.output = out;
        store.setMidiOutput(silent);
      }
      if (out2 !== null) {
        this.saved.output2 = out2 as Output;
        store.setMidiOutput2(null);
      }
      if (link !== fakeDeviceLink) {
        this.saved.deviceLink = link;
        store.setDeviceLink(fakeDeviceLink);
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
  reassert(): void {
    if (!this.lib) return;
    const store = useMidiStore();
    if (!store.midiSongList.some((s) => s.id === this.lib?.songs[0].id)) applyLibrary(this.lib);
  }

  /** Leave demo mode. The pages that read the demo are gone by then (see the overlay's cleanup). */
  exit(): void {
    if (!this.lib) return;
    this.guard?.();
    this.guard = null;
    if (this.interceptor !== null) axios.interceptors.request.eject(this.interceptor);
    this.interceptor = null;
    this.lib = null;
    SessionLink.defaultTransport = realTransport;
    window.fetch = realFetch;
    fakeCamera.reset();
    const store = useMidiStore();
    if (this.saved) {
      // instant restore, then the server's current state (also covers a raced start)
      store.setMidiSongList(this.saved.songs);
      store.setTagList(this.saved.tags);
      store.setEnvelopeList(this.saved.envelopes);
      store.setAppConfig(this.saved.config);
      store.setCoilList(this.saved.coils);
      useScenesStore().setList(this.saved.scenes);
      for (const [k, v] of Object.entries(this.saved.storage)) {
        if (v === null) localStorage.removeItem(k);
        else localStorage.setItem(k, v);
      }
      store.$patch({ lastCoilLimits: this.saved.lastLimits });
      store.setMidiOutput(this.saved.output);
      store.setMidiOutput2(this.saved.output2);
      store.setDeviceLink(this.saved.deviceLink);
    }
    this.saved = null;
    axios.get('/api/songs').then((r) => store.setMidiSongList(r.data)).catch(() => {});
    axios.get('/api/settings').then((r) => store.setAppConfig(r.data)).catch(() => {});
    axios.get('/api/tags').then((r) => store.setTagList(r.data)).catch(() => {});
    axios.get('/api/envelopes').then((r) => store.setEnvelopeList(r.data)).catch(() => {});
    axios.get('/api/coils').then((r) => store.setCoilList(r.data)).catch(() => {});
    listScenes().then((list) => useScenesStore().setList(list)).catch(() => {});
    store.bumpDataRevision();
  }
}

/** The app's one demo mode. */
export const demoMode = new DemoMode();
