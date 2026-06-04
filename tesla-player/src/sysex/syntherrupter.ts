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

/** Value placed in the float-flag byte when the value is IEEE-754 encoded.
 *  In the real protocol this is the high bit of the parameter number: the float
 *  variant of a parameter PN is `PN | 0x2000`, i.e. 0x20 set in the PN_MSB byte. */
export const FLOAT_FLAG = 0x20;

/** Read/response command numbers (carried in the PN field). See the wiki's
 *  "Custom MIDI Commands". We use GET for read-back (replies are normal,
 *  self-describing commands we can decode + match by parameter + target). */
export const CMD = {
  RESPONSE: 0x01, // device → host reply (echoes target + value)
  IS_SUPPORTED: 0x02, // host → device: is this parameter/target supported?
  READ: 0x03, // host → device: read → 0x01 response(s)
  GET: 0x04, // host → device: get → normal command reply per parameter
} as const;

/** Broadcast device id (addresses every device on the bus). */
export const DEVICE_BROADCAST = 0x7f;

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
// General command building (full PN/TG/device space — config + read-back)
// ---------------------------------------------------------------------------

export interface CommandSpec {
  /** Full parameter number, e.g. 0x260 (Coil Max Ontime). The float variant is
   *  selected via `isFloat` (which sets PN | 0x2000), not by passing it here. */
  pn: number;
  /** Full 16-bit target (TG): coil index 0..5, or 0x7f wildcard. */
  target?: number;
  value?: number;
  isFloat?: boolean;
  /** Destination device id (0..126), or 0x7f broadcast. */
  deviceId?: number;
  /** Explicit 5 value bytes, bypassing value/isFloat packing (e.g. the GET
   *  command's char[4] parameter-range payload). */
  rawValue?: number[];
}

/**
 * Build any 16-byte Syntherrupter command for the full parameter space:
 *   F0 00 26 05 | ver(01) | devID | PN_LSB PN_MSB | TG_LSB TG_MSB | v0..v4 | F7
 * PN_MSB carries the high parameter byte plus the float bit (0x20). For the four
 * legacy playback commands this produces the exact same bytes as buildFrame.
 */
export function buildCommand({
  pn,
  target = 0,
  value = 0,
  isFloat = false,
  deviceId = DEVICE_BROADCAST,
  rawValue,
}: CommandSpec): number[] {
  const safe = Number.isFinite(value) ? value : 0;
  const bits = isFloat ? floatToBits(safe) : Math.trunc(safe);
  const valueBytes = (rawValue ?? pack7(bits)).slice(0, 5);
  while (valueBytes.length < 5) valueBytes.push(0);
  return [
    0xf0, 0x00, 0x26, 0x05, 0x01,
    deviceId & 0x7f,
    pn & 0x7f, // PN_LSB
    ((pn >> 8) & 0x7f) | (isFloat ? FLOAT_FLAG : 0), // PN_MSB (+ float bit)
    target & 0x7f, // TG_LSB
    (target >> 8) & 0x7f, // TG_MSB
    ...valueBytes.map((b) => b & 0x7f),
    SYSEX_END,
  ];
}

/**
 * Build a GET (read-back) command for one parameter, or a [first..last] range,
 * on `target` (a coil, or 0x7f to read every coil → one reply per coil). The
 * device answers with normal commands carrying the current value(s).
 *
 * The firmware reads the range from the (7-bit-unpacked) 32-bit value as
 * `start = value & 0x7f7f` and `end = (value >> 16) & 0x7f7f` (see Sysex.cpp),
 * i.e. the value is `firstPN | (lastPN << 16)` packed like any other value — NOT
 * the four PN bytes laid out raw (those wouldn't survive the 7-bit packing).
 */
export function buildRead(
  pnFirst: number,
  target: number = DEVICE_BROADCAST,
  pnLast: number = pnFirst,
  deviceId: number = DEVICE_BROADCAST,
): number[] {
  const value = (pnFirst & 0xffff) + (pnLast & 0xffff) * 0x10000;
  return buildCommand({ pn: CMD.GET, target, deviceId, value });
}

