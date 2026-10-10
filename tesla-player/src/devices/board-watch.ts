import type { DeviceLink } from '@/serial/device-link';
import {
  BOARD_PN,
  clearLatchFrame,
  decodeBoardStatus,
  statusEvents,
  type BoardStatus,
} from '@/sysex/board';

/** Each subscription brings the status back at once: repeated, it shows the board still answers. */
export const HEARTBEAT_MS = 10_000;
/** Without any status for this long, the board is said not to answer. */
export const SILENT_AFTER_MS = 25_000;

export interface BoardWatcher {
  status(status: BoardStatus, previous: BoardStatus | null): void;
  /** Trips per coil since the board started, read when its protection trips. */
  trips(trips: number[]): void;
  silent(silent: boolean): void;
}

/** Trips per coil since the board started. */
export async function readTrips(link: DeviceLink): Promise<number[]> {
  const trips: number[] = [];
  for (const f of await link.read(BOARD_PN.TRIPS, 0x7f)) {
    if (f.pnFull === BOARD_PN.TRIPS) trips[f.target & 0x7f] = f.valueInt;
  }
  return Array.from(trips, (n) => n ?? 0);
}

/**
 * Follows the board's status on `link`: subscribes to its status events and
 * repeats the subscription as a heartbeat. Only a board that answered once can
 * go silent: one that never does has no way back (a MIDI interface to its DIN
 * input), which is no fault. Returns the way to stop, which unsubscribes: the
 * board cannot see a MIDI port close.
 */
export function watchBoard(link: DeviceLink, w: BoardWatcher, now: () => number = Date.now): () => void {
  let last: BoardStatus | null = null;
  let seenAt = now();
  let silent = false;
  const off = link.onParam((f) => {
    if (f.pnFull !== BOARD_PN.STATUS) return;
    seenAt = now();
    if (silent) {
      silent = false;
      w.silent(false);
    }
    const status = decodeBoardStatus(f.valueInt);
    const previous = last;
    last = status;
    w.status(status, previous);
    if (status.latched && !previous?.latched) void readTrips(link).then((t) => w.trips(t));
  });
  const subscribe = (): void => link.send(statusEvents(true));
  const unsubscribe = (): void => {
    try {
      link.send(statusEvents(false));
    } catch {
      /* gone with its device */
    }
  };
  subscribe();
  const timer = setInterval(() => {
    if (last && !silent && now() - seenAt > SILENT_AFTER_MS) {
      silent = true;
      w.silent(true);
    }
    subscribe();
  }, HEARTBEAT_MS);
  const page = typeof window === 'undefined' ? null : window;
  page?.addEventListener('pagehide', unsubscribe);
  return () => {
    clearInterval(timer);
    off();
    page?.removeEventListener('pagehide', unsubscribe);
    unsubscribe();
  };
}

export type ClearLatchResult = 'cleared' | 'blocking' | 'silent';

/**
 * Asks the board to clear its protection latch, then reads whether it did:
 * it refuses while a coil's protection still cuts (`blocking`).
 */
export async function clearLatch(link: DeviceLink): Promise<ClearLatchResult> {
  link.send(clearLatchFrame());
  const reply = (await link.read(BOARD_PN.STATUS, 0)).find((f) => f.pnFull === BOARD_PN.STATUS);
  if (!reply) return 'silent';
  return decodeBoardStatus(reply.valueInt).latched ? 'blocking' : 'cleared';
}
