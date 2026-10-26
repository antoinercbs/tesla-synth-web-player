import { computed, ref, useTemplateRef, type Ref } from 'vue';

const SEEK_STEP_MS = 5000;

/**
 * The progress bar: a click or a drag seeks (committed on release: each seek
 * rebuilds the engine), the keyboard steps through the song; while dragging,
 * the fill and the knob follow the drag, otherwise the playhead.
 */
export function useSeekBar(durationMs: Ref<number>, playheadMs: Ref<number>, hasSong: () => boolean, seek: (ms: number) => void) {
  // the component's ref="seekBar"
  const seekBar = useTemplateRef<HTMLElement>('seekBar');
  const scrubbing = ref(false);
  const scrubMs = ref(0);
  const progressPct = computed(() => (durationMs.value ? Math.min(100, (playheadMs.value / durationMs.value) * 100) : 0));
  const seekPct = computed(() => {
    const d = durationMs.value;
    if (scrubbing.value) return d ? Math.min(100, (scrubMs.value / d) * 100) : 0;
    return progressPct.value;
  });
  function seekMsFromEvent(e: PointerEvent): number {
    const el = seekBar.value;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const frac = r.width > 0 ? Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) : 0;
    return frac * (durationMs.value || 0);
  }
  function onSeekDown(e: PointerEvent): void {
    if (scrubbing.value || !hasSong() || !durationMs.value) return; // ignore re-entrant pointerdown
    scrubbing.value = true;
    scrubMs.value = seekMsFromEvent(e);
    window.addEventListener('pointermove', onSeekMove);
    window.addEventListener('pointerup', onSeekUp);
  }
  function onSeekMove(e: PointerEvent): void {
    if (scrubbing.value) scrubMs.value = seekMsFromEvent(e);
  }
  function onSeekUp(): void {
    window.removeEventListener('pointermove', onSeekMove);
    window.removeEventListener('pointerup', onSeekUp);
    if (!scrubbing.value) return;
    const target = scrubMs.value;
    scrubbing.value = false;
    seek(target);
  }
  function seekBy(deltaMs: number): void {
    seek(playheadMs.value + deltaMs);
  }
  function onSeekKey(e: KeyboardEvent): void {
    const steps: Record<string, number> = { ArrowLeft: -SEEK_STEP_MS, ArrowDown: -SEEK_STEP_MS, ArrowRight: SEEK_STEP_MS, ArrowUp: SEEK_STEP_MS, PageDown: -30000, PageUp: 30000 };
    if (e.key in steps) seekBy(steps[e.key]);
    else if (e.key === 'Home') seek(0);
    else if (e.key === 'End') seek(durationMs.value);
    else return;
    e.preventDefault();
  }
  return { scrubbing, scrubMs, seekPct, onSeekDown, onSeekKey, seekBy };
}
