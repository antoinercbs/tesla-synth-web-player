import { describe, expect, it } from 'vitest';
import { PhyStage } from '@/model/coils/stage';
import { PhySpec } from '@/model/coils/spec';
import type { TeslaCoil } from './inventory';
import { SONG_WIDE, type Song } from '@/model/domain';

const coil = (uuid: string, position: number): TeslaCoil => ({
  id: position + 1, uuid, name: uuid.toUpperCase(), position, spec: { preset: 'petite' }, twinGroup: null, notes: null, updatedAt: null, editorName: null,
});
const inventory = [coil('a', 0), coil('b', 1), coil('c', 2)];
const song = (more: Partial<Song> = {}): Song => ({
  id: 1, name: 'x', midiFile: null, coilCount: 2, mode: 'midi', output2Mask: 0,
  coils: [
    { coilIndex: 0, channelMask: 1, ontimeUs: 40, duty: 0.05 },
    { coilIndex: 1, channelMask: 2, ontimeUs: 50, duty: 0.05 },
  ],
  events: [
    { coilIndex: 1, atMs: 1000, param: 'ontime', value: 0.5 },
    { coilIndex: SONG_WIDE, atMs: 0, param: 'power', value: 1 },
  ],
  stereo: { blend: 'fade', coils: [{ position: 0, reach: 0.5 }, { position: 1, reach: 0.5 }], channels: {} },
  ...more,
});

describe('a song on stage', () => {
  it('takes the inventory coil of a place without its own', () => {
    expect(new PhyStage(inventory).placeCoil(song().coils, 1)?.uuid).toBe('b');
    const own = song({ coils: [{ coilIndex: 0, coilUuid: 'c', channelMask: 1, ontimeUs: 40, duty: 0.05 }], coilCount: 1 });
    expect(new PhyStage(inventory).placeCoil(own.coils, 0)?.uuid).toBe('c');
  });

  it('plays each place on its coil output, its automation and its stage spot with it', () => {
    // b is on output 4, a on output 0
    const wiring = ['a', '', '', '', 'b'];
    const { song: s, missing } = new PhyStage(inventory).onStage(song(), (u) => wiring.indexOf(u));
    expect(missing).toEqual([]);
    expect(s.coils.map((c) => [c.coilIndex, c.channelMask])).toEqual([[0, 1], [4, 2]]);
    expect(s.coilCount).toBe(5);
    expect(s.events?.find((e) => e.param === 'ontime')?.coilIndex).toBe(4);
    expect(s.events?.find((e) => e.param === 'power')?.coilIndex).toBe(SONG_WIDE);
    expect(s.stereo?.coils[4]).toEqual({ position: 1, reach: 0.5 });
    expect(s.stereo?.coils[1]).toBeUndefined();
  });

  it('leaves out a place whose coil is on no output, and says so', () => {
    const { song: s, missing } = new PhyStage(inventory).onStage(song(), (u) => ['a'].indexOf(u));
    expect(s.coils.map((c) => c.coilIndex)).toEqual([0]);
    expect(missing).toEqual([{ place: 1, coil: inventory[1] }]);
    expect(s.events?.some((e) => e.param === 'ontime')).toBe(false);
  });

  it('keeps the song as it is without an inventory', () => {
    const s = song();
    expect(new PhyStage([]).onStage(s, () => -1).song).toBe(s);
  });

  it('sets the board to the sheet', () => {
    expect(new PhySpec(PhySpec.PRESETS.grande).limits).toEqual({ ontimeUs: 200, duty: 0.05, minOntimeUs: 2, voices: 8 });
  });

  it("leaves the board's min offtime alone unless the sheet sets it", () => {
    expect(new PhySpec(PhySpec.PRESETS.grande).boardSettings).not.toHaveProperty('minOfftimeUs');
    const spec = { ...PhySpec.PRESETS.grande, board: { ...PhySpec.PRESETS.grande.board, minOfftime: 40 } };
    expect(new PhySpec(spec).boardSettings.minOfftimeUs).toBe(40);
  });
});

describe('twins and variants', () => {
  // a and b are twins (the two small coils), c the big one
  const twin = (uuid: string, position: number, group: string | null): TeslaCoil => ({ ...coil(uuid, position), twinGroup: group });
  const inv = [twin('a', 0, 'small'), twin('b', 1, 'small'), twin('c', 2, null)];
  const own = (uuids: string[]): Song => song({
    coilCount: uuids.length,
    coils: uuids.map((u, k) => ({ coilIndex: k, coilUuid: u, channelMask: 1 << k, ontimeUs: 40, duty: 0.05 })),
    events: [], stereo: null,
  });

  it('plays a coil off stage on its twin, and says so', () => {
    const { song: s, missing, twins } = new PhyStage(inv).onStage(own(['a']), (u) => ['b'].indexOf(u));
    expect(missing).toEqual([]);
    expect(s.coils.map((c) => c.coilIndex)).toEqual([0]);
    expect(twins).toEqual([{ place: 0, coil: inv[0], twin: inv[1] }]);
  });

  it('never gives a twin already playing its own coil', () => {
    const { missing, twins } = new PhyStage(inv).onStage(own(['a', 'b']), (u) => ['b'].indexOf(u));
    expect(twins).toEqual([]);
    expect(missing.map((m) => m.coil?.uuid)).toEqual(['a']);
  });

  it('plays the way that fits the stage, the one with the most coils first', () => {
    const s = {
      ...own(['a', 'c']),
      variants: [{ id: 'v1', name: '', coilCount: 1, coils: [{ coilIndex: 0, coilUuid: 'a', channelMask: 3, ontimeUs: 60, duty: 0.08 }] }],
    };
    // everything on stage: its own coils, a and c
    expect(new PhyStage(inv).chooseWay(s, (u) => ['a', 'c'].indexOf(u)).variant).toBeNull();
    // only a small coil: the variant, on a twin
    const chosen = new PhyStage(inv).chooseWay(s, (u) => ['b'].indexOf(u));
    expect(chosen.variant?.id).toBe('v1');
    expect(chosen.fits).toBe(true);
    expect(chosen.song.coils[0].ontimeUs).toBe(60);
    // nothing fits: the way with the most coils on stage
    expect(new PhyStage(inv).chooseWay(s, (u) => ['c'].indexOf(u))).toMatchObject({ variant: null, fits: false });
    expect(new PhyStage(inv).fits(s, ['b'])).toBe(true);
    expect(new PhyStage(inv).fits(s, ['c'])).toBe(false);
  });

  it('names a way after its coils unless it has a name', () => {
    expect(new PhyStage(inv).wayName(own(['a', 'c']).coils, '')).toBe('A + C');
    expect(new PhyStage(inv).wayName(own(['a']).coils, ' Solo ')).toBe('Solo');
  });
});
