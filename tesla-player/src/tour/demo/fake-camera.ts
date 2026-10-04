import { reactive } from 'vue';
import type { CameraGeometry, SessionEvent, SessionInfo, TrialDone } from '@/tuning/protocol';
import { encodeBytes, type HeatPayload } from '@/tuning/heat';
import { DEMO_PLACE } from './data';

/**
 * The tuning tour's phone. It answers the tuning relay's REST calls (session,
 * polling, events, heartbeat) as if a phone had joined, and plays the camera's
 * side of a trial: background, live figures, silhouette, per-note result. Its
 * arcs are longest at PEAK turns, next to the demo history's last tuning here.
 * demo-mode.ts routes the requests here and puts the relay on polling: the
 * WebSocket and the desktop app's IPC channel would bypass axios.
 *
 * `phoneView` is what its screen shows, for the tour's phone
 * (components/tour/FakePhone.vue): the same states as TuneCameraView. The
 * phone's own steps (start the camera, place the pin, set the wall and the
 * floor, validate) are its controls there, pressed by the tour's pointer.
 */
const SESSION_ID = 'tour-demo';
const HOUR = 3_600_000;
const PEAK = 6.25;
// a phone held upright (the camera page's portrait work frame); the coil's pin
// throws its arcs to the right, and they dive for the ground
const FRAME = { width: 288, height: 512 };
export const PIN = { x: 174, y: 170 };
/** Where the ground starts in the picture. */
export const GROUND_Y = 350;

let createdAt = 0;
let online = false;
let seq = 0;
let events: SessionEvent[] = [];
let timers: ReturnType<typeof setTimeout>[] = [];
let ticker: ReturnType<typeof setInterval> | null = null;
let tapTurns = PEAK;
// sends the running note's result, once its tone:end arrives
let onNoteEnd: (() => void) | null = null;

type NoteState = 'pending' | 'measuring' | 'done' | 'skipped';
export type ZoneKey = 'wallBack' | 'floorBelow';
export interface PhoneView {
  step: 'off' | 'intro' | 'setup' | 'ready';
  breakoutSet: boolean;
  /** The zone as set on the phone, in work px: the wall behind the pin, the floor under it. */
  zone: Record<ZoneKey, number>;
  trial: {
    index: number;
    tapLabel: string;
    phase: 'background' | 'notes' | 'done';
    notes: { note: number; state: NoteState; p90: number | null }[];
    /** 0..1 of the note being measured */
    progress: number;
    result: TrialDone | null;
  } | null;
  live: { L: number; measuring: boolean };
  /** Arc length (work px) the coil throws right now; 0 = quiet. */
  arc: number;
}
// the camera page's zone once the pin is placed (wall right behind it, floor near
// the frame's bottom), and the one the demo measures with: the floor up to the ground
const START_ZONE: Record<ZoneKey, number> = { wallBack: 14, floorBelow: Math.round(FRAME.height * 0.8) - PIN.y };
export const DEMO_ZONE: Record<ZoneKey, number> = { wallBack: 14, floorBelow: GROUND_Y - PIN.y };
export const GEOMETRY: CameraGeometry = {
  ...FRAME, breakout: PIN, wall: { x: PIN.x - DEMO_ZONE.wallBack, side: 1 }, excludeBelowY: PIN.y + DEMO_ZONE.floorBelow,
};
const WALL_X = GEOMETRY.wall!.x;
const FLOOR_Y = GEOMETRY.excludeBelowY!;
// the heat grid covers the meter's crop: the zone, plus its band behind the wall and below the floor
const CELL = 6;
const X0 = WALL_X - 40;
const Y0 = 0;
const W = Math.ceil((FRAME.width - X0) / CELL);
const H = Math.ceil((FLOOR_Y + 40) / CELL);
/** Drawn arcs against the measured length: the figures stay those of the demo history. */
export const DRAW_SCALE = 0.7;
const offView = (): PhoneView => ({ step: 'off', breakoutSet: false, zone: { ...START_ZONE }, trial: null, live: { L: 0, measuring: false }, arc: 0 });
export const phoneView = reactive<PhoneView>(offView());

function push(type: string, payload: unknown): void {
  events.push({ seq: ++seq, at: Date.now(), from: 'camera', type, payload });
}

function later(ms: number, fn: () => void): void {
  timers.push(setTimeout(fn, ms));
}

function info(): SessionInfo {
  return { id: SESSION_ID, createdAt, expiresAt: createdAt + HOUR, seq, cameraOnline: online, desktopOnline: true };
}

