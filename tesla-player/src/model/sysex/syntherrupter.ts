/**
 * The Syntherrupter's SysEx protocol: its constants. Frames are built and
 * decoded by DevFrame (frame.ts), a board's messages by its driver
 * (DevSyntherrupterV1). The four playback commands:
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

import type { PlaybackMode } from '@/model/domain';

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

/** String parameters (user name/password) carry 4 ASCII chars per frame. */
export const STRING_GROUP_SIZE = 4;

/** Envelope step fields: TG_MSB = program (0..63), TG_LSB = step (0..7). */
export const ENVELOPE_PN = {
  NEXT: 0x300,
  AMPLITUDE: 0x301,
  DURATION: 0x302,
  NTAU: 0x303,
} as const;

/** Spatialisation, per coil (TG_LSB); RESET_NRPS takes a channel bitfield. */
export const PAN_PN = {
  CONFIG: 0x62,
  POSITION: 0x63,
  REACH: 0x64,
  RESET_NRPS: 0x66,
} as const;
