import { describe, expect, it } from 'vitest';
import { OWN_WAY, SongDraft } from './draft';
import { SONG_WIDE, type CoilConfig, type Song } from '@/model/domain';

const coil = (i: number, uuid: string, mask = 1 << i): CoilConfig => ({ coilIndex: i, coilUuid: uuid, channelMask: mask, ontimeUs: 50 + i, duty: 0.05 });

const song = (over: Partial<Song> = {}): Song => ({
  id: 7,
  name: 'Song',
  midiFile: null,
  coilCount: 2,
  mode: 'midi',
  output2Mask: 0,
  coils: [coil(0, 'a'), coil(1, 'b')],
  events: [
    { coilIndex: 1, atMs: 1000.4, param: 'ontime', value: 0.5 },
    { coilIndex: SONG_WIDE, atMs: 2000, param: 'power', value: 0.8, ramp: true },
  ],
  tags: [{ id: 3, name: 'rock', color: '#fff' }],
  stereo: { blend: 'fade', coils: [{ position: 0.2, reach: 0.4 }, { position: 0.8, reach: 0.4 }], channels: {} },
  variants: [{ id: 'v1', name: 'Solo', coilCount: 1, coils: [coil(0, 'c')], events: [] }],
  ...over,
});

function filled(s = song()): SongDraft {
  const d = new SongDraft();
  d.id = s.id;
  d.fill(s);
  return d;
}

describe('a song draft', () => {
  it('takes a saved song, its variants as its other ways', () => {
    const d = filled();
    expect(d.coilCount).toBe(2);
    expect(d.ways.map((w) => w.id)).toEqual([OWN_WAY, 'v1']);
    expect(d.payload()).toMatchObject({
      name: 'Song', coilCount: 2, mode: 'midi', tagIds: [3],
      events: [{ coilIndex: 1, atMs: 1000, param: 'ontime', value: 0.5 }, { coilIndex: SONG_WIDE, atMs: 2000, param: 'power', value: 0.8, ramp: true }],
      variants: [{ id: 'v1', name: 'Solo', coilCount: 1 }],
    });
  });

  it('pads or trims its places to the coil count', () => {
    const d = filled(song({ coilCount: 3 }));
    expect(d.coils.map((c) => c.channelMask)).toEqual([1, 2, 0]);
    d.coilCount = 1;
    d.fitCoils();
    expect(d.coils).toHaveLength(1);
  });

  it('keeps the way it leaves when it opens another', () => {
    const d = filled();
    d.coils[0].ontimeUs = 99;
    expect(d.switchTo(1)).toBe(true);
    expect(d.coilCount).toBe(1);
    expect(d.coils[0].coilUuid).toBe('c');
    expect(d.switchTo(1)).toBe(false);
    d.switchTo(0);
    expect(d.coils[0].ontimeUs).toBe(99);
  });

  it('drops a variant and goes back to the song\'s own coils', () => {
    const d = filled();
    expect(d.removeActive()).toBe(false);
    d.switchTo(1);
    expect(d.removeActive()).toBe(true);
    expect(d.ways.map((w) => w.id)).toEqual([OWN_WAY]);
    expect(d.coilCount).toBe(2);
  });

  it('declines a way onto other coils, carrying the settings when every place is kept', () => {
    const d = filled();
    const made = d.decline(['x', 'y'], [], 'v2', (src, uuids) => {
      expect(uuids).toEqual(['x', 'y']);
      return src.map((c) => ({ ontimeUs: c.ontimeUs * 2, duty: c.duty }));
    });
    expect(made).toEqual({ dropped: false });
    expect(d.active).toBe(2);
    expect(d.coils.map((c) => [c.coilUuid, c.ontimeUs])).toEqual([['x', 100], ['y', 102]]);
    expect(d.stereo?.coils).toHaveLength(2);
  });

  it('declines with a place left out: its automation goes, the song-wide one stays', () => {
    const d = filled();
    const made = d.decline([null, 'y'], [], 'v2', () => { throw new Error('not carried'); });
    expect(made).toEqual({ dropped: true });
    expect(d.coils).toEqual([{ ...coil(1, 'y'), coilIndex: 0 }]);
    expect(d.events.map((e) => e.coilIndex)).toEqual([0, SONG_WIDE]);
    expect(d.decline([null, null], [], 'v3', null)).toBeNull();
  });

  it('adds and removes places as coils are ticked', () => {
    const d = filled();
    expect(d.toggleCoil('z', ['a', 'b'])).toEqual({ added: 2 });
    expect(d.coilCount).toBe(3);
    expect(d.toggleCoil('a', ['a', 'b', 'z'])).toEqual({ removed: 0 });
    expect(d.coils.map((c) => [c.coilIndex, c.coilUuid])).toEqual([[0, 'b'], [1, 'z']]);
    expect(d.events.find((e) => e.coilIndex !== SONG_WIDE)?.coilIndex).toBe(0);
    expect(d.stereo?.coils).toHaveLength(1);
  });

  it('starts a new song on the coils picked', () => {
    const d = filled();
    d.reset(3, ['p', 'q']);
    expect(d.id).toBeNull();
    expect(d.coils.map((c) => c.coilUuid)).toEqual(['p', 'q']);
    d.reset(3, []);
    expect(d.coilCount).toBe(3);
  });

  it('gives back a state it handed out', () => {
    const d = filled();
    const before = JSON.parse(JSON.stringify(d.state()));
    d.name = 'Other';
    d.toggleCoil('z', ['a', 'b']);
    d.restore(JSON.parse(JSON.stringify(before)));
    expect(d.snapshot()).toBe(filled().snapshot());
  });

  it('hands the player the song without what is muted', () => {
    const d = filled(song({ output2Mask: 0b11 }));
    const s = d.forPlayer({ id: 1, name: 'f.mid', path: '/f.mid', hash: 'h' } as Song['midiFile'], 'blob:x', 0b01, 0b10);
    expect(s.midiFile?.path).toBe('blob:x');
    expect(s.output2Mask).toBe(0b10);
    expect(s.coils.map((c) => c.channelMask)).toEqual([0, 0]);
  });

  it('tells a song just made from its file', () => {
    expect(SongDraft.fresh(song())).toBe(false);
    expect(SongDraft.fresh(song({ coils: [{ ...coil(0, 'a'), channelMask: 0 }] }))).toBe(true);
  });
});
