import { computed, ref, watch } from 'vue';

/**
 * The interface's level, per device: Débutant hides or folds what a beginner
 * doesn't need (never moves it: the same pages, the same places) and caps the
 * power at 100 %; Expert shows everything. Nothing stored changes with it.
 * A new device starts as a beginner (its welcome asks); one already used (its
 * welcome seen) stays expert.
 */
export type UiMode = 'beginner' | 'expert';

const KEY = 'uiMode';

function first(): UiMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'beginner' || v === 'expert') return v;
    return localStorage.getItem('tourSeen') === '1' ? 'expert' : 'beginner';
  } catch {
    return 'expert';
  }
}

export const uiMode = ref<UiMode>(first());
watch(uiMode, (v) => {
  try { localStorage.setItem(KEY, v); } catch { /* blocked storage: for the visit */ }
}, { immediate: true });

export const beginner = computed(() => uiMode.value === 'beginner');
