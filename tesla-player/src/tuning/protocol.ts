/**
 * Messages exchanged between the player (desktop) and the phone (camera) of a
 * tuning session, relayed by the backend (`/api/tuning/sessions`). The relay is
 * transport-agnostic (WebSocket, the desktop app's in-process channel, SSE or
 * polling) and never interprets payloads; both ends share these types so the
 * contract lives in one place.
 */
import type { ArcGeometry } from '@/vision/arc-meter';
import type { HeatPayload } from './heat';

export type Side = 'desktop' | 'camera';

/** One relayed message as delivered by the hub. */
export interface SessionEvent<T = unknown> {
  seq: number;
  at: number;
  from: Side;
  type: string;
  payload?: T;
}

export interface SessionInfo {
  id: string;
  createdAt: number;
  expiresAt: number;
  seq: number;
  cameraOnline: boolean;
  desktopOnline: boolean;
}

/* ---------------------------------------------------------------- desktop → camera */

/** Sent by the desktop when the tap is about to be tested: capture a fresh background. */
export interface CaptureBackgroundCmd {
  trialId: string;
  /** Frames to accumulate (coil OFF). */
  frames: number;
}

/** A note of the test tone starts: measure until `tone:end` for the same key. */
export interface ToneStartCmd {
  trialId: string;
  noteIndex: number;
  /** MIDI note number, for the record. */
  note: number;
  holdMs: number;
}

export interface ToneEndCmd {
  trialId: string;
  noteIndex: number;
}

/** Emergency / normal stop: the camera drops any running measurement. */
export type StopCmd = { reason: 'user' | 'timeout' | 'error' };

/** A trial is about to start: what the phone should display while it runs. */
export interface TrialBegin {
  trialId: string;
  /** 1-based number of this trial in the session. */
  index: number;
  tapTurns: number;
  tapLabel: string;
  notes: number[];
  holdMs: number;
  gapMs: number;
  /** Best trial so far, for comparison (null on the first). */
  bestScore: number | null;
  bestTapLabel: string | null;
}

/** The trial is over and scored (also sent when it was aborted: score null). */
export interface TrialDone {
  trialId: string;
  score: number | null;
  notes: { note: number; p90: number; hitRate: number }[];
  bestScore: number | null;
  bestTapLabel: string | null;
  /** True when this trial is the new best. */
  isBest: boolean;
}

/* ---------------------------------------------------------------- camera → desktop */

/** Camera page joined and its capabilities. */
export interface CameraHello {
  userAgent: string;
  /** Work frame size the meter runs at. */
  width: number;
  height: number;
  /** Whether manual exposure could be locked. */
  exposureLocked: boolean;
}

/** Geometry chosen on the phone (work px), for the record + desktop preview. */
export type CameraGeometry = ArcGeometry;

export interface CameraPosition {
  lat: number;
  lon: number;
  accuracyM: number | null;
}

/** Background captured: scene quality. */
export interface BackgroundReady {
  trialId: string;
  frames: number;
  /** Median per-pixel noise σ (0..255 scale) over the decor. */
  sigmaMedian: number;
}

/** Live aggregate published a few times per second while measuring (or idle). */
export interface LiveMeasure {
  /** Current per-frame length (work px), 0 when no arc. */
  L: number;
  /** Rolling P90 over the last second. */
  p90: number;
  /** Alignment confidence of the last frame. */
  conf: number;
  /** Alignment shift of the last frame (drift indicator). */
  dx: number;
  dy: number;
  /** Frames processed per second. */
  fps: number;
  /** True while a tone window is open. */
  measuring: boolean;
}

/** Result of one note of one trial. */
export interface NoteResult {
  trialId: string;
  noteIndex: number;
  note: number;
  frames: number;
  hitRate: number;
  p90: number;
  median: number;
  max: number;
  /** Fraction of frames flagged unstable (camera moved). */
  unstableRate: number;
  /** Accumulated arc silhouette over the note. */
  heat?: HeatPayload | null;
}

/** Live silhouette while a note is measured (cumulative since tone:start). */
export interface HeatUpdate {
  trialId: string;
  noteIndex: number;
  heat: HeatPayload;
}

/** Camera-side error / status, shown on the desktop. */
export interface CameraStatus {
  state: 'idle' | 'setup' | 'ready' | 'capturing' | 'measuring' | 'error';
  message?: string;
}

/* ---------------------------------------------------------------- type map */

export interface EventMap {
  // desktop → camera
  'capture:background': CaptureBackgroundCmd;
  'tone:start': ToneStartCmd;
  'tone:end': ToneEndCmd;
  'stop': StopCmd;
  'trial:begin': TrialBegin;
  'trial:done': TrialDone;
  'desktop:hello': { at: number };
  // camera → desktop
  'camera:hello': CameraHello;
  'camera:geometry': CameraGeometry;
  'camera:position': CameraPosition;
  'camera:status': CameraStatus;
  'background:ready': BackgroundReady;
  'measure:live': LiveMeasure;
  'measure:heat': HeatUpdate;
  'measure:note': NoteResult;
  /** The phone's big red button. The desktop executes the stop. */
  'camera:stop': StopCmd;
}

export type EventType = keyof EventMap;

/** Typed helper to narrow a received event. */
export function isEvent<K extends EventType>(ev: SessionEvent, type: K): ev is SessionEvent<EventMap[K]> {
  return ev.type === type;
}

/* ------------------------------------------------------------ live channel frames */

/** Client → hub, over the WebSocket / in-process channel. */
export type HubClientMessage =
  | { kind?: 'publish'; id?: string | number; type: string; payload?: unknown }
  | { kind: 'ping' };

/** Hub → client. `ack` answers a `publish` with the sequence number it got. */
export type HubServerMessage =
  | { kind: 'hello'; info: SessionInfo }
  | { kind: 'event'; event: SessionEvent }
  | { kind: 'info'; info: SessionInfo }
  | { kind: 'ack'; id?: string | number; seq: number }
  | { kind: 'error'; id?: string | number; message: string; status?: number }
  | { kind: 'pong' }
  | { kind: 'closed' };
