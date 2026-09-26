/**
 * What the Syntherrupter config page needs from a connection to the device:
 * send raw MIDI/SysEx bytes and read parameters back (GET → replies). Provided
 * by the Web Serial link (SerialMidiOutput) and, for devices that answer on
 * their MIDI output (e.g. the native USB-MIDI port of the ESP32 port), by the
 * Web MIDI link (WebMidiLink).
 */
import type { DecodedFrame } from '@/sysex/syntherrupter';

export interface DeviceLink {
  /** Human readable name of the link (sidebar / logs). */
  readonly name: string;
  /** Write bytes immediately. */
  send(data: number[]): void;
  /** Subscribe to decoded inbound Syntherrupter frames; returns an unsubscribe fn. */
  onParam(cb: (f: DecodedFrame) => void): () => void;
  /**
   * Send a GET for `pnFirst` (or the `[pnFirst..pnLast]` range) on `target` and
   * collect the replies arriving within `timeoutMs`.
   */
  read(pnFirst: number, target: number, pnLast?: number, timeoutMs?: number): Promise<DecodedFrame[]>;
}

/** Default time to wait for the replies of one GET. */
export const READ_TIMEOUT_MS = 600;

/** True for a complete Syntherrupter SysEx frame (F0 00 26 05 …). */
export function isSyntherrupterFrame(frame: ArrayLike<number>): boolean {
  return frame.length >= 4 && frame[0] === 0xf0 && frame[1] === 0x00 && frame[2] === 0x26 && frame[3] === 0x05;
}
