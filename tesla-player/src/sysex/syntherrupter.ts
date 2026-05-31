/**
 * Syntherrupter SysEx encoder — runs in the browser, replacing the Syfoh CLI.
 *
 * Only the four commands the app actually uses are implemented:
 *   - enable a playback mode        (PN 0x20)
 *   - map MIDI channels to a coil   (PN 0x60)
 *   - set a coil's ontime (µs)      (PN 0x21, integer)
 *   - set a coil's duty (fraction)  (PN 0x22, IEEE-754 float)
 *
 * Frame layout (16 bytes), verified byte-for-byte against the production
 * database (see syntherrupter.spec.ts):
 *
 *   F0 00 26 05 01 7F | PN FF | TG_LSB TG_MSB | v0 v1 v2 v3 v4 | F7
 *    └── fixed header ┘  │  │     │      │       └ 32-bit value, 7 bits/byte, LSB first
 *                        │  │     │      └ playback mode (0x02 MIDI-Live, 0x01 Simple)
 *                        │  │     └ coil index (0..5)
 *                        │  └ float flag: 0x20 when the value is a float, else 0x00
 *                        └ parameter number (low byte)
 *
 * The duty command keeps the production float encoding on purpose (the firmware
 * has only ever been driven with float duty here), so this encoder reproduces
 * existing songs exactly.
 */

import type { CoilConfig, PlaybackMode, SimpleCoil } from '@/types/domain';

/** Fixed SysEx header: start, manufacturer id, protocol version, broadcast id. */
export const SYSEX_HEADER = [0xf0, 0x00, 0x26, 0x05, 0x01, 0x7f] as const;
export const SYSEX_END = 0xf7;

/** Parameter numbers (low byte). */
export const PN = {
  ENABLE: 0x20,
  ONTIME: 0x21,
  DUTY: 0x22,
  /** Firing rate ("beats per second" / frequency in Hz). */
  BPS: 0x23,
  CHANNEL_MAP: 0x60,
} as const;

/** Firmware-mode byte carried in TG_MSB (0x02 MIDI mode, 0x01 Simple mode). */
export const MODE_BYTE: Record<PlaybackMode, number> = {
  midi: 0x02,
  simple: 0x01,
};

/** Value placed in the float-flag byte when the value is IEEE-754 encoded. */
export const FLOAT_FLAG = 0x20;

// ---------------------------------------------------------------------------
// Low-level packing (the only non-trivial part; ported from the verified
// implementation in the former live-sysex-helper.js).
// ---------------------------------------------------------------------------

/** Split a 32-bit value into 5 bytes of 7 bits each, least-significant first. */
export function pack7(value: number): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < 5; i++) {
    bytes.push((value >> (i * 7)) & 0x7f);
  }
  return bytes;
}

/** Reassemble a 32-bit value from 7-bit groups (LSB first). Inverse of pack7. */
export function unpack7(bytes: number[]): number {
  return bytes.reduce((acc, byte, i) => acc + ((byte & 0x7f) << (i * 7)), 0);
}

/** IEEE-754 float -> its 32-bit pattern as a signed int (big-endian, as prod). */
export function floatToBits(value: number): number {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value);
  return view.getInt32(0);
}

/** 32-bit pattern -> the float it represents. Inverse of floatToBits. */
export function bitsToFloat(bits: number): number {
  const view = new DataView(new ArrayBuffer(4));
  view.setInt32(0, bits);
  return view.getFloat32(0);
}

// ---------------------------------------------------------------------------
// Frame building
// ---------------------------------------------------------------------------

export interface FrameSpec {
  /** Parameter number (low byte), e.g. PN.ONTIME. */
  pn: number;
  /** Coil index (TG_LSB), 0..5. */
  coil: number;
  /** Playback-mode byte (TG_MSB). */
  mode: number;
  /** Raw value; interpreted as a float when `isFloat` is true. */
  value: number;
  isFloat?: boolean;
}

/** Build a 16-byte SysEx frame as an array of byte values (0..255). */
export function buildFrame({ pn, coil, mode, value, isFloat = false }: FrameSpec): number[] {
  // hardware safety: a non-finite value (NaN from an empty input) must never
  // reach a coil as garbage bits — coerce to 0 (silent) at the boundary.
  const safe = Number.isFinite(value) ? value : 0;
  const bits = isFloat ? floatToBits(safe) : Math.trunc(safe);
  return [
    ...SYSEX_HEADER,
    pn,
    isFloat ? FLOAT_FLAG : 0x00,
    coil & 0x7f,
    mode,
    ...pack7(bits),
    SYSEX_END,
  ];
}

// ---------------------------------------------------------------------------
// High-level command encoders (default to MIDI-Live, the production mode)
// ---------------------------------------------------------------------------

export function encodeEnable(mode: number = MODE_BYTE.midi, enabled = true): number[] {
  return buildFrame({ pn: PN.ENABLE, coil: 0, mode, value: enabled ? 1 : 0 });
}

export function encodeChannelMap(
  coil: number,
  channelMask: number,
  mode: number = MODE_BYTE.midi,
): number[] {
  return buildFrame({ pn: PN.CHANNEL_MAP, coil, mode, value: channelMask & 0xffff });
}

