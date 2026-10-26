import { onBeforeUnmount, ref, watch, type WatchSource } from 'vue';
import { SnapshotHistory } from '@/utils/history';

/**
 * Undo / redo over `state()`, as the user shapes it: a burst of typing or a drag
 * is one step, recorded once `source` has stayed put `pauseMs`. `apply` puts a
 * step back; `reset` forgets them all (another item loaded).
 */
export function useHistory<T>(state: () => T, apply: (s: T) => void, source: WatchSource | object, pauseMs = 400) {
  const history = new SnapshotHistory<T>(state());
  const canUndo = ref(false);
  const canRedo = ref(false);
  const sync = (): void => {
    canUndo.value = history.canUndo;
    canRedo.value = history.canRedo;
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stopTimer = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  function recordNow(): void {
    stopTimer();
    history.record(state());
    sync();
  }
  watch(source, () => {
    stopTimer();
    timer = setTimeout(recordNow, pauseMs);
  }, { deep: true });
  onBeforeUnmount(stopTimer);

  function reset(): void {
    stopTimer();
    history.reset(state());
    sync();
  }
  function undo(): void {
    recordNow();
    const s = history.undo();
    if (s) apply(s);
    sync();
  }
  function redo(): void {
    const s = history.redo();
    if (s) apply(s);
    sync();
  }
  return { canUndo, canRedo, undo, redo, reset };
}
