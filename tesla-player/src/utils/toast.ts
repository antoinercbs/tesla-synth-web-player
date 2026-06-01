import { reactive } from 'vue';

export type ToastType = 'success' | 'error' | 'info';
export interface Toast { id: number; key: string; type: ToastType }

/** Live list of toasts, rendered by the global <Toaster>. */
export const toasts = reactive<Toast[]>([]);
let seq = 0;

/**
 * Show a transient toast. `key` is an i18n key (resolved by the Toaster), or a
 * plain string (shown as-is if no translation exists).
 */
export function notify(key: string, type: ToastType = 'success', durationMs = 2600): void {
  const id = ++seq;
  toasts.push({ id, key, type });
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i !== -1) toasts.splice(i, 1);
  }, durationMs);
}
