import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { HEARTBEAT_MS, SILENT_AFTER_MS, clearLatch, watchBoard, type BoardWatcher } from './board-watch';
import type { DeviceLink } from '@/serial/device-link';
import { buildCommand, decodeFrame, type DecodedFrame } from '@/sysex/syntherrupter';
import { BOARD_PN, type BoardStatus } from '@/sysex/board';

const OK = 0x5e;
const LATCHED_COIL_1 = 0x01 | 0x5c | (0b0010 << 8);

/** A board on the other end of a link: it answers GETs and pushes what it is told to. */
function fakeBoard() {
  const listeners = new Set<(f: DecodedFrame) => void>();
  const sent: DecodedFrame[] = [];
  let status = OK;
  const trips = [0, 3, 0, 0];
  const frame = (pn: number, value: number, target = 0) => decodeFrame(buildCommand({ pn, value, target }));
  const push = (f: DecodedFrame) => { for (const l of listeners) l(f); };
  const link: DeviceLink = {
    name: 'board',
    send: (data) => sent.push(decodeFrame(data)),
    onParam: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    read: async (pn) => {
      const replies = pn === BOARD_PN.TRIPS
        ? trips.map((n, coil) => frame(pn, n, coil))
        : pn === BOARD_PN.STATUS ? [frame(pn, status)] : [];
      replies.forEach(push); // a link hands every reply to its listeners too
      return replies;
    },
  };
  return {
    link,
    sent,
    listeners,
    setStatus(value: number) { status = value; },
    event(value: number) { status = value; push(frame(BOARD_PN.STATUS, value)); },
  };
}

function recorder() {
  const statuses: [BoardStatus, BoardStatus | null][] = [];
  const trips: number[][] = [];
  const silent: boolean[] = [];
  const w: BoardWatcher = {
    status: (s, p) => statuses.push([s, p]),
    trips: (t) => trips.push(t),
    silent: (b) => silent.push(b),
  };
  return { w, statuses, trips, silent };
}

const subscriptions = (sent: DecodedFrame[]) => sent.filter((f) => f.pnFull === BOARD_PN.EVENTS);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('following the board', () => {
  it('subscribes at once and repeats it as a heartbeat', () => {
    const b = fakeBoard();
    const stop = watchBoard(b.link, recorder().w);
    expect(subscriptions(b.sent).map((f) => f.valueInt)).toEqual([1]);
    vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    expect(subscriptions(b.sent)).toHaveLength(4);
    stop();
  });

  it('unsubscribes when it stops, and listens no more', () => {
    const b = fakeBoard();
    const stop = watchBoard(b.link, recorder().w);
    stop();
    expect(subscriptions(b.sent).at(-1)?.valueInt).toBe(0);
    expect(b.listeners.size).toBe(0);
    vi.advanceTimersByTime(HEARTBEAT_MS * 2);
    expect(subscriptions(b.sent)).toHaveLength(2);
  });

  it('passes each status on with the one before', () => {
    const b = fakeBoard();
    const r = recorder();
    watchBoard(b.link, r.w);
    b.event(OK);
    b.event(OK | 0x01);
    expect(r.statuses.map(([s, p]) => [s.latched, p?.latched ?? null])).toEqual([[false, null], [true, false]]);
  });

  it('reads the trips when the protection trips, once', async () => {
    const b = fakeBoard();
    const r = recorder();
    watchBoard(b.link, r.w);
    b.event(LATCHED_COIL_1);
    b.event(LATCHED_COIL_1);
    await vi.advanceTimersByTimeAsync(1);
    expect(r.trips).toEqual([[0, 3, 0, 0]]);
  });

  it('says the board went silent, and when it is back', () => {
    let now = 0;
    const b = fakeBoard();
    const r = recorder();
    watchBoard(b.link, r.w, () => now);
    b.event(OK);
    now = SILENT_AFTER_MS - 1;
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(r.silent).toEqual([]);
    now = SILENT_AFTER_MS + HEARTBEAT_MS;
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(r.silent).toEqual([true]);
    b.event(OK);
    expect(r.silent).toEqual([true, false]);
  });

  it('never calls silent a board that never answered (no way back from its MIDI input)', () => {
    let now = 0;
    const b = fakeBoard();
    const r = recorder();
    watchBoard(b.link, r.w, () => now);
    now = SILENT_AFTER_MS * 4;
    vi.advanceTimersByTime(HEARTBEAT_MS * 4);
    expect(r.silent).toEqual([]);
    expect(r.statuses).toEqual([]);
  });

  it('ignores the frames that are not its status', () => {
    const b = fakeBoard();
    const r = recorder();
    watchBoard(b.link, r.w);
    for (const l of b.listeners) l(decodeFrame(buildCommand({ pn: 0x260, value: 120 })));
    expect(r.statuses).toEqual([]);
  });
});

describe('re-arming', () => {
  it('sends the magic word and says whether the latch is gone', async () => {
    const b = fakeBoard();
    b.setStatus(OK);
    const result = clearLatch(b.link);
    expect(b.sent.at(-1)).toMatchObject({ pnFull: BOARD_PN.CLEAR_LATCH, valueInt: 0x434c5221 });
    expect(await result).toBe('cleared');
  });

  it('says so when a coil still cuts, or when the board does not answer', async () => {
    const b = fakeBoard();
    b.setStatus(LATCHED_COIL_1 | (0b0010 << 16));
    expect(await clearLatch(b.link)).toBe('blocking');
    const mute: DeviceLink = { ...b.link, read: async () => [] };
    expect(await clearLatch(mute)).toBe('silent');
  });
});
