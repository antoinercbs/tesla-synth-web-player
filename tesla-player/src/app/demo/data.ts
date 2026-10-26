import type { AppConfig, AppTag, CoilConfig, CustomEnvelope, MidiFile, Playlist, Song } from '@/model/domain';
import type { TuningRecord } from '@/api/tuning';
import type { SceneRecord } from '@/api/scenes';
import type { TeslaCoil } from '@/model/coils/inventory';
import { SndEnvelope } from '@/model/envelopes';
import { SndEnvPrograms } from '@/model/sysex/envelopes';
import { MidStereo } from '@/model/midi/stereo';
import { drums, smf, voice, type Smf } from './smf';

/**
 * The tour's sample library: public-domain tunes (simplified), generated as real
 * MIDI so the player, previews and instruments all have something to show. Ids
 * are out of the way of real ones; nothing here ever reaches the server.
 */
export const DEMO_SONG_ID = 9001;
export const DEMO_PLAYLIST_ID = 9101;
// the first tune's file: the MIDI editor's tour opens it
const DEMO_FILE_ID = 9201;
// the demo's one envelope of its own, for the envelopes tour
export const DEMO_ENVELOPE_PROGRAM = 20;
export const DEMO_PATH_PREFIX = '/uploads/tour-demo-';
// where the tuning tour's phone says it is: the garden of Zeus's last tuning
export const DEMO_PLACE = { lat: 45.7578, lon: 4.832 };
// the three coils on a concert stage, one of them behind a Faraday cage: the 3D views' scene
export const DEMO_SCENE_UUID = 'tour-demo-scene-0';

type Lang = 'en' | 'fr';
const WORDS: Record<Lang, Record<string, string>> = {
  en: {
    game: 'Video game', classical: 'Classical', folk: 'Folk', demo: 'Demo', playlist: 'Demo night', ode: 'Ode to Joy', hall: 'In the Hall of the Mountain King', pad: 'Soft pad',
    garden: 'Garden', workshop: 'Workshop', fair: 'Village fair', raised: 'Toroid raised by 2 cm', wet: 'Wet grass: tap lower than in the garden',
    scene: 'Concert with a cage',
  },
  fr: {
    game: 'Jeu vidéo', classical: 'Classique', folk: 'Folklore', demo: 'Démo', playlist: 'Soirée démo', ode: 'Ode à la joie', hall: 'Dans l’antre du roi de la montagne', pad: 'Nappe douce',
    garden: 'Jardin', workshop: 'Atelier', fair: 'Fête du village', raised: 'Toroïde remonté de 2 cm', wet: 'Herbe mouillée : prise plus basse qu’au jardin',
    scene: 'Concert avec cage',
  },
};

