/**
 * Live SysEx helpers used by the player while a song is playing.
 *
 * Everything is expressed against the structured per-coil model (CoilConfig[]):
 * compilation happens in the browser via src/sysex/syntherrupter.ts. There is
 * deliberately NO code that reads the legacy pre-compiled `song.sysex` array —
 * the database is migrated to the per-coil model (jalon 2) rather than kept
 * backward-compatible.
 */

import { encodeOntime, encodeDuty, hexToBytes } from '@/sysex/syntherrupter';
import type { CoilConfig } from '@/types/domain';

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

/** Re-send each coil's ontime scaled by `ratioPercent` (0..200), live. */
export function sendLiveOntimeAdjust(
  coils: CoilConfig[],
  ratioPercent: number,
  midiOutput: SysexOutput,
): void {
  for (const coil of coils) {
    sendSysex(midiOutput, encodeOntime(coil.coilIndex, Math.round((coil.ontimeUs * ratioPercent) / 100)));
  }
}

/** Re-send each coil's duty scaled by `ratioPercent` (0..200), live. */
export function sendLiveDutyAdjust(
  coils: CoilConfig[],
  ratioPercent: number,
  midiOutput: SysexOutput,
): void {
  for (const coil of coils) {
    sendSysex(midiOutput, encodeDuty(coil.coilIndex, (coil.duty * ratioPercent) / 100));
  }
}
