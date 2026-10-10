import { describe, expect, it } from 'vitest';
import { fakeDeviceLink } from './fake-device';
import { BOARD_PN, boardState, decodeBoardStatus, statusEvents } from '@/sysex/board';

describe("the tour's Syntherrupter", () => {
  it('answers the coil discovery with one reply per coil', async () => {
    const probe = await fakeDeviceLink.read(0x260, 0x7f);
    expect(probe.map((f) => [f.pnFull, f.target & 0xff])).toEqual([[0x260, 0], [0x260, 1], [0x260, 2]]);
  });

  it('answers a range on one target with its own values', async () => {
    const coil = await fakeDeviceLink.read(0x261, 1, 0x265);
    expect(coil.map((f) => f.pnFull)).toEqual([0x261, 0x262, 0x263, 0x264, 0x265]);
    expect(coil.every((f) => (f.target & 0xff) === 1)).toBe(true);
    const user = await fakeDeviceLink.read(0x240, 2, 0x244);
    expect(user.find((f) => f.pnFull === 0x244)?.valueInt).toBe(2000);
    expect(user.some((f) => f.pnFull === 0x240)).toBe(false); // names have no read-back
  });

  it('says all is well to a subscription to its status', async () => {
    const got: number[] = [];
    const off = fakeDeviceLink.onParam((f) => { if (f.pnFull === BOARD_PN.STATUS) got.push(f.valueInt); });
    fakeDeviceLink.send(statusEvents(true));
    await new Promise((r) => setTimeout(r, 50));
    off();
    expect(got).toHaveLength(1);
    expect(boardState(decodeBoardStatus(got[0]))).toBe('ok');
  });
});
