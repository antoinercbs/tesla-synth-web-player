import type { BoardStatus } from '@/model/sysex/board';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { DevBoardWatch, type BoardWatcher } from '@/model/devices/board-watch';
import type { DeviceLink } from '@/model/devices/device-link';
import { DevBoardCommands } from '@/model/sysex/board-commands';
import { DevFrame } from '@/model/sysex/frame';

const OK = 0x5e;
const LATCHED_COIL_1 = 0x01 | 0x5c | (0b0010 << 8);

/** A board on the other end of a link: it answers GETs and pushes what it is told to. */
function fakeBoard() {
  const listeners = new Set<(f: DevFrame) => void>();
  const sent: DevFrame[] = [];
  let status = OK;
  const trips = [0, 3, 0, 0];
  const frame = (pn: number, value: number, target = 0) => DevFrame.decode(DevFrame.command({ pn, value, target }));
  const push = (f: DevFrame) => { for (const l of listeners) l(f); };
  const link: DeviceLink = {
    name: 'board',
    send: (data) => sent.push(DevFrame.decode(data)),
    onParam: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    read: async (pn) => {
      const replies = pn === DevBoardCommands.PN.TRIPS
        ? trips.map((n, coil) => frame(pn, n, coil))
        : pn === DevBoardCommands.PN.STATUS ? [frame(pn, status)] : [];
      replies.forEach(push); // a link hands every reply to its listeners too
      return replies;
    },
  };
  return {
    link,
    sent,
    listeners,
    setStatus(value: number) { status = value; },
    event(value: number) { status = value; push(frame(DevBoardCommands.PN.STATUS, value)); },
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

const subscriptions = (sent: DevFrame[]) => sent.filter((f) => f.pnFull === DevBoardCommands.PN.EVENTS);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('following the board', () => {
  it('subscribes at once and repeats it as a heartbeat', () => {
    const b = fakeBoard();
    const watching = new DevBoardWatch(b.link, recorder().w);
    expect(subscriptions(b.sent).map((f) => f.valueInt)).toEqual([1]);
    vi.advanceTimersByTime(DevBoardWatch.HEARTBEAT_MS * 3);
    expect(subscriptions(b.sent)).toHaveLength(4);
    watching.stop();
  });

  it('unsubscribes when it stops, and listens no more', () => {
    const b = fakeBoard();
    const watching = new DevBoardWatch(b.link, recorder().w);
    watching.stop();
    expect(subscriptions(b.sent).at(-1)?.valueInt).toBe(0);
    expect(b.listeners.size).toBe(0);
    vi.advanceTimersByTime(DevBoardWatch.HEARTBEAT_MS * 2);
    expect(subscriptions(b.sent)).toHaveLength(2);
  });

  it('passes each status on with the one before', () => {
    const b = fakeBoard();
    const r = recorder();
    new DevBoardWatch(b.link, r.w);
    b.event(OK);
    b.event(OK | 0x01);
    expect(r.statuses.map(([s, p]) => [s.latched, p?.latched ?? null])).toEqual([[false, null], [true, false]]);
  });

  it('reads the trips when the protection trips, once', async () => {
    const b = fakeBoard();
    const r = recorder();
    new DevBoardWatch(b.link, r.w);
    b.event(LATCHED_COIL_1);
    b.event(LATCHED_COIL_1);
    await vi.advanceTimersByTimeAsync(1);
    expect(r.trips).toEqual([[0, 3, 0, 0]]);
  });

  it('says the board went silent, and when it is back', () => {
    let now = 0;
    const b = fakeBoard();
    const r = recorder();
    new DevBoardWatch(b.link, r.w, () => now);
    b.event(OK);
    now = DevBoardWatch.SILENT_AFTER_MS - 1;
    vi.advanceTimersByTime(DevBoardWatch.HEARTBEAT_MS);
    expect(r.silent).toEqual([]);
    now = DevBoardWatch.SILENT_AFTER_MS + DevBoardWatch.HEARTBEAT_MS;
    vi.advanceTimersByTime(DevBoardWatch.HEARTBEAT_MS);
    expect(r.silent).toEqual([true]);
    b.event(OK);
    expect(r.silent).toEqual([true, false]);
  });

  it('never calls silent a board that never answered (no way back from its MIDI input)', () => {
    let now = 0;
    const b = fakeBoard();
    const r = recorder();
    new DevBoardWatch(b.link, r.w, () => now);
    now = DevBoardWatch.SILENT_AFTER_MS * 4;
    vi.advanceTimersByTime(DevBoardWatch.HEARTBEAT_MS * 4);
    expect(r.silent).toEqual([]);
    expect(r.statuses).toEqual([]);
  });

  it('ignores the frames that are not its status', () => {
    const b = fakeBoard();
    const r = recorder();
    new DevBoardWatch(b.link, r.w);
    for (const l of b.listeners) l(DevFrame.decode(DevFrame.command({ pn: 0x260, value: 120 })));
    expect(r.statuses).toEqual([]);
  });
});

describe('re-arming', () => {
  it('sends the magic word and says whether the latch is gone', async () => {
    const b = fakeBoard();
    b.setStatus(OK);
    const result = DevBoardWatch.clearLatch(b.link);
    expect(b.sent.at(-1)).toMatchObject({ pnFull: DevBoardCommands.PN.CLEAR_LATCH, valueInt: 0x434c5221 });
    expect(await result).toBe('cleared');
  });

  it('says so when a coil still cuts, or when the board does not answer', async () => {
    const b = fakeBoard();
    b.setStatus(LATCHED_COIL_1 | (0b0010 << 16));
    expect(await DevBoardWatch.clearLatch(b.link)).toBe('blocking');
    const mute: DeviceLink = { ...b.link, read: async () => [] };
    expect(await DevBoardWatch.clearLatch(mute)).toBe('silent');
  });
});
