<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import type { PadCell } from '@/calib/engine';
import type { Intention, PadPos } from '@/calib/assistant';

/**
 * One coil's pad: a continuous field, coloured by what each setting does to the
 * coil's notes. Clean: green free, amber shrunk by the max duty (stronger: more
 * often), red stuck at the max ontime. Loud: violet never held back (lighter:
 * longer arcs), amber held at the max duty. The computed spots are drawn one
 * pixel each and stretched: the browser blends them into a gradient whose
 * pixel centres sit where the spots are, so the point reads the field where it
 * stands. Click, drag, or the arrow keys (Shift: a whole step) move it.
 */
const props = defineProps<{
  /** Rows from the bottom (y) of cells (x). */
  cells: PadCell[][];
  intention: Intention;
  color: string;
  /** The y axis's ends, bottom and top. */
  yLabels: [string, string];
  label: string;
}>();
const pos = defineModel<PadPos>('pos', { required: true });

const ny = computed(() => props.cells.length);
const nx = computed(() => props.cells[0]?.length ?? 1);
const canvas = ref<HTMLCanvasElement | null>(null);

/** A theme colour as the canvas takes it: the token's value, an "r g b" triple or any colour. */
function token(el: Element, name: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return /^\d+\s+\d+\s+\d+$/.test(v) ? `rgb(${v.split(/\s+/).join(',')})` : v || 'gray';
}

function paint(): void {
  const cv = canvas.value;
  if (!cv) return;
  cv.width = nx.value;
  cv.height = ny.value;
  const g = cv.getContext('2d');
  if (!g) return;
  const ok = token(cv, '--ok-rgb'), amber = token(cv, '--amber-rgb'), danger = token(cv, '--danger-rgb'), plasma = token(cv, '--plasma');
  g.clearRect(0, 0, cv.width, cv.height);
  props.cells.forEach((row, y) => row.forEach((cell, x) => {
    let fill: string, alpha: number;
    if (props.intention === 'loud') {
      if (cell.busy > 0.02) { fill = amber; alpha = Math.min(0.75, 0.3 + cell.busy * 2); }
      else { fill = plasma; alpha = 0.22 + (0.38 * y) / Math.max(1, ny.value - 1); }
    } else if (cell.capped > 0.02) { fill = danger; alpha = 0.55; }
    else if (cell.busy > 0.001) { fill = amber; alpha = Math.min(0.7, 0.32 + cell.busy * 3); }
    else { fill = ok; alpha = 0.32; }
    g.globalAlpha = alpha;
    g.fillStyle = fill;
    // drawn top row first: the canvas counts y downwards
    g.fillRect(x, ny.value - 1 - y, 1, 1);
  }));
  g.globalAlpha = 1;
}
onMounted(() => nextTick(paint));
watch(() => [props.cells, props.intention], () => nextTick(paint));

const clampY = (y: number): number => Math.max(0, Math.min(ny.value - 1, y));
const clampX = (x: number): number => Math.max(0, Math.min(nx.value - 1, x));
function set(y: number, x: number): void {
  const next = { y: clampY(y), x: clampX(x) };
  if (Math.abs(next.y - pos.value.y) > 1e-3 || Math.abs(next.x - pos.value.x) > 1e-3) pos.value = next;
}
// a spot's centre is at (i + 0.5) / n of the box: the pointer is read the same way
function fromPointer(e: PointerEvent): void {
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const x = ((e.clientX - box.left) / box.width) * nx.value - 0.5;
  const y = ny.value - 1 - (((e.clientY - box.top) / box.height) * ny.value - 0.5);
  set(y, x);
}
function onDown(e: PointerEvent): void {
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  fromPointer(e);
}
function onMove(e: PointerEvent): void {
  if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) fromPointer(e);
}
function onKey(e: KeyboardEvent): void {
  const d = { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
  if (!d) return;
  e.preventDefault();
  const step = e.shiftKey ? 1 : 0.25;
  set(pos.value.y + d[0] * step, pos.value.x + d[1] * step);
}
</script>

<template>
  <div class="pad" :style="{ '--c': color }">
    <span class="pad__y">{{ label }}</span>
    <div class="pad__box" role="slider" tabindex="0" :aria-label="label"
      :aria-valuetext="`${Math.round((pos.y / Math.max(1, ny - 1)) * 100)} % · ${Math.round((pos.x / Math.max(1, nx - 1)) * 100)} %`"
      @pointerdown="onDown" @pointermove="onMove" @keydown="onKey">
      <canvas ref="canvas" class="pad__field" aria-hidden="true"></canvas>
      <span class="pad__end is-top">{{ yLabels[1] }}</span>
      <span class="pad__end is-bottom">{{ yLabels[0] }}</span>
      <span class="pad__dot" :style="{ left: ((pos.x + 0.5) / nx) * 100 + '%', top: ((ny - 1 - pos.y + 0.5) / ny) * 100 + '%' }"></span>
    </div>
  </div>
</template>
