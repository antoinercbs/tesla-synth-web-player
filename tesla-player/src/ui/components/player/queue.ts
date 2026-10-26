/**
 * The Play page's queue as it is kept between visits: the songs by id, their
 * play order (positions into `ids`), where it is, repeat and shuffle. Read again
 * each time the page mounts (a reload, Live and back, the tour's demo swapping
 * its own in), so nothing is lost; never restarted by itself, only cued.
 */
export type Repeat = 'off' | 'all' | 'one';

export interface QueueState {
  ids: number[];
  order: number[];
  pos: number;
  repeat: Repeat;
  shuffle: boolean;
}

const QUEUE_KEY = 'playQueue';
export const GAP_KEY = 'queueGap';
/** The pauses offered between two songs, in seconds. */
export const GAPS = [0, 3, 5, 10, 20];

export function emptyQueue(): QueueState {
  return { ids: [], order: [], pos: -1, repeat: 'off', shuffle: false };
}

const isInt = (v: unknown): v is number => Number.isInteger(v);

/** A stored queue, or an empty one when what is stored doesn't hold together. */
export function parseQueue(raw: string | null): QueueState {
  try {
    const s = JSON.parse(raw ?? '') as Partial<QueueState>;
    const ids = Array.isArray(s.ids) ? s.ids.filter(isInt) : [];
    const order = Array.isArray(s.order) ? s.order.filter(isInt) : [];
    const sameSet = order.length === ids.length && [...order].sort((a, b) => a - b).every((v, i) => v === i);
    if (!ids.length || !sameSet) return { ...emptyQueue(), repeat: validRepeat(s.repeat), shuffle: s.shuffle === true };
    const pos = isInt(s.pos) && s.pos >= -1 && s.pos < order.length ? s.pos : -1;
    return { ids, order, pos, repeat: validRepeat(s.repeat), shuffle: s.shuffle === true };
  } catch {
    return emptyQueue();
  }
}

function validRepeat(v: unknown): Repeat {
  return v === 'all' || v === 'one' ? v : 'off';
}

export function loadQueue(): QueueState {
  try {
    return parseQueue(localStorage.getItem(QUEUE_KEY));
  } catch {
    return emptyQueue();
  }
}

export function saveQueue(s: QueueState): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(s));
  } catch { /* private window: the queue lasts the visit */ }
}

export function loadGap(): number {
  try {
    const v = Number(localStorage.getItem(GAP_KEY));
    return GAPS.includes(v) ? v : 0;
  } catch {
    return 0;
  }
}

/** A queue without the song `id` (deleted): the order closes up, the position follows its song. */
export function withoutSong(s: QueueState, id: number): QueueState {
  const qi = s.ids.indexOf(id);
  if (qi < 0) return s;
  const opos = s.order.indexOf(qi);
  const ids = s.ids.filter((_, i) => i !== qi);
  const order = s.order.filter((i) => i !== qi).map((i) => (i > qi ? i - 1 : i));
  let pos = s.pos;
  if (opos < pos) pos--;
  if (pos >= order.length) pos = order.length - 1;
  return { ...s, ids, order, pos: ids.length ? pos : -1 };
}

/** A song deleted from the library leaves the stored queue (the Play page isn't open then). */
export function forgetQueuedSong(id: number): void {
  const q = loadQueue();
  if (q.ids.includes(id)) saveQueue(withoutSong(q, id));
}