const TUNES: { key: string; bpm: number; build: () => Smf }[] = [
  {
    key: 'korobeiniki', bpm: 150, build: () => smf(150, [
      voice(0, 80, 'E5:1 B4:.5 C5:.5 D5:1 C5:.5 B4:.5 A4:1 A4:.5 C5:.5 E5:1 D5:.5 C5:.5 B4:1.5 C5:.5 D5:1 E5:1 C5:1 A4:1 A4:2 r:.5 D5:1 F5:.5 A5:1 G5:.5 F5:.5 E5:1.5 C5:.5 E5:1 D5:.5 C5:.5 B4:1 B4:.5 C5:.5 D5:1 E5:1 C5:1 A4:1 A4:2', { rep: 3 }),
      voice(1, 81, 'C5+E5:2 B4+D5:2 A4+C5:2 G#4+B4:2 A4+C5:2 G#4+B4:2 A4+C5:4 D5+F5:2 C5+E5:2 B4+D5:2 G#4+B4:2 A4+C5:2 G#4+B4:2 A4+C5:4', { rep: 3, vel: 70 }),
      voice(2, 38, 'A2:1 E3:1 A2:1 E3:1 G#2:1 E3:1 G#2:1 E3:1 A2:1 E3:1 A2:1 E3:1 G#2:1 E3:1 A2:1 E3:1 D3:1 A3:1 D3:1 A3:1 C3:1 G3:1 C3:1 G3:1 G#2:1 E3:1 G#2:1 E3:1 A2:1 E3:1 A2:2', { rep: 3, vel: 90 }),
      drums(48),
    ]),
  },
  {
    key: 'ode', bpm: 110, build: () => smf(110, [
      voice(0, 56, 'E5:1 E5:1 F5:1 G5:1 G5:1 F5:1 E5:1 D5:1 C5:1 C5:1 D5:1 E5:1 E5:1.5 D5:.5 D5:2 E5:1 E5:1 F5:1 G5:1 G5:1 F5:1 E5:1 D5:1 C5:1 C5:1 D5:1 E5:1 D5:1.5 C5:.5 C5:2', { rep: 3 }),
      voice(1, 48, 'C4+E4+G4:4 G3+B3+D4:4 C4+E4+G4:4 G3+B3+D4:4 C4+E4+G4:4 G3+B3+D4:4 C4+E4+G4:2 G3+B3+D4:2 C4+E4+G4:4', { rep: 3, vel: 64 }),
      voice(2, 33, 'C3:2 C3:2 G2:2 G2:2 C3:2 C3:2 G2:2 G2:2 C3:2 C3:2 G2:2 G2:2 C3:2 G2:2 C3:4', { rep: 3, vel: 88 }),
      drums(24),
    ]),
  },
  {
    key: 'elise', bpm: 76, build: () => smf(76, [
      voice(0, 0, 'E5:.25 D#5:.25 E5:.25 D#5:.25 E5:.25 B4:.25 D5:.25 C5:.25 A4:.75 r:.25 C4:.25 E4:.25 A4:.25 B4:.75 r:.25 E4:.25 G#4:.25 B4:.25 C5:.75 r:.25 E4:.25', { rep: 8 }),
      voice(1, 0, 'r:1.5 A2:.25 E3:.25 A3:.25 r:.75 E2:.25 E3:.25 G#3:.25 r:.75 A2:.25 E3:.25 A3:.25 r:.25', { rep: 8, vel: 70 }),
    ]),
  },
  {
    key: 'hall', bpm: 132, build: () => smf(132, [
      voice(0, 71, 'B3:.5 C#4:.5 D4:.5 E4:.5 F#4:.5 D4:.5 F#4:1 F4:.5 C#4:.5 F4:1 E4:.5 C4:.5 E4:1 B3:.5 C#4:.5 D4:.5 E4:.5 F#4:.5 D4:.5 F#4:.5 B4:.5 A4:.5 F#4:.5 D4:.5 F#4:.5 A4:2', { rep: 4 }),
      voice(1, 48, 'B2+F#3:2 B2+F#3:2 A#2+F3:2 A2+E3:2 B2+F#3:2 B2+F#3:2 A2+E3:2 D3+A3:2', { rep: 4, vel: 70 }),
      voice(2, 43, 'B1:1 r:1 B1:1 r:1 A#1:1 r:1 A1:1 r:1 B1:1 r:1 B1:1 r:1 A1:1 r:1 D2:1 r:1', { rep: 4, vel: 92 }),
    ]),
  },
];

export interface DemoLibrary {
  files: MidiFile[];
  songs: Song[];
  tags: AppTag[];
  playlists: Playlist[];
  config: AppConfig;
  /** Two small twins and a big one. */
  coils: TeslaCoil[];
  /** The tuning history, newest first (as the API sends it). */
  tunings: TuningRecord[];
  /** One of its own: the user's library envelopes stay out of sight. */
  envelopes: CustomEnvelope[];
  /** A concert stage posing the three coils. */
  scenes: SceneRecord[];
  /** MIDI bytes by request path (/uploads/tour-demo-<key>.mid) */
  bytes: Map<string, Uint8Array>;
}