function stopTicker(): void {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

function idle(): void {
  stopTicker();
  phoneView.live = { L: 0, measuring: false };
  phoneView.arc = 0;
  push('camera:status', { state: 'ready' });
  push('measure:live', { L: 0, p90: 0, conf: 0.97, dx: 0, dy: 0, fps: 30, measuring: false });
}

/** Seeded, so a tap position always draws the same arcs. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Arc length (P90, work px) at a tap position; low notes throw slightly longer arcs. */
function arcLength(tap: number, note: number, noteIndex: number): number {
  const bell = Math.exp(-(((tap - PEAK) / 1.6) ** 2));
  const jitter = 0.97 + 0.06 * rng(Math.round(tap * 8) * 31 + noteIndex)();
  return (60 + 170 * bell) * (1 + (60 - note) * 0.006) * jitter;
}

/** The first `strokes` arcs of the sequence for `seed`, as a heat grid. */
function arcHeat(length: number, seed: number, strokes: number): HeatPayload {
  const rand = rng(seed);
  const acc = new Float32Array(W * H);
  const walk = (x: number, y: number, dir: number, len: number, depth: number): void => {
    for (let d = 0; d < len; d += 3) {
      dir += (rand() - 0.38) * 0.6; // the arcs bend down, towards the ground
      x += Math.cos(dir) * 3;
      y += Math.sin(dir) * 3;
      if (y >= FLOOR_Y || x < WALL_X || x >= FRAME.width || y < 0) return;
      const cx = Math.floor((x - X0) / CELL);
      const cy = Math.floor((y - Y0) / CELL);
      if (cx >= 0 && cx < W && cy >= 0 && cy < H) acc[cy * W + cx] += 1;
      if (depth < 2 && rand() < 0.025) walk(x, y, dir + (rand() - 0.5) * 1.6, (len - d) * 0.5, depth + 1);
    }
  };
  for (let s = 0; s < strokes; s++) {
    walk(PIN.x, PIN.y, 0.15 + (rand() - 0.5) * 0.9, DRAW_SCALE * length * (0.5 + 0.7 * rand()), 0);
  }
  let max = 0;
  for (const v of acc) max = Math.max(max, v);
  // square root: every arc stays visible next to the breakout's hot spot
  const bytes = new Uint8Array(acc.length);
  if (max > 0) for (let k = 0; k < acc.length; k++) bytes[k] = Math.round(255 * Math.sqrt(acc[k] / max));
  return { w: W, h: H, cell: CELL, x0: X0, y0: Y0, breakout: PIN, wall: GEOMETRY.wall, excludeBelowY: FLOOR_Y, frames: strokes, max, data: encodeBytes(bytes) };
}

function onDesktopEvent(type: string, p: Record<string, unknown>): void {
  switch (type) {
    case 'trial:begin':
      tapTurns = Number(p.tapTurns) || PEAK;
      phoneView.trial = {
        index: Number(p.index) || 1, tapLabel: String(p.tapLabel ?? tapTurns), phase: 'background',
        notes: (Array.isArray(p.notes) ? p.notes : []).map((note: number) => ({ note, state: 'pending', p90: null })),
        progress: 0, result: null,
      };
      break;
    case 'capture:background':
      push('camera:status', { state: 'capturing' });
      later(700, () => {
        push('background:ready', { trialId: p.trialId, frames: 24, sigmaMedian: 1.7 + 0.4 * Math.random() });
        push('camera:status', { state: 'ready' });
      });
      break;
    case 'tone:start': {
      const trialId = p.trialId;
      const noteIndex = Number(p.noteIndex) || 0;
      const p90 = arcLength(tapTurns, Number(p.note) || 60, noteIndex);
      const seed = Math.round(tapTurns * 8) * 131 + noteIndex;
      const holdMs = Number(p.holdMs) || 2000;
      const shown = phoneView.trial?.notes[noteIndex];
      let ticks = 0;
      stopTicker();
      push('camera:status', { state: 'measuring' });
      if (phoneView.trial && shown) {
        phoneView.trial.phase = 'notes';
        phoneView.trial.progress = 0;
        shown.state = 'measuring';
      }
      phoneView.arc = p90;
      ticker = setInterval(() => {
        ticks++;
        const L = Math.random() < 0.12 ? 0 : p90 * (0.45 + 0.6 * Math.random());
        phoneView.live = { L, measuring: true };
        if (phoneView.trial) phoneView.trial.progress = Math.min(1, (ticks * 250) / holdMs);
        push('measure:live', { L, p90: p90 * Math.min(1, 0.7 + ticks * 0.08), conf: 0.92 + 0.06 * Math.random(), dx: 0, dy: Math.random() < 0.2 ? 1 : 0, fps: 30, measuring: true });
        if (ticks % 2 === 0) push('measure:heat', { trialId, noteIndex, heat: arcHeat(p90, seed, Math.min(40, ticks * 3)) });
      }, 250);
      onNoteEnd = () => {
        if (shown) Object.assign(shown, { state: 'done', p90 });
        push('measure:note', {
          trialId, noteIndex, note: Number(p.note) || 60, frames: Math.max(1, ticks) * 7, hitRate: 0.88 + 0.1 * Math.random(),
          p90, median: p90 * 0.72, max: p90 * 1.18, unstableRate: 0.01, heat: arcHeat(p90, seed, 40),
        });
      };
      break;
    }
    case 'tone:end':
      onNoteEnd?.();
      onNoteEnd = null;
      idle();
      break;
    case 'stop':
      onNoteEnd = null;
      idle();
      break;
    case 'trial:done':
      if (phoneView.trial) {
        phoneView.trial.phase = 'done';
        phoneView.trial.result = p as unknown as TrialDone;
        for (const n of phoneView.trial.notes) if (n.state !== 'done') n.state = 'skipped';
      }
      break;
  }
}

/** The phone opens the QR code's page (a tour step's cue). */
export function joinFakePhone(): void {
  if (!createdAt || online) return;
  later(300, () => {
    online = true;
    phoneView.step = 'intro';
    push('camera:status', { state: 'idle' });
  });
}

export function phoneStartCamera(): void {
  if (phoneView.step !== 'intro') return;
  phoneView.step = 'setup';
  push('camera:hello', { userAgent: 'Tour demo', width: GEOMETRY.width, height: GEOMETRY.height, exposureLocked: true });
  push('camera:status', { state: 'setup' });
}

/** The finger lands on the pin's tip and swipes towards the arcs: the pin, its side, the wall and the floor appear. */
export function phoneTapBreakout(): void {
  if (phoneView.step === 'setup') phoneView.breakoutSet = true;
}

/** A finger slides one of the zone's settings to the demo's value. */
export function phoneAdjustZone(key: ZoneKey): void {
  if (phoneView.step !== 'setup' || !phoneView.breakoutSet) return;
  const from = phoneView.zone[key];
  const to = DEMO_ZONE[key];
  const t0 = performance.now();
  const step = (): void => {
    const k = Math.min(1, (performance.now() - t0) / 700);
    phoneView.zone[key] = from + (to - from) * (1 - (1 - k) ** 3);
    if (k < 1) later(16, step);
  };
  step();
}

export function phoneValidateZone(): void {
  if (phoneView.step !== 'setup' || !phoneView.breakoutSet) return;
  // wherever the wall and the floor were left, the demo measures in its own zone
  Object.assign(phoneView.zone, DEMO_ZONE);
  phoneView.step = 'ready';
  push('camera:position', { lat: DEMO_PLACE.lat, lon: DEMO_PLACE.lon, accuracyM: 8 });
  push('camera:geometry', GEOMETRY);
  idle();
}

export function resetFakeCamera(): void {
  for (const t of timers) clearTimeout(t);
  timers = [];
  stopTicker();
  onNoteEnd = null;
  createdAt = 0;
  online = false;
  events = [];
  tapTurns = PEAK;
  Object.assign(phoneView, offView());
}

/**
 * The relay's answer to a request on /api/tuning/sessions…, or undefined when
 * it is not one the desktop side makes (the demo then refuses it).
 */
export function fakeTuningRequest(method: string, url: URL, body: unknown): unknown {
  const rest = url.pathname.replace(/^\/api\/tuning\/sessions/, '');
  if (rest === '' && method === 'post') {
    resetFakeCamera();
    createdAt = Date.now();
    return { id: SESSION_ID, token: 'demo', createdAt, expiresAt: createdAt + HOUR };
  }
  const m = /^\/([^/]+)(\/[a-z]+)?$/.exec(rest);
  if (!m || m[1] !== SESSION_ID || !createdAt) return undefined;
  switch (`${method} ${m[2] ?? ''}`) {
    case 'get /poll': {
      const after = Number(url.searchParams.get('after')) || 0;
      return { events: events.filter((e) => e.seq > after), info: info() };
    }
    case 'post /events': {
      const ev = (body ?? {}) as { type?: string; payload?: Record<string, unknown> };
      if (ev.type) onDesktopEvent(ev.type, ev.payload ?? {});
      return { seq: ++seq };
    }
    case 'post /heartbeat':
    case 'get ':
      return info();
    case 'delete ':
      resetFakeCamera();
      return {};
    default:
      return undefined;
  }
}
