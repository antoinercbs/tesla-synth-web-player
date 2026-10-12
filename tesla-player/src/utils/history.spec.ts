import { describe, expect, it } from 'vitest';
import { SnapshotHistory } from './history';

describe('snapshot history', () => {
  it('undoes and redoes the recorded steps, in order', () => {
    const h = new SnapshotHistory({ n: 0 });
    h.record({ n: 1 });
    h.record({ n: 2 });
    expect(h.undo()).toEqual({ n: 1 });
    expect(h.undo()).toEqual({ n: 0 });
    expect(h.undo()).toBeNull();
    expect(h.redo()).toEqual({ n: 1 });
    expect(h.canRedo).toBe(true);
  });

  it('records nothing when nothing changed, a state put back included', () => {
    const h = new SnapshotHistory({ n: 0 });
    h.record({ n: 0 });
    expect(h.canUndo).toBe(false);
    h.record({ n: 1 });
    const back = h.undo()!;
    h.record(back); // the editor's watcher seeing what undo wrote
    expect(h.canRedo).toBe(true);
  });

  it('drops the redo steps on a new change, and the oldest past the limit', () => {
    const h = new SnapshotHistory({ n: 0 }, 2);
    h.record({ n: 1 });
    h.record({ n: 2 });
    h.record({ n: 3 });
    expect(h.undo()).toEqual({ n: 2 });
    h.record({ n: 9 });
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toEqual({ n: 2 });
    expect(h.undo()).toEqual({ n: 1 });
    expect(h.undo()).toBeNull();
  });

  it('starts over on reset', () => {
    const h = new SnapshotHistory({ n: 0 });
    h.record({ n: 1 });
    h.reset({ n: 5 });
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });
});
