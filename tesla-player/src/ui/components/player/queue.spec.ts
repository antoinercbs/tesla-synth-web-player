import { describe, expect, it } from 'vitest';
import { emptyQueue, parseQueue, withoutSong, type QueueState } from './queue';

describe('play queue', () => {
  it('reads a stored queue back, and an empty one from anything that does not hold together', () => {
    const q: QueueState = { ids: [7, 3, 9], order: [2, 0, 1], pos: 1, repeat: 'all', shuffle: true };
    expect(parseQueue(JSON.stringify(q))).toEqual(q);
    expect(parseQueue(null)).toEqual(emptyQueue());
    expect(parseQueue('{oops')).toEqual(emptyQueue());
    // an order that isn't a permutation of the ids
    expect(parseQueue(JSON.stringify({ ...q, order: [0, 0, 1] })).ids).toEqual([]);
    // a position past the end
    expect(parseQueue(JSON.stringify({ ...q, pos: 5 })).pos).toBe(-1);
    // the settings stay even when the queue is empty
    expect(parseQueue(JSON.stringify({ ids: [], repeat: 'one', shuffle: true }))).toEqual({ ...emptyQueue(), repeat: 'one', shuffle: true });
  });

  it('drops a deleted song, the position following the song it was on', () => {
    const q: QueueState = { ids: [7, 3, 9], order: [2, 0, 1], pos: 2, repeat: 'off', shuffle: true };
    // playing 3 (ids[1], at order position 2); 9 goes (ids[2], at order position 0)
    expect(withoutSong(q, 9)).toEqual({ ...q, ids: [7, 3], order: [0, 1], pos: 1 });
    // the song playing goes: the next one takes its place, or the last one
    expect(withoutSong(q, 3)).toEqual({ ...q, ids: [7, 9], order: [1, 0], pos: 1 });
    expect(withoutSong({ ...q, ids: [5], order: [0], pos: 0 }, 5)).toEqual({ ...q, ids: [], order: [], pos: -1 });
    expect(withoutSong(q, 42)).toBe(q);
  });
});
