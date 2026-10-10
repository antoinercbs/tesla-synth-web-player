import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { clearLatch } from '@/devices/board-watch';
import { useMidiStore } from '@/stores/midi';
import { notify } from '@/utils/toast';

/** Re-arming the board after its protection tripped, behind a confirmation. */
export function useClearLatch() {
  const midiStore = useMidiStore();
  const { t } = useI18n();
  const asking = ref(false);
  const busy = ref(false);

  async function confirm(): Promise<void> {
    asking.value = false;
    const link = midiStore.deviceLink;
    if (!link || busy.value) return;
    busy.value = true;
    try {
      const result = await clearLatch(link);
      if (result === 'cleared') notify('board.cleared');
      else if (result === 'silent') notify('board.clearSilent', 'error');
      else {
        // its reply reached the board monitor too: the store knows which coils still cut
        const coils = (midiStore.boardStatus?.blockingCoils ?? []).map(
          (i) => midiStore.coilName(i) || t('board.coilN', { n: i }),
        );
        notify(t('board.blocking', { coils: coils.join(', ') }), 'error');
      }
    } finally {
      busy.value = false;
    }
  }

  return {
    asking,
    busy,
    ask: (): void => { asking.value = true; },
    cancel: (): void => { asking.value = false; },
    confirm,
  };
}
