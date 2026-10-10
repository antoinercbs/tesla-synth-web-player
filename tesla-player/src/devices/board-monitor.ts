import { watch } from 'vue';
import { watchBoard } from '@/devices/board-watch';
import { boardState } from '@/sysex/board';
import { useMidiStore } from '@/stores/midi';
import { notify } from '@/utils/toast';

/**
 * Keeps the store's board status for as long as the app runs: on every link
 * to a board that reports one. A trip stops everything that plays.
 */
export function startBoardMonitor(): void {
  const store = useMidiStore();
  let stop: (() => void) | null = null;
  watch(
    () => [store.deviceLink, store.deviceProfile.features.boardStatus] as const,
    ([link, reports]) => {
      stop?.();
      stop = null;
      store.setBoardStatus(null);
      store.setBoardTrips([]);
      store.setBoardSilent(false);
      if (!link || !reports) return;
      stop = watchBoard(link, {
        status(status, previous) {
          store.setBoardStatus(status);
          if (status.latched && !previous?.latched) {
            store.panic();
            notify('board.tripToast', 'error');
          } else if (previous) {
            const was = boardState(previous);
            const is = boardState(status);
            if (is === 'stop' && was !== 'stop') notify('board.stopToast', 'info');
            else if (was === 'stop' && is !== 'stop') notify('board.runToast');
          }
        },
        trips: (trips) => store.setBoardTrips(trips),
        silent: (silent) => store.setBoardSilent(silent),
      });
    },
    { immediate: true },
  );
}
