/**
 * A bidirectional serial link to the Syntherrupter, exposed as a {@link MidiSink}
 * so it slots into the app's output abstraction (store `midiOutput`). On top of
 * the sink it adds the read-back the config page needs: `read()` sends a GET and
 * collects the device's replies, and `onParam` streams every decoded response.
 *
 * v1 = control/config channel: `send()` writes notes best-effort/immediately
 * (WebSerial has no timestamped scheduling); precise real-time playback over
 * serial is deferred — playback stays on the synth / WebMIDI.
 */
import type { MidiSink } from '@/audio/tesla-synth';
import { buildRead, decodeFrame, type DecodedFrame } from '@/sysex/syntherrupter';
import { openSerialLink, DEFAULT_SERIAL_BAUD, type SerialLink } from '@/serial/web-serial';
import { logTx, logRx, logSerial } from '@/serial/serial-log';

export const SERIAL_OUTPUT_ID = '__serial__';
const READ_TIMEOUT_MS = 600;

export class SerialMidiOutput implements MidiSink {
  readonly id = SERIAL_OUTPUT_ID;
  readonly name: string;
  private link: SerialLink | null = null;
  private listeners = new Set<(f: DecodedFrame) => void>();
  private onClosedCb: () => void;

  private constructor(name: string, onClosed: () => void) {
    this.name = name;
    this.onClosedCb = onClosed;
  }

  /** Open a port and return a connected output. `onClosed` fires on unplug/close. */
  static async open(
    port: SerialPort,
    label: string,
    onClosed: () => void,
    baud = DEFAULT_SERIAL_BAUD,
  ): Promise<SerialMidiOutput> {
    const out = new SerialMidiOutput(label, onClosed);
    out.link = await openSerialLink(
      port,
      baud,
      (frame) => out.handleFrame(frame),
      () => out.handleClosed(),
    );
    logSerial(`connected "${label}" @ ${baud} baud`);
    return out;
  }

  get connected(): boolean {
    return this.link != null;
  }

  /** Subscribe to decoded inbound parameter frames; returns an unsubscribe fn. */
  onParam(cb: (f: DecodedFrame) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private handleFrame(frame: number[]): void {
    // only our manufacturer id (F0 00 26 05 …)
    const ours = frame[1] === 0x00 && frame[2] === 0x26 && frame[3] === 0x05;
    logRx(frame, ours);
    if (!ours) return;
    const dec = decodeFrame(frame);
    for (const l of this.listeners) l(dec);
  }

  private handleClosed(): void {
    this.link = null;
    this.onClosedCb();
  }

  private writeBytes(bytes: number[]): void {
    // fire-and-forget: serial writes are ordered + fast; errors surface via close
    logTx(bytes);
    void this.link?.write(bytes);
  }

  // --- MidiSink ------------------------------------------------------------
  send(data: number[]): void {
    this.writeBytes(data); // immediate (no scheduled-time send over serial in v1)
  }

  sendSysex(manufacturer: number | number[], data: number[]): void {
    const mfr = Array.isArray(manufacturer) ? manufacturer : [manufacturer];
    this.writeBytes([0xf0, ...mfr, ...data, 0xf7]);
  }

  sendAllSoundOff(): void {
    for (let ch = 0; ch < 16; ch++) this.writeBytes([0xb0 | ch, 0x78, 0x00]);
  }

  clear(): void {
    /* nothing buffered — writes are immediate */
  }

  // --- read-back -----------------------------------------------------------
  /**
   * Send a GET for parameter `pnFirst` (or the `[pnFirst..pnLast]` range) on
   * `target` (a coil, or 0x7f to read every coil) and collect the replies that
   * arrive within `timeoutMs`. Caller filters by `pnFull`/`target`.
   */
  read(
    pnFirst: number,
    target: number,
    pnLast: number = pnFirst,
    timeoutMs: number = READ_TIMEOUT_MS,
  ): Promise<DecodedFrame[]> {
    return new Promise((resolve) => {
      const got: DecodedFrame[] = [];
      const off = this.onParam((f) => got.push(f));
      this.writeBytes(buildRead(pnFirst, target, pnLast));
      setTimeout(() => {
        off();
        logSerial(
          `read 0x${pnFirst.toString(16)}…0x${pnLast.toString(16)} tg=${target} → ${got.length} repl${got.length === 1 ? 'y' : 'ies'}`,
        );
        resolve(got);
      }, timeoutMs);
    });
  }

  async close(): Promise<void> {
    const l = this.link;
    this.link = null;
    await l?.close();
  }
}
