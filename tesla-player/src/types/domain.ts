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
}

/** A mid-song parameter change scheduled at a point in time (future feature). */
export interface CoilEvent {
  coilIndex: number;
  /** Offset from song start, in milliseconds. */
  atMs: number;
  param: CoilParam;
  /** Ontime in µs when param==='ontime', duty fraction when param==='duty'. */
  value: number;
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
  /** Mid-song parameter-change events (optional; future). */
  events?: CoilEvent[];
}

export interface Playlist {
  id: number;
  name: string;
  /** Tesla-coil count this playlist targets (1..6); only matching songs play. */
  coilCount: number;
  songIds: number[];
}

export const MIN_COILS = 1;
export const MAX_COILS = 6;
export const MIDI_CHANNEL_COUNT = 16;
