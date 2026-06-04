import { describe, it, expect } from 'vitest';
import {
  buildCommand,
  buildRead,
  buildStringFrames,
  reassembleString,
  decodeFrame,
  encodeOntime,
  encodeDuty,
  encodeChannelMap,
  bytesToHex,
  CMD,
} from './syntherrupter';

describe('Syntherrupter general command builder + read-back', () => {
  it('reproduces the legacy ontime frame via buildCommand (TG_MSB carries the mode)', () => {
    // legacy encodeOntime(0,40) = mode 0x02 in TG_MSB → target = coil | (0x02<<8)
    expect(bytesToHex(buildCommand({ pn: 0x21, target: 0x0200, value: 40 }))).toBe(
      bytesToHex(encodeOntime(0, 40)),
    );
  });

  it('encodes a multi-byte PN with the float bit (Coil Max Ontime 0x260, float)', () => {
    const f = buildCommand({ pn: 0x260, target: 1, value: 10, isFloat: true });
    expect(f[6]).toBe(0x60); // PN_LSB
    expect(f[7]).toBe(0x22); // PN_MSB = 0x02 | float-bit 0x20
    expect(f[8]).toBe(0x01); // TG_LSB = coil 1
    expect(f[9]).toBe(0x00); // TG_MSB
    const d = decodeFrame(f);
    expect(d.pnFull).toBe(0x260);
    expect(d.target).toBe(1);
    expect(d.isFloat).toBe(true);
    expect(d.valueFloat).toBeCloseTo(10, 3);
  });

  it('round-trips buildCommand <-> decodeFrame for int + float + system PNs', () => {
    const maxDuty = decodeFrame(buildCommand({ pn: 0x261, target: 2, value: 0.05, isFloat: true }));
    expect(maxDuty.pnFull).toBe(0x261);
    expect(maxDuty.target).toBe(2);
    expect(maxDuty.valueFloat).toBeCloseTo(0.05, 6);

    const devId = decodeFrame(buildCommand({ pn: 0x201, value: 5 }));
    expect(devId.pnFull).toBe(0x201);
    expect(devId.valueInt).toBe(5);

    const baud = decodeFrame(buildCommand({ pn: 0x205, value: 115200 }));
    expect(baud.pnFull).toBe(0x205);
    expect(baud.valueInt).toBe(115200);
  });

  it('builds a GET (0x04) read whose value decodes to [firstPN..lastPN] per Sysex.cpp', () => {
    const f = buildRead(0x260, 0x7f, 0x261);
    const d = decodeFrame(f);
    expect(d.pnFull).toBe(CMD.GET); // PN = 0x04
    expect(d.target).toBe(0x7f); // TG = wildcard (all coils)
    // firmware: readRangeStart = value & 0x7f7f, readRangeEnd = (value >> 16) & 0x7f7f
    expect(d.valueInt & 0x7f7f).toBe(0x260);
    expect((d.valueInt >>> 16) & 0x7f7f).toBe(0x261);
  });

  it('single-parameter GET reads exactly that parameter (start == end)', () => {
    const d = decodeFrame(buildRead(0x201, 0));
    expect(d.valueInt & 0x7f7f).toBe(0x201);
    expect((d.valueInt >>> 16) & 0x7f7f).toBe(0x201);
  });

  it('encodes a per-user limit on the user target (0x242 Max Ontime)', () => {
    const d = decodeFrame(buildCommand({ pn: 0x242, target: 2, value: 200, isFloat: true }));
    expect(d.pnFull).toBe(0x242);
    expect(d.target).toBe(2); // user 2
    expect(d.valueFloat).toBeCloseTo(200, 3);
  });

  it('chunks a user name into char[4] groups (TG_LSB=user, TG_MSB=group) and round-trips', () => {
    const frames = buildStringFrames(0x240, 1, 'MyCoilName'); // 10 chars → 3 groups
    expect(frames.length).toBe(3);
    const d0 = decodeFrame(frames[0]);
    expect(d0.pnFull).toBe(0x240);
    expect(d0.target & 0xff).toBe(1); // user 1
    expect(d0.target >> 8).toBe(0); // group 0
    expect(decodeFrame(frames[2]).target >> 8).toBe(2); // group 2
    expect(reassembleString(frames.map(decodeFrame))).toBe('MyCoilName');
  });

  it('empty string emits one group-0 clear frame', () => {
    const frames = buildStringFrames(0x241, 0, '');
    expect(frames.length).toBe(1);
    expect(reassembleString(frames.map(decodeFrame))).toBe('');
  });

  it('decodeFrame still reports legacy fields unchanged', () => {
    const ontime = decodeFrame(encodeOntime(2, 30));
    expect(ontime.pn).toBe(0x21);
    expect(ontime.coil).toBe(2);
    expect(ontime.valueInt).toBe(30);
    const duty = decodeFrame(encodeDuty(0, 0.05));
    expect(duty.isFloat).toBe(true);
    expect(duty.valueFloat).toBeCloseTo(0.05, 6);
    const map = decodeFrame(encodeChannelMap(1, 0xabcd));
    expect(map.pn).toBe(0x60);
    expect(map.valueInt).toBe(0xabcd);
  });
});