export function buildDemoLibrary(lang: string): DemoLibrary {
  const w = WORDS[lang === 'fr' ? 'fr' : 'en'];
  const bytes = new Map<string, Uint8Array>();
  const files: MidiFile[] = TUNES.map((tune, i) => {
    const m = tune.build();
    const path = `${DEMO_PATH_PREFIX}${tune.key}.mid`;
    bytes.set(path, m.bytes);
    return {
      id: DEMO_FILE_ID + i,
      name: { korobeiniki: 'Korobeiniki', ode: w.ode, elise: 'Für Elise', hall: w.hall }[tune.key] ?? tune.key,
      path: `.${path}`,
      durationMs: m.durationMs,
      channels: Object.keys(m.programs).length,
      programs: m.programs,
      editorName: null,
    };
  });
  const file = (key: string): MidiFile => files[TUNES.findIndex((t) => t.key === key)];
  const tags: AppTag[] = [
    { id: 9301, name: w.game, color: '#8db0ff' },
    { id: 9302, name: w.classical, color: '#c084fc' },
    { id: 9303, name: w.demo, color: '#3ddc97' },
    { id: 9304, name: w.folk, color: '#e0a93b' },
  ];
  const coil = (coilIndex: number, channelMask: number, ontimeUs: number, duty: number) => ({ coilIndex, channelMask, ontimeUs, duty });
  // a variant names its coils: Zeus 0, Thor 1 (Zeus's twin), Raijin 2
  const on = (k: number, c: CoilConfig): CoilConfig => ({ ...c, coilUuid: `tour-demo-coil-${k}` });
  const songs: Song[] = [
    {
      id: DEMO_SONG_ID, name: 'Korobeiniki (Tetris)', midiFile: file('korobeiniki'), coilCount: 3, mode: 'midi',
      output2Mask: 1 << 9, coils: [coil(0, 0b001, 45, 0.05), coil(1, 0b010, 35, 0.05), coil(2, 0b100, 60, 0.06)],
      // power changes for the automation and timeline steps, early enough to be on screen:
      // the song's curve (a rise, then a step) and a few per-coil ones on top of it
      // (value = ratio of the setting, held until the next point unless reached by a ramp)
      events: [
        { coilIndex: -1, param: 'power', atMs: 0, value: 0.6 },
        { coilIndex: -1, param: 'power', atMs: 4000, value: 1, ramp: true },
        { coilIndex: -1, param: 'power', atMs: 9000, value: 1.25 },
        { coilIndex: 0, param: 'ontime', atMs: 3000, value: 1.6 },
        { coilIndex: 0, param: 'ontime', atMs: 7000, value: 1 },
        { coilIndex: 1, param: 'ontime', atMs: 5000, value: 0.7 },
        { coilIndex: 2, param: 'ontime', atMs: 8500, value: 1.3 },
        { coilIndex: 1, param: 'duty', atMs: 2000, value: 1.5 },
        { coilIndex: 2, param: 'duty', atMs: 6000, value: 0.6 },
      ],
      // spatialised, so the tour's Espace step has its tab
      stereo: MidStereo.even(3),
      // on fewer coils too: the player takes the one the coils plugged in can play (the big one first, on the bass)
      variants: [
        { id: 'duo', name: '', coilCount: 2, coils: [on(2, coil(0, 0b100, 60, 0.06)), on(0, coil(1, 0b011, 45, 0.05))] },
        { id: 'solo', name: '', coilCount: 1, coils: [on(0, coil(0, 0b111, 45, 0.06))] },
      ],
      tags: [tags[0], tags[3]], editorName: null,
    },
    {
      id: DEMO_SONG_ID + 1, name: w.ode, midiFile: file('ode'), coilCount: 3, mode: 'midi',
      output2Mask: 1 << 9, coils: [coil(0, 0b001, 50, 0.05), coil(1, 0b010, 30, 0.04), coil(2, 0b100, 55, 0.06)],
      variants: [{ id: 'duo', name: '', coilCount: 2, coils: [on(2, coil(0, 0b100, 55, 0.06)), on(0, coil(1, 0b011, 50, 0.05))] }],
      events: [], tags: [tags[1], tags[2]], editorName: null,
    },
    {
      id: DEMO_SONG_ID + 2, name: 'Für Elise', midiFile: file('elise'), coilCount: 2, mode: 'midi',
      output2Mask: 0, coils: [coil(0, 0b01, 40, 0.05), coil(1, 0b10, 35, 0.04)],
      events: [], tags: [tags[1]], editorName: null,
    },
    {
      id: DEMO_SONG_ID + 3, name: w.hall, midiFile: file('hall'), coilCount: 3, mode: 'midi',
      output2Mask: 0, coils: [coil(0, 0b001, 55, 0.06), coil(1, 0b010, 35, 0.05), coil(2, 0b100, 70, 0.07)],
      events: [], tags: [tags[1]], editorName: null,
    },
  ];
  const playlists: Playlist[] = [
    { id: DEMO_PLAYLIST_ID, name: w.playlist, coilCount: 3, songIds: [DEMO_SONG_ID, DEMO_SONG_ID + 1, DEMO_SONG_ID + 3], editorName: null },
  ];
  // the gods of lightning, for the coils
  const config: AppConfig = { coilNames: ['Zeus', 'Thor', 'Raijin'], defaultCoilCount: 3 };
  const coils: TeslaCoil[] = (['petite', 'petite', 'grande'] as const).map((preset, i) => ({
    id: 9601 + i, uuid: `tour-demo-coil-${i}`, name: config.coilNames[i], position: i, spec: { preset },
    twinGroup: preset === 'petite' ? 'demo-petites' : null, notes: null, updatedAt: null, editorName: null,
  }));
  const tunings = [
    tuning(9301, 0, 12, w.garden, DEMO_PLACE, 6.25, 214, { indoor: false, tempC: 18, humidityPct: 62, weatherCode: 1, ground: 'dry', comment: w.raised }),
    tuning(9302, 1, 30, w.workshop, { lat: 45.7702, lon: 4.8561 }, 5.5, 168, { indoor: true, tempC: 21, humidityPct: 45, primaryTurns: 7, tapMin: 3, tapMax: 7 }),
    tuning(9303, 0, 75, w.fair, { lat: 45.8127, lon: 4.9385 }, 5.75, 176, { indoor: false, tempC: 12, humidityPct: 88, weatherCode: 61, ground: 'wet', comment: w.wet }),
    tuning(9304, 2, 110, w.workshop, { lat: 45.7702, lon: 4.8561 }, 7, 191, { indoor: true, tempC: 19, humidityPct: 50, primaryTurns: 10, tapMin: 5, tapMax: 9, tapStep: 0.5 }),
  ];
  const envelopes: CustomEnvelope[] = [
    { id: 9501, program: DEMO_ENVELOPE_PROGRAM, name: w.pad, steps: new SndEnvelope(SndEnvPrograms.steps(2)).normalized(), editorName: null },
  ];
  const posed = (i: number) => `tour-demo-coil-${i}`;
  const scenes: SceneRecord[] = [{
    id: 9701, uuid: DEMO_SCENE_UUID, name: w.scene, position: 0, updatedAt: null, editorName: null,
    data: {
      decor: 'concert',
      coils: [
        { coil: posed(1), x: 3.65, z: 0.8, rot: 150, hang: false, tubes: [{ az: 15, len: 410, tilt: 7 }], ring: null },
        { coil: posed(0), x: 0.05, z: 1.2, rot: 30, hang: false, tubes: [{ az: 0, len: 300, tilt: 15 }], ring: null },
        { coil: posed(2), x: -2.4, z: -1.1, rot: 60, hang: false, tubes: [{ az: 0, len: 500, tilt: 15 }], ring: null },
      ],
      cages: [{ x: 1.7, z: 1.2, rot: 0, w: 1.2, d: 1.2, h: 2.4 }],
      tables: [{ x: 3.95, z: 0.8, rot: 0, w: 1.2, d: 0.8, h: 0.75 }, { x: -0.15, z: 1.25, rot: 0, w: 1.2, d: 0.8, h: 0.75 }],
      counters: [],
      knights: [],
    },
  }];
  return { files, songs, tags, playlists, config, coils, tunings, envelopes, scenes, bytes };
}

function tuning(
  id: number, coilIndex: number, daysAgo: number, location: string, at: { lat: number; lon: number },
  tapTurns: number, bestPx: number, more: Partial<TuningRecord>,
): TuningRecord {
  return {
    id, coilIndex, coilName: null, createdAt: new Date().setHours(17, 30, 0, 0) - daysAgo * 86_400_000, location, lat: at.lat, lon: at.lon,
    indoor: null, tempC: null, humidityPct: null, pressureHpa: null, weatherCode: null, ground: null, comment: null,
    primaryTurns: 8, tapStep: 0.25, tapMin: 4, tapMax: 8, tapTurns, bestPx,
    tone: { notes: [48, 55, 60], holdMs: 10000, gapMs: 3000, ontimeUs: 40, duty: 0.05, program: null, channel: 0, fiberIndex: coilIndex },
    camera: null, trials: null, uuid: null, updatedAt: null, editorName: null,
    ...more,
  };
}
