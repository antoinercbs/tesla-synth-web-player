/**
 * Undo / redo over snapshots of a state (JSON-able). `record` takes the state
 * as it is now: a new step when it changed, nothing when it didn't (a state
 * put back by `undo` records as no change). The caller decides how often to
 * record: after a pause in typing, at the end of a drag.
 */
export class SnapshotHistory<T> {
  private past: string[] = [];
  private future: string[] = [];
  private current: string;

  constructor(initial: T, private readonly limit = 100) {
    this.current = JSON.stringify(initial);
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  record(state: T): void {
    const s = JSON.stringify(state);
    if (s === this.current) return;
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.current = s;
  }

  undo(): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(this.current);
    this.current = prev;
    return JSON.parse(prev) as T;
  }

  redo(): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.current);
    this.current = next;
    return JSON.parse(next) as T;
  }

  /** Forget every step: another item is loaded, or what was there is saved over. */
  reset(state: T): void {
    this.past = [];
    this.future = [];
    this.current = JSON.stringify(state);
  }
}
