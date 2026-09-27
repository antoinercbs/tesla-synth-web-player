/**
 * Sending a compiled SysEx frame to a Web MIDI output. Frames are compiled in the
 * browser from the per-coil model (src/sysex/syntherrupter.ts); there is
 * deliberately NO code reading the legacy pre-compiled `song.sysex` array.
 */

import { hexToBytes } from '@/sysex/syntherrupter';

/** Minimal contract we need from a Web MIDI output (webmidi.js `Output`). */
export interface SysexOutput {
  sendSysex(manufacturer: number | number[], data: number[]): unknown;
}

/**
 * Send a single frame. Accepts a hex string ("f0 00 ..") or a byte array.
 * Splits it the way webmidi.js expects: manufacturer = bytes 1..3, data =
 * bytes 4..14 (the surrounding 0xF0 / 0xF7 are added by webmidi).
 */
export function sendSysex(midiOutput: SysexOutput, payload: string | number[]): void {
  const bytes = typeof payload === 'string' ? hexToBytes(payload) : payload;
  midiOutput.sendSysex(bytes.slice(1, 4), bytes.slice(4, 15));
}

