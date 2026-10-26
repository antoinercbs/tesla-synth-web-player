import { onBeforeUnmount, onMounted, watch } from 'vue';

interface Sentinel {
  release(): Promise<void>;
  addEventListener?(type: 'release', cb: () => void): void;
}
type WakeLockNavigator = Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } };

/**
 * Keeps the screen on while `active()` holds: a camera filming the coil, a
 * song playing, the Play page on stage. The browser drops the lock whenever the
 * tab is hidden; it is taken again when the tab comes back. A browser without
 * the API just lets the screen sleep.
 */
export function useWakeLock(active: () => boolean): void {
  let lock: Sentinel | null = null;
  let wanted = false;

  async function acquire(): Promise<void> {
    if (lock || document.visibilityState !== 'visible') return;
    try {
      const got = (await (navigator as WakeLockNavigator).wakeLock?.request('screen')) ?? null;
      // released (or unwanted) while the request was on its way
      if (!wanted) { void got?.release(); return; }
      lock = got;
      lock?.addEventListener?.('release', () => { lock = null; });
    } catch {
      lock = null;
    }
  }
  function release(): void {
    void lock?.release();
    lock = null;
  }
  const onVisibility = (): void => { if (wanted) void acquire(); };

  watch(active, (on) => {
    wanted = on;
    if (on) void acquire();
    else release();
  }, { immediate: true });
  onMounted(() => document.addEventListener('visibilitychange', onVisibility));
  onBeforeUnmount(() => {
    wanted = false;
    document.removeEventListener('visibilitychange', onVisibility);
    release();
  });
}