/** String parameters (user name/password) carry 4 ASCII chars per frame. */
export const STRING_GROUP_SIZE = 4;

/**
 * Build the frames that set a `char[4]`-chunked string parameter (user name
 * `0x240` / password `0x241`) for `user` (TG_LSB). Each frame's TG_MSB is the
 * char-group position; writing group 0 first clears the old string on-device, so
 * the returned frames (group 0 onward) fully replace it. An empty string emits a
 * single group-0 clear frame.
 */
export function buildStringFrames(
  pn: number,
  user: number,
  text: string,
  deviceId: number = DEVICE_BROADCAST,
): number[][] {
  const bytes = Array.from(text, (c) => c.charCodeAt(0) & 0x7f); // 7-bit ASCII
  const groups = Math.max(1, Math.ceil(bytes.length / STRING_GROUP_SIZE));
  const frames: number[][] = [];
  for (let g = 0; g < groups; g++) {
    const chunk = [0, 1, 2, 3].map((k) => bytes[g * STRING_GROUP_SIZE + k] ?? 0);
    frames.push(buildCommand({ pn, target: (user & 0x7f) | (g << 8), deviceId, rawValue: [...chunk, 0] }));
  }
  return frames;
}

/** Reassemble a string from its GET-reply frames (one per char group), in order. */
export function reassembleString(frames: DecodedFrame[]): string {
  const sorted = [...frames].sort((a, b) => (a.target >> 8) - (b.target >> 8));
  const chars: number[] = [];
  for (const f of sorted) {
    for (let k = 0; k < STRING_GROUP_SIZE; k++) chars.push(f.valueBytes[k] ?? 0);
  }
  const end = chars.indexOf(0);
  return String.fromCharCode(...(end >= 0 ? chars.slice(0, end) : chars));
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

/**
 * SysEx frame for a single mid-song coil parameter change (a CoilEvent):
 * ontime (µs, integer) or duty (fraction, IEEE-754 float), targeting one coil.
 */
export function coilEventFrame(
  coilIndex: number,
  param: 'ontime' | 'duty',
  value: number,
  mode: number = MODE_BYTE.midi,
): number[] {
  return param === 'duty'
    ? encodeDuty(coilIndex, value, mode)
    : encodeOntime(coilIndex, value, mode);
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
  /** Legacy: PN_LSB only (byte 6). Kept for the synth + existing callers. */
  pn: number;
  /** Full parameter number = PN_LSB | (basePN_MSB << 8), float bit stripped. */
  pnFull: number;
  isFloat: boolean;
  /** Legacy: TG_LSB only (byte 8) = coil index. */
  coil: number;
  /** Legacy: TG_MSB only (byte 9) = playback-mode byte. */
  mode: number;
  /** Full target = TG_LSB | (TG_MSB << 8). */
  target: number;
  /** Destination/source device id (byte 5). */
  deviceId: number;
  /** Value read as an integer (7-bit reassembly). */
  valueInt: number;
  /** Same bits reinterpreted as an IEEE-754 float. */
  valueFloat: number;
  /** The 5 raw value bytes (10..14) — used for char[4] string parameters. */
  valueBytes: number[];
}

export function decodeFrame(frame: number[] | string): DecodedFrame {
  const bytes = typeof frame === 'string' ? hexToBytes(frame) : frame;
  const valueBytes = bytes.slice(10, 15);
  const valueInt = unpack7(valueBytes);
  const pnMsb = bytes[7] ?? 0;
  const basePnMsb = pnMsb & ~FLOAT_FLAG & 0x7f;
  return {
    pn: bytes[6],
    pnFull: (bytes[6] ?? 0) | (basePnMsb << 8),
    isFloat: (pnMsb & FLOAT_FLAG) !== 0,
    coil: bytes[8],
    mode: bytes[9],
    target: (bytes[8] ?? 0) | ((bytes[9] ?? 0) << 8),
    deviceId: bytes[5],
    valueInt,
    valueFloat: bitsToFloat(valueInt),
    valueBytes,
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
