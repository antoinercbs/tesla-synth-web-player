import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';

/**
 * Keeps the user on a page holding what leaving it would lose: unsaved edits, a
 * song playing, coils running, a tuning session. A navigation inside the app
 * waits for the page's own ConfirmModal (open while `pending`, closed by
 * `answer`); closing or reloading the tab gets the browser's prompt (on the
 * desktop app, the dialog of electron/src/main.ts: without it the window
 * would silently refuse to close).
 *
 * The router's guards never see a page taken down where it stands (the Play
 * page's mode switch, the tour swapping its demo in): those ask
 * `confirmLeaveInPlace` first.
 */
export interface LeaveGuard {
  pending: Ref<boolean>;
  /** true = go ahead (nothing to lose, or the user agreed) */
  confirmLeave: () => Promise<boolean>;
  answer: (ok: boolean) => void;
}

const inPlace = new Set<() => Promise<boolean>>();

export async function confirmLeaveInPlace(): Promise<boolean> {
  for (const ask of [...inPlace]) if (!(await ask())) return false;
  return true;
}

export function useBeforeUnload(active: () => boolean): void {
  const onUnload = (e: BeforeUnloadEvent): void => {
    if (!active()) return;
    e.preventDefault();
    e.returnValue = ''; // Chromium still wants it set to show the prompt
  };
  onMounted(() => window.addEventListener('beforeunload', onUnload));
  onBeforeUnmount(() => window.removeEventListener('beforeunload', onUnload));
}

export function useLeaveGuard(active: () => boolean): LeaveGuard {
  const pending = ref(false);
  let resolve: ((ok: boolean) => void) | null = null;

  function confirmLeave(): Promise<boolean> {
    if (!active()) return Promise.resolve(true);
    resolve?.(false); // a second navigation while asking replaces the first
    pending.value = true;
    return new Promise((r) => { resolve = r; });
  }
  function answer(ok: boolean): void {
    pending.value = false;
    resolve?.(ok);
    resolve = null;
  }

  onBeforeRouteLeave(() => confirmLeave());
  // another song, playlist… opened in the same page (the route's :id changes)
  onBeforeRouteUpdate((to, from) => (to.path === from.path ? true : confirmLeave()));
  useBeforeUnload(active);
  inPlace.add(confirmLeave);
  onBeforeUnmount(() => {
    inPlace.delete(confirmLeave);
    answer(false);
  });
  return { pending, confirmLeave, answer };
}
