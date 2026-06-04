/**
 * Console logger for the serial / MIDI exchange with the Syntherrupter: every
 * frame written (TX), every complete frame received (RX, decoded), and the raw
 * inbound chunks. This is the tool for debugging the parameter read-back.
 *
 * Always on — logs go to `console.log` (visible at the default level); filter
 * the DevTools console on "[serial" to isolate them.
 */
import { bytesToHex, decodeFrame, CMD } from '@/sysex/syntherrupter';

const TX_STYLE = 'color:#ffb454;font-weight:bold';
const RX_STYLE = 'color:#46e0ff;font-weight:bold';
const RAW_STYLE = 'color:#888';
const INFO_STYLE = 'color:#9d7cff;font-weight:bold';

function isSyntherrupterFrame(f: ArrayLike<number>): boolean {
  return f.length >= 16 && f[0] === 0xf0 && f[1] === 0x00 && f[2] === 0x26 && f[3] === 0x05;
}

/** One-line human summary of a 16-byte Syntherrupter frame (or '' if foreign). */
function describe(frame: number[]): string {
  if (!isSyntherrupterFrame(frame)) return '';
  const d = decodeFrame(frame);
  if (d.pnFull === CMD.GET) {
    // firmware reads the range as: start = value & 0x7f7f, end = (value >> 16) & 0x7f7f
    const first = (d.valueInt & 0x7f7f).toString(16);
    const last = ((d.valueInt >>> 16) & 0x7f7f).toString(16);
    return `GET 0x${first}…0x${last}  tg=${d.target}`;
  }
  const val = d.isFloat ? `float=${d.valueFloat}` : `int=${d.valueInt}`;
  return `pn=0x${d.pnFull.toString(16)}  tg=${d.target}  ${val}${d.isFloat ? '' : ` (float=${d.valueFloat})`}`;
}

/** Log an outgoing frame — SysEx only (note-on/off & other channel data are skipped). */
export function logTx(bytes: number[]): void {
  if (bytes[0] !== 0xf0) return;
  const note = describe(bytes);
  console.log(`%c[serial →]%c ${bytesToHex(bytes)}${note ? '   ' + note : ''}`, TX_STYLE, '');
}

/** Log a complete inbound frame; `ours` = matches the Syntherrupter manufacturer id. */
export function logRx(frame: number[], ours: boolean): void {
  const note = ours ? describe(frame) : '(other manufacturer — ignored)';
  console.log(`%c[serial ←]%c ${bytesToHex(frame)}${note ? '   ' + note : ''}`, RX_STYLE, '');
}

/** Log a raw inbound chunk straight off the wire (before SysEx framing). */
export function logRxRaw(chunk: Uint8Array): void {
  console.log(`%c[serial ←raw]%c ${bytesToHex([...chunk])}`, RAW_STYLE, '');
}

/** Log a serial lifecycle / read-summary line. */
export function logSerial(...args: unknown[]): void {
  console.log('%c[serial]', INFO_STYLE, ...args);
}
