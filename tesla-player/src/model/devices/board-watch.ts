import type { BoardStatus } from '@/model/sysex/board';
import type { DeviceLink } from '@/model/devices/device-link';
import { DevBoardCommands } from '@/model/sysex/board-commands';
import { DevBoardStatus } from '@/model/sysex/board';

export interface BoardWatcher {
  status(status: BoardStatus, previous: BoardStatus | null): void;
  /** Trips per coil since the board started, read when its protection trips. */
  trips(trips: number[]): void;
  silent(silent: boolean): void;
}

export type ClearLatchResult = 'cleared' | 'blocking' | 'silent';

/**
 * Follows the board's status on a link, from its making until stop(): subscribes
 * to its status events and repeats the subscription as a heartbeat. Only a board
 * that answered once can go silent: one that never does has no way back (a MIDI
 * interface to its DIN input), which is no fault. stop() unsubscribes: the board
 * cannot see a MIDI port close.
 */
export class DevBoardWatch {
  /** Each subscription brings the status back at once: repeated, it shows the board still answers. */
  static readonly HEARTBEAT_MS = 10_000;
  /** Without any status for this long, the board is said not to answer. */
  static readonly SILENT_AFTER_MS = 25_000;

  private last: BoardStatus | null = null;
  private seenAt: number;
  private silent = false;
  private readonly off: () => void;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly page = typeof window === 'undefined' ? null : window;

  constructor(private readonly link: DeviceLink, w: BoardWatcher, private readonly now: () => number = Date.now) {
    this.seenAt = now();
    this.off = link.onParam((f) => {
      if (f.pnFull !== DevBoardCommands.PN.STATUS) return;
      this.seenAt = this.now();
      if (this.silent) {
        this.silent = false;
        w.silent(false);
      }
      const status = DevBoardStatus.decode(f.valueInt);
      const previous = this.last;
      this.last = status;
      w.status(status, previous);
      if (status.latched && !previous?.latched) void DevBoardWatch.readTrips(link).then((t) => w.trips(t));
    });
    this.subscribe();
    this.timer = setInterval(() => {
      if (this.last && !this.silent && this.now() - this.seenAt > DevBoardWatch.SILENT_AFTER_MS) {
        this.silent = true;
        w.silent(true);
      }
      this.subscribe();
    }, DevBoardWatch.HEARTBEAT_MS);
    this.page?.addEventListener('pagehide', this.unsubscribe);
  }

  /** Trips per coil since the board started. */
  static async readTrips(link: DeviceLink): Promise<number[]> {
    const trips: number[] = [];
    for (const f of await link.read(DevBoardCommands.PN.TRIPS, 0x7f)) {
      if (f.pnFull === DevBoardCommands.PN.TRIPS) trips[f.target & 0x7f] = f.valueInt;
    }
    return Array.from(trips, (n) => n ?? 0);
  }

  /**
   * Asks the board to clear its protection latch, then reads whether it did:
   * it refuses while a coil's protection still cuts (`blocking`).
   */
  static async clearLatch(link: DeviceLink): Promise<ClearLatchResult> {
    link.send(DevBoardCommands.clearLatch());
    const reply = (await link.read(DevBoardCommands.PN.STATUS, 0)).find((f) => f.pnFull === DevBoardCommands.PN.STATUS);
    if (!reply) return 'silent';
    return DevBoardStatus.decode(reply.valueInt).latched ? 'blocking' : 'cleared';
  }

  stop(): void {
    clearInterval(this.timer);
    this.off();
    this.page?.removeEventListener('pagehide', this.unsubscribe);
    this.unsubscribe();
  }

  private subscribe(): void {
    this.link.send(DevBoardCommands.statusEvents(true));
  }

  private readonly unsubscribe = (): void => {
    try {
      this.link.send(DevBoardCommands.statusEvents(false));
    } catch {
      /* gone with its device */
    }
  };
}
