/**
 * Low-level MIDI-over-serial plumbing for the Syntherrupter link (WebSerial).
 * Frame-agnostic: opens a port at a MIDI baud rate, writes raw bytes, and parses
 * the inbound byte stream into complete SysEx frames. No app/Vue dependencies.
 */
import { logRxRaw } from '@/serial/serial-log';

export const DEFAULT_SERIAL_BAUD = 115200;

export interface SerialLink {
  write(bytes: number[]): Promise<void>;
  close(): Promise<void>;
}

/**
 * Reassembles complete SysEx frames (`F0 … F7`) from a raw MIDI byte stream.
 * Realtime bytes (0xF8–0xFF) are transparent; any other status byte mid-SysEx
 * aborts the (corrupt) partial frame.
 */
export class SysexFramer {
  private buf: number[] = [];
  private inSysex = false;

  /** Feed an incoming chunk; returns every complete SysEx frame it completes. */
  push(chunk: Uint8Array): number[][] {
    const frames: number[][] = [];
    for (const b of chunk) {
      if (b === 0xf0) {
        this.inSysex = true;
        this.buf = [0xf0];
      } else if (b >= 0xf8) {
        // realtime message — transparent, ignore (never part of a SysEx)
        continue;
      } else if (!this.inSysex) {
        continue; // outside a SysEx: ignore notes/CC/etc.
      } else if (b === 0xf7) {
        this.buf.push(0xf7);
        frames.push(this.buf);
        this.inSysex = false;
        this.buf = [];
      } else if (b >= 0x80) {
        // a new status byte interrupts an unterminated SysEx → drop it
        this.inSysex = false;
        this.buf = [];
      } else {
        this.buf.push(b);
      }
    }
    return frames;
  }
}

/**
 * Open `port` as a MIDI link. Spawns a read loop that calls `onFrame` for each
 * complete inbound SysEx frame and `onClosed` once when the stream ends (close
 * or device unplug). Returns a handle to write bytes and close cleanly.
 */
export async function openSerialLink(
  port: SerialPort,
  baudRate: number,
  onFrame: (frame: number[]) => void,
  onClosed: () => void,
): Promise<SerialLink> {
  await port.open({ baudRate });
  if (!port.writable || !port.readable) {
    await port.close();
    throw new Error('Serial port has no readable/writable stream');
  }
  const writer = port.writable.getWriter();
  const reader = port.readable.getReader();
  const framer = new SysexFramer();
  let closed = false;

  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.length) {
          logRxRaw(value);
          for (const f of framer.push(value)) onFrame(f);
        }
      }
    } catch {
      // read aborted by close() or a physical disconnect — fall through
    } finally {
      if (!closed) onClosed();
    }
  })();

  return {
    async write(bytes: number[]): Promise<void> {
      await writer.write(Uint8Array.from(bytes));
    },
    async close(): Promise<void> {
      closed = true;
      try { await reader.cancel(); } catch { /* already gone */ }
      try { reader.releaseLock(); } catch { /* */ }
      try { await writer.close(); } catch { /* */ }
      try { writer.releaseLock(); } catch { /* */ }
      try { await port.close(); } catch { /* */ }
    },
  };
}
