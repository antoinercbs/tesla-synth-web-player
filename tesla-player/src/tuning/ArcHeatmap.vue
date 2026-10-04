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
  const css = getComputedStyle(c);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = `rgb(${css.getPropertyValue('--zone-rgb')} / 0.85)`;
  // the floor spans the zone: the disk's width, or from the wall to the grid's edge
  const gx0 = h.x0, gx1 = h.x0 + h.w * h.cell;
  let fx0 = gx0, fx1 = gx1;
  if (h.roiRadius != null) {
    const R = h.roiRadius;
    ctx.beginPath();
    if (h.dirDeg == null) ctx.arc(X(h.breakout.x), Y(h.breakout.y), R * k, 0, Math.PI * 2);
    else { const a = (h.dirDeg * Math.PI) / 180; ctx.arc(X(h.breakout.x), Y(h.breakout.y), R * k, a - Math.PI / 2, a + Math.PI / 2); ctx.closePath(); }
    ctx.stroke();
    fx0 = h.breakout.x - R; fx1 = h.breakout.x + R;
  } else if (h.wall) {
    ctx.beginPath(); ctx.moveTo(X(h.wall.x), Y(h.y0)); ctx.lineTo(X(h.wall.x), Y(h.excludeBelowY ?? h.y0 + h.h * h.cell)); ctx.stroke();
    if (h.wall.side > 0) fx0 = h.wall.x; else fx1 = h.wall.x;
  }
  if (h.excludeBelowY != null) {
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(X(fx0), Y(h.excludeBelowY)); ctx.lineTo(X(fx1), Y(h.excludeBelowY)); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = css.getPropertyValue('--danger');
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
