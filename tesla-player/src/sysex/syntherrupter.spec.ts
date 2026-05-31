import { describe, it, expect } from 'vitest';
import {
  encodeEnable,
  encodeChannelMap,
  encodeOntime,
  encodeDuty,
  buildFrame,
  bytesToHex,
  hexToBytes,
  decodeFrame,
  compileCoilConfig,
  compileSimpleConfig,
  compileSimpleStop,
  encodeBps,
  MODE_BYTE,
  pack7,
  unpack7,
  maskToChannels,
  channelsToMask,
} from './syntherrupter';

/*
 * Every expected string below is lifted VERBATIM from the production database
 * (table SysexCommand). Song 58 is a complete 3-coil configuration:
 *   enable midi-live
 *   ontime  coil0=40µs  coil1=40µs  coil2=30µs
 *   duty    coil0/1/2 = 0.05  (IEEE-754 float)
 *   chnmap  coil0->ch1(mask 2)  coil1->ch1(mask 2)  coil2->ch0(mask 1)
 * If the encoder ever drifts from the hardware-proven bytes, these fail.
 */

describe('Syntherrupter encoder — byte-exact against the production DB', () => {
  it('enable MIDI-Live', () => {
    expect(bytesToHex(encodeEnable())).toBe(
      'f0 00 26 05 01 7f 20 00 00 02 01 00 00 00 00 f7',
    );
  });

  it('ontime (integer µs)', () => {
    expect(bytesToHex(encodeOntime(0, 40))).toBe(
      'f0 00 26 05 01 7f 21 00 00 02 28 00 00 00 00 f7',
    );
    expect(bytesToHex(encodeOntime(1, 40))).toBe(
      'f0 00 26 05 01 7f 21 00 01 02 28 00 00 00 00 f7',
    );
    expect(bytesToHex(encodeOntime(2, 30))).toBe(
      'f0 00 26 05 01 7f 21 00 02 02 1e 00 00 00 00 f7',
    );
  });

  it('duty (IEEE-754 float, the production encoding)', () => {
    expect(bytesToHex(encodeDuty(0, 0.05))).toBe(
      'f0 00 26 05 01 7f 22 20 00 02 4d 19 33 6a 03 f7',
    );
    expect(bytesToHex(encodeDuty(1, 0.05))).toBe(
      'f0 00 26 05 01 7f 22 20 01 02 4d 19 33 6a 03 f7',
    );
    expect(bytesToHex(encodeDuty(2, 0.05))).toBe(
      'f0 00 26 05 01 7f 22 20 02 02 4d 19 33 6a 03 f7',
    );
  });

  it('channel -> coil map (16-bit mask)', () => {
    expect(bytesToHex(encodeChannelMap(0, 2))).toBe(
      'f0 00 26 05 01 7f 60 00 00 02 02 00 00 00 00 f7',
    );
    expect(bytesToHex(encodeChannelMap(1, 2))).toBe(
      'f0 00 26 05 01 7f 60 00 01 02 02 00 00 00 00 f7',
    );
    expect(bytesToHex(encodeChannelMap(2, 1))).toBe(
      'f0 00 26 05 01 7f 60 00 02 02 01 00 00 00 00 f7',
    );
  });

  it('packs / unpacks 7-bit groups', () => {
    expect(pack7(40)).toEqual([0x28, 0, 0, 0, 0]);
    expect(pack7(0xffff)).toEqual([0x7f, 0x7f, 0x03, 0, 0]);
    expect(unpack7(pack7(123456))).toBe(123456);
    expect(unpack7([0x4d, 0x19, 0x33, 0x6a, 0x03])).toBe(0x3d4ccccd);
  });

  it('decodes frames back to their parameters', () => {
    const duty = decodeFrame('f0 00 26 05 01 7f 22 20 02 02 4d 19 33 6a 03 f7');
    expect(duty.pn).toBe(0x22);
    expect(duty.isFloat).toBe(true);
    expect(duty.coil).toBe(2);
    expect(duty.valueFloat).toBeCloseTo(0.05, 6);

    const ontime = decodeFrame('f0 00 26 05 01 7f 21 00 02 02 1e 00 00 00 00 f7');
    expect(ontime.pn).toBe(0x21);
    expect(ontime.isFloat).toBe(false);
    expect(ontime.coil).toBe(2);
    expect(ontime.valueInt).toBe(30);

    const map = decodeFrame('f0 00 26 05 01 7f 60 00 02 02 01 00 00 00 00 f7');
    expect(map.pn).toBe(0x60);
    expect(map.coil).toBe(2);
    expect(map.valueInt).toBe(1);
  });

  it('round-trips encode -> decode for each command', () => {
    expect(decodeFrame(encodeOntime(4, 73)).valueInt).toBe(73);
    expect(decodeFrame(encodeDuty(5, 0.123)).valueFloat).toBeCloseTo(0.123, 6);
    expect(decodeFrame(encodeChannelMap(3, 0xabcd)).valueInt).toBe(0xabcd);
  });

  it('compiles a full per-song coil config (song 58 shape)', () => {
    const hex = compileCoilConfig(
      [
        { coilIndex: 0, channelMask: 2, ontimeUs: 40, duty: 0.05 },
        { coilIndex: 1, channelMask: 2, ontimeUs: 40, duty: 0.05 },
        { coilIndex: 2, channelMask: 1, ontimeUs: 30, duty: 0.05 },
      ],
      'midi',
    ).map(bytesToHex);

    expect(hex[0]).toBe('f0 00 26 05 01 7f 20 00 00 02 01 00 00 00 00 f7'); // enable
    expect(hex).toContain('f0 00 26 05 01 7f 21 00 02 02 1e 00 00 00 00 f7'); // ontime c2=30
    expect(hex).toContain('f0 00 26 05 01 7f 22 20 00 02 4d 19 33 6a 03 f7'); // duty c0=0.05
    expect(hex).toContain('f0 00 26 05 01 7f 60 00 02 02 01 00 00 00 00 f7'); // map c2=ch0
  });

  it('Simple mode (fixed mode) sets TG_MSB = 0x01', () => {
    const frame = decodeFrame(buildFrame({ pn: 0x21, coil: 0, mode: 0x01, value: 50 }));
    expect(frame.mode).toBe(0x01);
    expect(frame.valueInt).toBe(50);
  });

  it('encodes BPS / frequency (PN 0x23, integer Hz) in Simple mode', () => {
    expect(bytesToHex(encodeBps(0, 100))).toBe(
      'f0 00 26 05 01 7f 23 00 00 01 64 00 00 00 00 f7',
    );
    expect(bytesToHex(encodeBps(1, 440))).toBe(
      'f0 00 26 05 01 7f 23 00 01 01 38 03 00 00 00 f7',
    );
  });

  it('enable can disable a mode (value 0) — the fixed-mode stop', () => {
    expect(bytesToHex(encodeEnable(MODE_BYTE.simple, true))).toBe(
      'f0 00 26 05 01 7f 20 00 00 01 01 00 00 00 00 f7',
    );
    expect(bytesToHex(encodeEnable(MODE_BYTE.simple, false))).toBe(
      'f0 00 26 05 01 7f 20 00 00 01 00 00 00 00 00 f7',
    );
    expect(compileSimpleStop().map(bytesToHex)).toEqual([
      'f0 00 26 05 01 7f 20 00 00 01 00 00 00 00 00 f7',
    ]);
  });

  it('compiles fixed (Simple) config: per-coil ontime/duty/bps, enable LAST', () => {
    const hex = compileSimpleConfig([
      { coilIndex: 0, ontimeUs: 50, duty: 0.05, frequencyHz: 100 },
    ]).map(bytesToHex);
    expect(hex).toEqual([
      'f0 00 26 05 01 7f 21 00 00 01 32 00 00 00 00 f7', // ontime 50µs
      'f0 00 26 05 01 7f 22 20 00 01 4d 19 33 6a 03 f7', // duty 0.05 (float)
      'f0 00 26 05 01 7f 23 00 00 01 64 00 00 00 00 f7', // bps 100Hz
      'f0 00 26 05 01 7f 20 00 00 01 01 00 00 00 00 f7', // enable simple (last)
    ]);
  });

  it('converts between channel mask and boolean array', () => {
    expect(channelsToMask(maskToChannels(0xa5a5))).toBe(0xa5a5);
    const ch = maskToChannels(0b0000_0000_0000_0101); // channels 0 and 2
    expect(ch[0]).toBe(true);
    expect(ch[1]).toBe(false);
    expect(ch[2]).toBe(true);
    expect(ch[15]).toBe(false);
  });

  it('hex helpers are inverse', () => {
    const s = 'f0 00 26 05 01 7f 21 00 00 02 28 00 00 00 00 f7';
    expect(bytesToHex(hexToBytes(s))).toBe(s);
  });
});
