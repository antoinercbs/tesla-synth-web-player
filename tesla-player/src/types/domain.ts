/**
 * Domain model (target) for the redesigned Tesla-coil player.
 *
 * The configuration is PER SONG and PER COIL: every song carries its own list
 * of coils (1..6), and each coil has its own channel assignment, ontime and
 * duty. The browser compiles this structured model into Syntherrupter SysEx on
 * demand (see src/sysex/syntherrupter.ts) — nothing is stored pre-compiled.
 *
 * These types are forward-looking: the API still returns the legacy shape until
 * the database migration (jalon 2). They are the north star the new stores and
 * components build against.
 */

import type { EnvStep } from '@/sysex/envelopes';

/**
 * Firmware playback mode stored per song.
 *  - 'midi'   = the Syntherrupter's single MIDI mode (byte 0x02). It backs BOTH
 *               our "normal" playback (the player streams a MIDI file to the
 *               coils) AND our "live" passthrough (a MIDI input is routed live).
 *               "live" is therefore a play-screen interaction, not a song mode.
 *  - 'simple' = the firmware's Simple mode (byte 0x01), our "fixed mode":
 *               constant ontime/duty per coil, no MIDI file.
 */
export type PlaybackMode = 'midi' | 'simple';

/** Per-coil parameter that can be adjusted (live or via mid-song events). */
export type CoilParam = 'ontime' | 'duty';

export interface MidiFile {
  id: number;
  name: string;
  /** Server path, e.g. "/uploads/foo.mid". */
  path: string;
  /** The number of channels, computed server-side. Null/undefined if unknown */
  channels?: number | null;
  /** Starting instrument of each note-bearing channel ({ channel: program }), computed server-side. */
  programs?: Record<number, number> | null;
  /** Total play length in ms, computed server-side. Null/undefined if unknown. */
  durationMs?: number | null;
  /** Who last uploaded/edited this (server-stamped from the OIDC token), or null. */
  editorName?: string | null;
}

/** Global operator configuration (one row server-side). */
export interface AppConfig {
  /** Operator name of each physical coil, indexed by coil number (0..5). */
  coilNames: string[];
  /** Default coil count pre-filled for new songs/playlists (1..6). */
  defaultCoilCount: number;
}

/** Configuration of a single Tesla coil within a song. */
export interface CoilConfig {
  /** 0-based coil index (0..5). */
  coilIndex: number;
  /** 16-bit mask: bit i set => MIDI channel i feeds this coil. */
  channelMask: number;
  /** Ontime in microseconds. */
  ontimeUs: number;
  /**
   * Duty as a fraction (e.g. 0.05 = 5%). Kept as a float in memory to match
   * the production wire format, which encodes duty as IEEE-754.
   */
  duty: number;
  /**
   * Optional Syntherrupter envelope ("instrument") to force on this coil's
   * channels via a MIDI Program Change. Used by Live mode; null/undefined means
   * "don't override" (pass the input's own program through).
   */
  program?: number | null;
}

/**
 * A single coil in "fixed" (firmware Simple) mode: a constant tone defined by
 * ontime, duty and firing frequency — no MIDI channels involved.
 */
export interface SimpleCoil {
  coilIndex: number;
  /** Ontime in microseconds. */
  ontimeUs: number;
  /** Duty as a fraction (0..1). */
  duty: number;
  /** Firing rate in Hz (the firmware's "bps"). */
  frequencyHz: number;
}

/** What an automation point drives: one coil's ontime or duty, or the whole song's power. */
export type AutomationParam = CoilParam | 'power';
/** coilIndex of the song-wide power points: they multiply every coil's own curve. */
export const SONG_WIDE = -1;

/** A point of a song's power automation (see midi/automation.ts). */
export interface CoilEvent {
  /** 0..5, or SONG_WIDE for param 'power'. */
  coilIndex: number;
  /** Offset from song start, in milliseconds. */
  atMs: number;
  param: AutomationParam;
  /** A ratio of the coil's configured value (1 = 100%). */
  value: number;
  /** Reached by a linear ramp from the previous point of its curve; else a step. */
  ramp?: boolean;
}

export interface Song {
  id: number;
  name: string;
  midiFile: MidiFile | null;
  /** Number of physical coils this song is authored for (1..6). */
  coilCount: number;
  mode: PlaybackMode;
  /** 16-bit mask of channels mirrored to the second (speaker) output. */
  output2Mask: number;
  /** Exactly `coilCount` entries, indexed 0..coilCount-1. */
  coils: CoilConfig[];
  /** Power automation points; empty/absent = the configured values throughout. */
  events?: CoilEvent[];
  /** Absent when talking to a server that predates tags. */
  tags?: AppTag[];
  /** Spatialisation across the coils; null/absent = off. */
  stereo?: SongStereo | null;
  /** Who last edited this (server-stamped from the OIDC token), or null. */
  editorName?: string | null;
}

/**
 * Spatialisation ("stereo" on the Syntherrupter): each coil has a place from
 * left (0) to right (1) and a reach; a note plays on the coils it is close to.
 * Channels absent from `channels` are placed by the file's own pan (CC10).
 */
export type StereoBlend = 'fade' | 'single';
export type PanFollow = 'each' | 'lowest' | 'highest' | 'loudest';
export type ChannelPlacement =
  | { source: 'omni' }
  | { source: 'pitch'; follow: PanFollow; noteLow: number; noteHigh: number; lowOn: 'left' | 'right' };
export interface SongStereo {
  /** fade: volume falls with the distance; single: full inside the reach, nothing past it. */
  blend: StereoBlend;
  /** Index = coil index; position and reach in 0..1. */
  coils: { position: number; reach: number }[];
  channels: Record<string, ChannelPlacement>;
}

export interface Playlist {
  id: number;
  name: string;
  /** Tesla-coil count this playlist targets (1..6); only matching songs play. */
  coilCount: number;
  songIds: number[];
  /** Who last edited this (server-stamped from the OIDC token), or null. */
  editorName?: string | null;
}

/**
 * A user-defined Syntherrupter envelope (programs 20-63). Channels pick it by
 * program number, like the built-in ones; the player pushes it to the device
 * before a song that plays it.
 */
export interface CustomEnvelope {
  id: number;
  program: number;
  name: string;
  /** Exactly 8 steps: 0 = attack, 7 = release. */
  steps: EnvStep[];
  editorName?: string | null;
}

/** A song label. `id` is absent until the tag has been saved server-side. */
export interface AppTag {
  id?: number;
  name: string;
  color: string;
}

export const MIN_COILS = 1;
export const MAX_COILS = 6;
export const MIDI_CHANNEL_COUNT = 16;
