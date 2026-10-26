/**
 * What the Syntherrupter config page needs from a connection to the device:
 * send raw MIDI/SysEx bytes and read parameters back (GET → replies). Provided
 * by the Web Serial link (SerialMidiOutput) and, for devices that answer on
 * their MIDI output (e.g. the native USB-MIDI port of the ESP32 port), by the
 * Web MIDI link (WebMidiLink).
 */

import type { DevFrame } from '@/model/sysex/frame';

export interface DeviceLink {
  /** Human readable name of the link (sidebar / logs). */
  readonly name: string;
  /** Write bytes immediately. */
  send(data: number[]): void;
  /** Subscribe to decoded inbound Syntherrupter frames; returns an unsubscribe fn. */
  onParam(cb: (f: DevFrame) => void): () => void;
  /**
   * Send a GET for `pnFirst` (or the `[pnFirst..pnLast]` range) on `target` and
   * collect the replies arriving within `timeoutMs`.
   */
  read(pnFirst: number, target: number, pnLast?: number, timeoutMs?: number): Promise<DevFrame[]>;
}

/** Default time to wait for the replies of one GET. */
export const READ_TIMEOUT_MS = 600;
