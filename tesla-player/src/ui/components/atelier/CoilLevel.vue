<script setup lang="ts">
import { computed } from 'vue';
import type { PadCell } from '@/model/calib';
import { CalAssistant, type Intention, type PadPos } from '@/model/calib/assistant';

/**
 * A coil's level for a beginner (ui/helpers/ui-mode.ts): its pad's vertical axis alone,
 * across, its column (the crossover the preset set) kept. The track is coloured
 * by what each level does to the coil's notes, as the pad is; a click, a drag or
 * the arrow keys set it. Its title says the numbers the song stores.
 */
const props = defineProps<{
  cells: PadCell[][];
  intention: Intention;
  color: string;
  label: string;
  /** The ends' words, low and high. */
  ends: [string, string];
  /** What the song stores at this level (ontime · duty), for the title. */
  stores: string;
}>();
const pos = defineModel<PadPos>('pos', { required: true });

const ny = computed(() => props.cells.length);
const col = computed(() => Math.max(0, Math.min((props.cells[0]?.length ?? 1) - 1, Math.round(pos.value.x))));
// one stop a row of the pad, its state at the column the coil stands on
const stops = computed(() => {
  const n = Math.max(1, ny.value);
  return props.cells.map((row, y) => {
    const cell = row[col.value];
    return { from: (y / n) * 100, to: ((y + 1) / n) * 100, state: cell ? CalAssistant.padState(cell, props.intention) : 'free' };
  });
});
const at = computed(() => ((pos.value.y + 0.5) / Math.max(1, ny.value)) * 100);

function set(y: number): void {
  const next = Math.max(0, Math.min(ny.value - 1, y));
  if (Math.abs(next - pos.value.y) > 1e-3) pos.value = { y: next, x: pos.value.x };
}
function fromPointer(e: PointerEvent): void {
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
  set(((e.clientX - box.left) / box.width) * ny.value - 0.5);
}
function onDown(e: PointerEvent): void {
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  fromPointer(e);
}
function onMove(e: PointerEvent): void {
  if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) fromPointer(e);
}
function onKey(e: KeyboardEvent): void {
  const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
  if (!d) return;
  e.preventDefault();
  set(pos.value.y + d * (e.shiftKey ? 1 : 0.25));
}
</script>

<template>
  <div class="clevel" :style="{ '--c': color }">
    <span class="clevel__k">{{ label }}</span>
    <div class="clevel__track" role="slider" tabindex="0" :aria-label="label" :title="stores"
      :aria-valuetext="`${Math.round(at)} %`" @pointerdown="onDown" @pointermove="onMove" @keydown="onKey">
      <i v-for="(s, i) in stops" :key="i" class="clevel__seg" :class="`is-${s.state}`" :style="{ left: s.from + '%', width: s.to - s.from + '%' }"></i>
      <span class="clevel__thumb" :style="{ left: at + '%' }"></span>
    </div>
    <span class="clevel__ends"><span>{{ ends[0] }}</span><span>{{ ends[1] }}</span></span>
  </div>
</template>