export function encodeOntime(
  coil: number,
  ontimeUs: number,
  mode: number = MODE_BYTE.midi,
): number[] {
  return buildFrame({ pn: PN.ONTIME, coil, mode, value: Math.round(ontimeUs) });
}

export function encodeDuty(
  coil: number,
  duty: number,
  mode: number = MODE_BYTE.midi,
): number[] {
  return buildFrame({ pn: PN.DUTY, coil, mode, value: duty, isFloat: true });
}

/** Firing frequency in Hz (integer, like Syfoh sends for whole-number values). */
export function encodeBps(
  coil: number,
  frequencyHz: number,
  mode: number = MODE_BYTE.simple,
): number[] {
  return buildFrame({ pn: PN.BPS, coil, mode, value: Math.round(frequencyHz) });
}

// ---------------------------------------------------------------------------
// Hex (string) <-> bytes — the legacy storage/transport format
// ---------------------------------------------------------------------------

export function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

export function hexToBytes(hex: string): number[] {
  return hex.trim().split(/\s+/).map((s) => parseInt(s, 16));
}

// ---------------------------------------------------------------------------
// Decoding (used by the live-adjust feature and the jalon-2 DB migration)
// ---------------------------------------------------------------------------

export interface DecodedFrame {
  pn: number;
  isFloat: boolean;
  coil: number;
  mode: number;
  /** Value read as an integer (7-bit reassembly). */
  valueInt: number;
  /** Same bits reinterpreted as an IEEE-754 float. */
  valueFloat: number;
}

export function decodeFrame(frame: number[] | string): DecodedFrame {
  const bytes = typeof frame === 'string' ? hexToBytes(frame) : frame;
  const valueInt = unpack7(bytes.slice(10, 15));
  return {
    pn: bytes[6],
    isFloat: bytes[7] === FLOAT_FLAG,
    coil: bytes[8],
    mode: bytes[9],
    valueInt,
    valueFloat: bitsToFloat(valueInt),
  };
}

// ---------------------------------------------------------------------------
// Whole-song compilation
// ---------------------------------------------------------------------------

/**
 * Compile a song's per-coil configuration into the ordered list of SysEx frames
 * to send at playback start. Mirrors the production command set: an enable
 * frame (for MIDI-Live) followed by ontime / duty / channel-map per coil.
 */
export function compileCoilConfig(
  coils: CoilConfig[],
  mode: PlaybackMode = 'midi',
): number[][] {
  const modeByte = MODE_BYTE[mode];
  const frames: number[][] = [];

  if (mode === 'midi') {
    frames.push(encodeEnable(modeByte));
  }
  for (const coil of coils) {
    frames.push(encodeOntime(coil.coilIndex, coil.ontimeUs, modeByte));
    frames.push(encodeDuty(coil.coilIndex, coil.duty, modeByte));
    frames.push(encodeChannelMap(coil.coilIndex, coil.channelMask, modeByte));
  }
  return frames;
}

/**
 * Compile the "fixed" (Simple) mode: a constant tone per coil (ontime + duty +
 * frequency), no MIDI channels. Coils are configured FIRST, then Simple mode is
 * enabled last so it never fires with stale/default parameters.
 */
export function compileSimpleConfig(coils: SimpleCoil[]): number[][] {
  const m = MODE_BYTE.simple;
  const frames: number[][] = [];
  for (const coil of coils) {
    frames.push(encodeOntime(coil.coilIndex, coil.ontimeUs, m));
    frames.push(encodeDuty(coil.coilIndex, coil.duty, m));
    frames.push(encodeBps(coil.coilIndex, coil.frequencyHz, m));
  }
  frames.push(encodeEnable(m, true));
  return frames;
}

/**
 * Stop the fixed output. Defense-in-depth: zero each coil's ontime AND duty
 * first (so a coil can't stay armed if the disable frame is lost), then disable
 * Simple mode globally. Pass the coils to zero; with no args it just disables.
 */
export function compileSimpleStop(coils: SimpleCoil[] = []): number[][] {
  const m = MODE_BYTE.simple;
  const frames: number[][] = [];
  for (const coil of coils) {
    frames.push(encodeOntime(coil.coilIndex, 0, m));
    frames.push(encodeDuty(coil.coilIndex, 0, m));
  }
  frames.push(encodeEnable(m, false));
  return frames;
}

// ---------------------------------------------------------------------------
// Channel-mask helpers (UI uses per-channel toggles)
// ---------------------------------------------------------------------------

import { MIDI_CHANNEL_COUNT } from '@/types/domain';

/** 16-bit mask -> boolean[16], index i = channel i enabled. */
export function maskToChannels(mask: number): boolean[] {
  return Array.from({ length: MIDI_CHANNEL_COUNT }, (_, i) => (mask & (1 << i)) !== 0);
}

/** boolean[16] -> 16-bit mask. Inverse of maskToChannels. */
export function channelsToMask(channels: boolean[]): number {
  return channels.reduce((mask, on, i) => (on ? mask | (1 << i) : mask), 0);
}
