import { CMD, DEVICE_BROADCAST, FLOAT_FLAG, STRING_GROUP_SIZE, SYSEX_END, SYSEX_HEADER } from '@/model/sysex/syntherrupter';

/** A legacy playback frame: one of the four commands, its low PN, a coil and the mode byte. */
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
 * A Syntherrupter SysEx frame (16 bytes), decoded; and the ways to build one:
 *
 *   F0 00 26 05 | ver(01) | devID | PN_LSB PN_MSB | TG_LSB TG_MSB | v0..v4 | F7
 *
 * PN_MSB carries the high parameter byte plus the float bit (0x20); the 32-bit
 * value goes 7 bits a byte, least significant first. A non-finite value (NaN
 * from an empty input) never reaches a coil as garbage bits: it goes as 0.
 */
export class DevFrame {
  /** Legacy: PN_LSB only (byte 6). Kept for the synth + existing callers. */
  readonly pn: number;
  /** Full parameter number = PN_LSB | (basePN_MSB << 8), float bit stripped. */
  readonly pnFull: number;
  readonly isFloat: boolean;
  /** Legacy: TG_LSB only (byte 8) = coil index. */
  readonly coil: number;
  /** Legacy: TG_MSB only (byte 9) = playback-mode byte. */
  readonly mode: number;
  /** Full target = TG_LSB | (TG_MSB << 8). */
  readonly target: number;
  /** Destination/source device id (byte 5). */
  readonly deviceId: number;
  /** Value read as an integer (7-bit reassembly). */
  readonly valueInt: number;
  /** Same bits reinterpreted as an IEEE-754 float. */
  readonly valueFloat: number;
  /** The 5 raw value bytes (10..14) — used for char[4] string parameters. */
  readonly valueBytes: number[];

  private constructor(bytes: number[]) {
    this.valueBytes = bytes.slice(10, 15);
    this.valueInt = DevFrame.unpack7(this.valueBytes);
    const pnMsb = bytes[7] ?? 0;
    const basePnMsb = pnMsb & ~FLOAT_FLAG & 0x7f;
    this.pn = bytes[6];
    this.pnFull = (bytes[6] ?? 0) | (basePnMsb << 8);
    this.isFloat = (pnMsb & FLOAT_FLAG) !== 0;
    this.coil = bytes[8];
    this.mode = bytes[9];
    this.target = (bytes[8] ?? 0) | ((bytes[9] ?? 0) << 8);
    this.deviceId = bytes[5];
    this.valueFloat = DevFrame.bitsToFloat(this.valueInt);
  }

  /** A frame's bytes, or their hex (the legacy storage/transport format), decoded. */
  /** True for a complete Syntherrupter SysEx frame (F0 00 26 05 …). */
  static isSyntherrupter(frame: ArrayLike<number>): boolean {
    return frame.length >= 4 && frame[0] === 0xf0 && frame[1] === 0x00 && frame[2] === 0x26 && frame[3] === 0x05;
  }

  static decode(frame: number[] | string): DevFrame {
    return new DevFrame(typeof frame === 'string' ? DevFrame.bytes(frame) : frame);
  }

  /** A legacy playback frame. */
  static build({ pn, coil, mode, value, isFloat = false }: FrameSpec): number[] {
    const safe = Number.isFinite(value) ? value : 0;
    const bits = isFloat ? DevFrame.floatToBits(safe) : Math.trunc(safe);
    return [...SYSEX_HEADER, pn, isFloat ? FLOAT_FLAG : 0x00, coil & 0x7f, mode, ...DevFrame.pack7(bits), SYSEX_END];
  }

