/**
 * The board commands of the ESP32 port of the Syntherrupter (0x1F00-0x1F04,
 * docs/APP_INTEGRATION.md of its repository): status, protection trips,
 * clearing the protection latch, and the status events it sends on its own.
 */
import { buildCommand } from '@/sysex/syntherrupter';

export const BOARD_PN = {
  STATUS: 0x1f00,
  TRIPS: 0x1f01,
  CLEAR_LATCH: 0x1f02,
  DOWNLOAD_MODE: 0x1f03,
  EVENTS: 0x1f04,
} as const;

/** "CLR!": any other value is ignored, so that no stray frame re-arms a coil. */
export const CLEAR_LATCH_MAGIC = 0x434c5221;
/** "BOOT": the board switches its outputs off and reboots into the ROM download mode. */
export const DOWNLOAD_MODE_MAGIC = 0x424f4f54;

/** Bit of 0x1F04: the board sends its status (a 0x1F00 frame) each time it changes. */
export const EVENT_STATUS = 1;

export interface BoardStatus {
  /** A protection fault is latched: outputs cut, modes forced off. */
  latched: boolean;
  /** The firmware drives the fiber transmitters' supply on. */
  armed: boolean;
  /** The board can tell whether that supply is really on. */
  supplySensed: boolean;
  supplyOn: boolean;
  /** USB enumerated by a host. */
  usbHost: boolean;
  /** An output could not be set up and is disabled. */
  outputError: boolean;
  /** The board has protection inputs; without them, the latch never trips. */
  monitored: boolean;
  /** Coils whose protection tripped since the latch was set. */
  latchCoils: number[];
  /** Coils whose protection is cutting right now. */
  blockingCoils: number[];
}

const coilsOf = (nibble: number): number[] => [0, 1, 2, 3].filter((c) => nibble & (1 << c));

export function decodeBoardStatus(value: number): BoardStatus {
  return {
    latched: (value & 0x01) !== 0,
    armed: (value & 0x02) !== 0,
    supplyOn: (value & 0x04) !== 0,
    supplySensed: (value & 0x08) !== 0,
    usbHost: (value & 0x10) !== 0,
    outputError: (value & 0x20) !== 0,
    monitored: (value & 0x40) !== 0,
    latchCoils: coilsOf((value >>> 8) & 0xf),
    blockingCoils: coilsOf((value >>> 16) & 0xf),
  };
}

/**
 * The one thing to tell, the most serious first. `stop`: the board's STOP
 * switch cuts the fibers' supply (a switch on the signal, not the emergency
 * stop, which acts on the coils' power).
 */
export type BoardState = 'latched' | 'outputError' | 'stop' | 'disarmed' | 'unmonitored' | 'ok';

export function boardState(s: BoardStatus): BoardState {
  if (s.latched) return 'latched';
  if (s.outputError) return 'outputError';
  if (s.armed && s.supplySensed && !s.supplyOn) return 'stop';
  if (!s.armed) return 'disarmed';
  if (!s.monitored) return 'unmonitored';
  return 'ok';
}

export const statusEvents = (on: boolean): number[] =>
  buildCommand({ pn: BOARD_PN.EVENTS, value: on ? EVENT_STATUS : 0 });

export const clearLatchFrame = (): number[] =>
  buildCommand({ pn: BOARD_PN.CLEAR_LATCH, value: CLEAR_LATCH_MAGIC });

export const downloadModeFrame = (): number[] =>
  buildCommand({ pn: BOARD_PN.DOWNLOAD_MODE, value: DOWNLOAD_MODE_MAGIC });
