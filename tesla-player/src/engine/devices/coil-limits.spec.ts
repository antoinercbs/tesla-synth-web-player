import { describe, expect, it } from 'vitest';
import { readCoilLimits } from './coil-limits';
import type { DeviceLink } from '@/model/devices/device-link';
import { DevFrame } from '@/model/sysex/frame';

/** A board answering the wildcard GETs with `values[pn][coil]`, in device units. */
function board(values: Record<number, number[]>) {
  const reads: number[][] = [];
  const link: DeviceLink = {
    name: 'board',
    send: () => {},
    onParam: () => () => {},
    read: async (pn, target, pnLast) => {
      reads.push(DevFrame.read(pn, target, pnLast));
      return (values[pn] ?? []).map((value, coil) => DevFrame.decode(DevFrame.command({ pn, target: coil, value })));
    },
  };
  return { link, reads };
}

describe('reading the coil limits', () => {
  it('reads the four limits of every coil, duty in ‰', async () => {
    const b = board({ 0x260: [220, 160], 0x261: [100, 80], 0x262: [2, 3], 0x264: [8, 6] });
    expect(await readCoilLimits(b.link)).toEqual([
      { ontimeUs: 220, duty: 0.1, minOntimeUs: 2, voices: 8 },
      { ontimeUs: 160, duty: 0.08, minOntimeUs: 3, voices: 6 },
    ]);
  });

  it('asks one parameter at a time on the wildcard, never a range', async () => {
    const b = board({});
    await readCoilLimits(b.link);
    expect(b.reads).toEqual([DevFrame.read(0x260, 0x7f), DevFrame.read(0x261, 0x7f), DevFrame.read(0x262, 0x7f), DevFrame.read(0x264, 0x7f), DevFrame.read(0x263, 0x7f)]);
  });

  it('leaves out what the board did not answer', async () => {
    expect(await readCoilLimits(board({ 0x260: [150] }).link)).toEqual([{ ontimeUs: 150 }]);
    expect(await readCoilLimits(board({}).link)).toEqual([]);
  });
});
