import { watch } from 'vue';
import { DevBoardWatch } from '@/model/devices/board-watch';
import { readCoilLimits } from '@/engine/devices/coil-limits';
import { DevBoardStatus } from '@/model/sysex/board';
import { useMidiStore } from '@/app/stores/midi';
import { boardCheck } from '@/app/board-check';
import { notify } from '@/ui/helpers/toast';

/**
 * Keeps the store's board status for as long as the app runs: on every link
 * to a board that reports one. A trip stops everything that plays. Reads the
 * coils' limits on every link too.
 */
export function startBoardMonitor(): void {
  const store = useMidiStore();
  boardCheck.start();
  let watching: DevBoardWatch | null = null;
  watch(
    () => [store.deviceLink, store.deviceProfile.features.boardStatus] as const,
    ([link, reports]) => {
      watching?.stop();
      watching = null;
      store.setBoardStatus(null);
      store.setBoardTrips([]);
      store.setBoardSilent(false);
      if (!link || !reports) return;
      watching = new DevBoardWatch(link, {
        status(status, previous) {
          store.setBoardStatus(status);
          if (status.latched && !previous?.latched) {
            store.panic();
            notify('board.tripToast', 'error');
          } else if (previous) {
            const was = new DevBoardStatus(previous).state;
            const is = new DevBoardStatus(status).state;
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
  // the coils' own limits, for the real ontime the editors and the player show;
  // the settings page keeps them in step when it reads or applies them
  watch(
    () => store.deviceLink,
    (link) => {
      store.setCoilLimits([]);
      if (!link) return;
      void readCoilLimits(link)
        .then((limits) => {
          if (store.deviceLink === link) store.setCoilLimits(limits);
        })
        .catch((err) => console.error('Coil limits read failed', err));
    },
    { immediate: true },
  );
}
