/**
 * Config/read-back link over Web MIDI: sends on a Web MIDI output and listens
 * for the Syntherrupter's SysEx replies on the matching Web MIDI input (same
 * port name). Works with the native USB-MIDI port of the ESP32 port of the
 * Syntherrupter, and with a Tiva Syntherrupter whose DIN MIDI OUT (replies to
 * requests received on MIDI IN) is wired back to the interface.
 *
 * Unlike the serial link, playback over Web MIDI keeps its timestamped
 * scheduling: this link is only used by the config page, the output itself is
 * still the plain Web MIDI output.
 */
import type { Input, Output } from 'webmidi';
import { buildRead, decodeFrame, type DecodedFrame } from '@/sysex/syntherrupter';
import { READ_TIMEOUT_MS, isSyntherrupterFrame, type DeviceLink } from '@/serial/device-link';
import { logTx, logRx, logSerial } from '@/serial/serial-log';

/** The subset of a webmidi.js Input used here (eases testing). */
export type SysexInput = Pick<Input, 'name' | 'addListener' | 'removeListener'>;
/** The subset of a webmidi.js Output used here. */
export type RawOutput = Pick<Output, 'name' | 'send'>;

interface SysexEvent {
  message: { rawData: Uint8Array };
}

export class WebMidiLink implements DeviceLink {
  readonly name: string;
  private listeners = new Set<(f: DecodedFrame) => void>();
  private readonly onSysex = (e: SysexEvent): void => this.handleFrame(Array.from(e.message.rawData));

  constructor(
    private readonly output: RawOutput,
    private readonly input: SysexInput,
  ) {
    this.name = output.name;
    (this.input.addListener as (type: string, cb: (e: SysexEvent) => void) => unknown)('sysex', this.onSysex);
  }

  /**
   * Pair `output` with the input of the same device (same port name), or return
   * null if there is none (a plain MIDI interface without return path).
   */
  static pair(output: RawOutput, inputs: readonly SysexInput[]): WebMidiLink | null {
    const input = inputs.find((i) => i.name === output.name);
    return input ? new WebMidiLink(output, input) : null;
  }

  /** Stop listening (call when the output selection changes). */
  dispose(): void {
    (this.input.removeListener as (type: string, cb: (e: SysexEvent) => void) => unknown)('sysex', this.onSysex);
    this.listeners.clear();
  }

  onParam(cb: (f: DecodedFrame) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private handleFrame(frame: number[]): void {
    const ours = isSyntherrupterFrame(frame);
    logRx(frame, ours);
    if (!ours) return;
    const dec = decodeFrame(frame);
    for (const l of this.listeners) l(dec);
  }

  send(data: number[]): void {
    logTx(data);
    this.output.send(data);
  }

  read(
    pnFirst: number,
    target: number,
    pnLast: number = pnFirst,
    timeoutMs: number = READ_TIMEOUT_MS,
  ): Promise<DecodedFrame[]> {
    return new Promise((resolve) => {
      const got: DecodedFrame[] = [];
      const off = this.onParam((f) => got.push(f));
      this.send(buildRead(pnFirst, target, pnLast));
      setTimeout(() => {
        off();
        logSerial(
          `midi read 0x${pnFirst.toString(16)}…0x${pnLast.toString(16)} tg=${target} → ${got.length} repl${got.length === 1 ? 'y' : 'ies'}`,
        );
        resolve(got);
      }, timeoutMs);
    });
  }
}