  /** Any command of the full parameter space; for the four legacy playback commands, the same bytes as build(). */
  static command({ pn, target = 0, value = 0, isFloat = false, deviceId = DEVICE_BROADCAST, rawValue }: CommandSpec): number[] {
    const safe = Number.isFinite(value) ? value : 0;
    const bits = isFloat ? DevFrame.floatToBits(safe) : Math.trunc(safe);
    const valueBytes = (rawValue ?? DevFrame.pack7(bits)).slice(0, 5);
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
   * A GET (read-back) command for one parameter, or a [first..last] range,
   * on `target` (a coil, or 0x7f to read every coil → one reply per coil). The
   * device answers with normal commands carrying the current value(s).
   *
   * The firmware reads the range from the (7-bit-unpacked) 32-bit value as
   * `start = value & 0x7f7f` and `end = (value >> 16) & 0x7f7f` (see Sysex.cpp),
   * i.e. the value is `firstPN | (lastPN << 16)` packed like any other value — NOT
   * the four PN bytes laid out raw (those wouldn't survive the 7-bit packing).
   */
  static read(pnFirst: number, target: number = DEVICE_BROADCAST, pnLast: number = pnFirst, deviceId: number = DEVICE_BROADCAST): number[] {
    const value = (pnFirst & 0xffff) + (pnLast & 0xffff) * 0x10000;
    return DevFrame.command({ pn: CMD.GET, target, deviceId, value });
  }

  /**
   * The frames that set a `char[4]`-chunked string parameter (user name
   * `0x240` / password `0x241`) for `user` (TG_LSB). Each frame's TG_MSB is the
   * char-group position; writing group 0 first clears the old string on-device, so
   * the returned frames (group 0 onward) fully replace it. An empty string emits a
   * single group-0 clear frame.
   *
   * The firmware rebuilds the 32-bit value from the 7-bit groups like any other
   * value and reads the 4 chars from it (little endian, `value.chr[0..3]` in
   * Sysex.cpp) — so the chars are packed into a 32-bit value first (Syfoh does the
   * same), not laid out raw in v0..v3.
   */
  static strings(pn: number, user: number, text: string, deviceId: number = DEVICE_BROADCAST): number[][] {
    const bytes = Array.from(text, (c) => c.charCodeAt(0) & 0x7f); // 7-bit ASCII
    const groups = Math.max(1, Math.ceil(bytes.length / STRING_GROUP_SIZE));
    const frames: number[][] = [];
    for (let g = 0; g < groups; g++) {
      const chunk = [0, 1, 2, 3].map((k) => bytes[g * STRING_GROUP_SIZE + k] ?? 0);
      const value = chunk[0] + chunk[1] * 0x100 + chunk[2] * 0x10000 + chunk[3] * 0x1000000;
      frames.push(DevFrame.command({ pn, target: (user & 0x7f) | (g << 8), deviceId, value }));
    }
    return frames;
  }

  /** A string from its GET-reply frames (one per char group), in order. */
  static joinString(frames: readonly DevFrame[]): string {
    const sorted = [...frames].sort((a, b) => (a.target >> 8) - (b.target >> 8));
    const chars: number[] = [];
    for (const f of sorted) {
      for (let k = 0; k < STRING_GROUP_SIZE; k++) chars.push((f.valueInt >>> (8 * k)) & 0xff);
    }
    const end = chars.indexOf(0);
    return String.fromCharCode(...(end >= 0 ? chars.slice(0, end) : chars));
  }

  /** Bytes as hex, the legacy storage/transport format. */
  static hex(bytes: number[]): string {
    return bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
  }

  static bytes(hex: string): number[] {
    return hex.trim().split(/\s+/).map((s) => parseInt(s, 16));
  }

  /** A 32-bit value as 5 bytes of 7 bits each, least-significant first. */
  static pack7(value: number): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < 5; i++) bytes.push((value >> (i * 7)) & 0x7f);
    return bytes;
  }

  /** A 32-bit value from 7-bit groups (LSB first). Inverse of pack7. */
  static unpack7(bytes: number[]): number {
    return bytes.reduce((acc, byte, i) => acc + ((byte & 0x7f) << (i * 7)), 0);
  }

  /** IEEE-754 float -> its 32-bit pattern as a signed int (big-endian, as prod). */
  private static floatToBits(value: number): number {
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, value);
    return view.getInt32(0);
  }

  private static bitsToFloat(bits: number): number {
    const view = new DataView(new ArrayBuffer(4));
    view.setInt32(0, bits);
    return view.getFloat32(0);
  }
}
