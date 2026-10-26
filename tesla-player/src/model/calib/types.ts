import type { SimLimits } from '@/model/devices/coil-limits';
import type { CoilSpec } from '@/model/coils/spec';
import type { ChannelProfile, ChannelRole } from '@/model/calib/roles';

export const BIN_MS = 50;
export type Limits = SimLimits;
/** Where the board's own protection trips (DeviceProfile.hardwareLimits). */
export interface HwLimits { ontimeUs: number; duty: number }

/** A note as the searches take it. `endMs` includes its envelope's release. */
export interface CalibNote { ch: number; hz: number; lvl: number; startMs: number; endMs: number; durMs: number }

/** A song's notes and its coils' limits and sheets: what judging or carrying a setting needs. */
export type CalibSongData = Pick<CalibRequest, 'durationMs' | 'notes' | 'limits' | 'specs'>;

export interface CalibRequest {
  durationMs: number;
  notes: CalibNote[];
  profiles: ChannelProfile[];
  coilCount: number;
  /** By coil index. */
  limits: Limits[];
  /** Each coil's sheet, by coil index (null: none, the synth's level law then). */
  specs?: (CoilSpec | null)[];
  hw: HwLimits | null;
  /** The routing to keep (one mask per coil); absent: the Assistant routes. */
  masks?: number[];
  /**
   * A role per coil, by coil index (null: the Assistant's choice): such a coil
   * plays the channels of that role, and other lines only when they would
   * otherwise go unheard. A role no channel has leaves the coil to the Assistant.
   */
  coilRoles?: (ChannelRole | null)[];
}

/** One spot of a coil's pad: the setting it gives, and what that does to the coil's notes. */
export interface PadCell {
  /** Ontime (µs) and duty (fraction) to store. */
  o: number;
  d: number;
  /** Duration-weighted mean level of its notes (dB, see coilLevel) and their spread. */
  level: number;
  spread: number;
  /** Share of its notes' time asking past the max ontime: stuck there, velocity lost. */
  capped: number;
  /** Share of its sounding time asking past the max duty: the board shrinks the notes. */
  busy: number;
  /** Share of its notes' time whose bangs end on the OCD or strike the ground mat (0 without a sheet). */
  ocd: number;
}

/** What a setting does to a coil's notes: a pad's spot without the setting. */
export type PadMeasures = Omit<PadCell, 'o' | 'd'>;

/** A setting over its coils, as the comparison shows it: the share of note time stuck at the max ontime, of sounding time shrunk by the max duty, loudness (dB). */
export interface AssistSummary { capped: number; reduced: number; level: number }

export interface IntentionPlan {
  masks: number[];
  /** By coil: rows (y axis, bottom to top) of cells (x axis); null for a coil with no channel. */
  pads: (PadCell[][] | null)[];
  /** By coil: the spot the Assistant would pick. */
  pick: { y: number; x: number }[];
}

export interface CalibResult { clean: IntentionPlan; loud: IntentionPlan }

/** Clean pad: power (y) × crossover (x: 0 above the notes, the bass on the duty; 1 below them, all on the ontime). */
export const CLEAN_POWER = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
export const CLEAN_TILT = [0, 0.25, 0.5, 0.75, 1];
/** Loud pad: arc length, a share of the max ontime (y) × load, a share of the max duty (x). */
export const LOUD_SHARE = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
export const LOUD_LOAD = [0.4, 0.55, 0.7, 0.85, 1];
