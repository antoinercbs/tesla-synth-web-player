<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { decodeBytes, heatColor, type HeatPayload } from './heat';

/**
 * Draws an arc silhouette (accumulated detections) with the measurement zone,
 * the floor line and the breakout point, at any size. Pure rendering.
 */
const props = withDefaults(defineProps<{
  heat: HeatPayload | null;
  /** CSS width; height follows the grid aspect. */
  width?: number;
  title?: string;
  /** Draw the zone / breakout overlay. */
  overlay?: boolean;
}>(), { width: 220, title: '', overlay: true });

const canvas = ref<HTMLCanvasElement | null>(null);
const SCALE = 4; // canvas px per cell

function draw(): void {
  const c = canvas.value;
  if (!c) return;
  const h = props.heat;
  if (!h) { c.width = 4; c.height = 3; c.getContext('2d')?.clearRect(0, 0, 4, 3); return; }
  c.width = h.w * SCALE; c.height = h.h * SCALE;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);
  // cells
  const bytes = decodeBytes(h.data);
  const img = ctx.createImageData(h.w, h.h);
  for (let k = 0; k < bytes.length; k++) {
    const [r, g, b, a] = heatColor(bytes[k] / 255);
    img.data[k * 4] = r; img.data[k * 4 + 1] = g; img.data[k * 4 + 2] = b; img.data[k * 4 + 3] = a;
  }
  const tmp = document.createElement('canvas'); tmp.width = h.w; tmp.height = h.h;
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmp, 0, 0, c.width, c.height);
  if (!props.overlay) return;
  const k = SCALE / h.cell; // work px → canvas px
  const X = (x: number): number => (x - h.x0) * k, Y = (y: number): number => (y - h.y0) * k;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255, 190, 60, 0.85)';
  ctx.beginPath();
  if (h.dirDeg == null) ctx.arc(X(h.breakout.x), Y(h.breakout.y), h.roiRadius * k, 0, Math.PI * 2);
  else { const a = (h.dirDeg * Math.PI) / 180; ctx.arc(X(h.breakout.x), Y(h.breakout.y), h.roiRadius * k, a - Math.PI / 2, a + Math.PI / 2); ctx.closePath(); }
  ctx.stroke();
  if (h.excludeBelowY != null) {
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(X(h.breakout.x - h.roiRadius), Y(h.excludeBelowY)); ctx.lineTo(X(h.breakout.x + h.roiRadius), Y(h.excludeBelowY)); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = '#ff4d62';
  ctx.beginPath(); ctx.arc(X(h.breakout.x), Y(h.breakout.y), 3.5, 0, Math.PI * 2); ctx.fill();
}
onMounted(draw);
watch(() => props.heat, draw);
</script>

<template>
  <figure class="arc-heat" :style="{ width: width + 'px' }">
    <canvas ref="canvas" class="arc-heat__canvas"></canvas>
    <figcaption v-if="title || heat" class="arc-heat__cap">
      <span>{{ title }}</span>
      <span v-if="heat" class="mono">{{ heat.frames }} f</span>
    </figcaption>
    <span v-if="!heat" class="arc-heat__empty">—</span>
  </figure>
</template>

<style scoped>
.arc-heat { margin: 0; max-width: 100%; position: relative; display: flex; flex-direction: column; gap: 0.25rem; }
.arc-heat__canvas { width: 100%; height: auto; display: block; background: #05070c; border-radius: 8px; border: 1px solid var(--line); image-rendering: auto; min-height: 2rem; }
.arc-heat__cap { display: flex; justify-content: space-between; gap: 0.5rem; font-size: 0.72rem; color: var(--text-dim); }
.mono { font-family: var(--font-mono); }
.arc-heat__empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--text-mute); pointer-events: none; }
</style>
