<script setup lang="ts">
import { computed } from 'vue';
import type { CoilSpec } from '@/model/coils/spec';

/**
 * A coil seen from the side, drawn from its sheet: primary, secondary,
 * topload, outlet tube. `mmPerUnit` is shared by the cards of a page, so the
 * coils compare at the same scale.
 */
const props = defineProps<{ spec: CoilSpec; height: number }>();

const H = 120, W = 120;
const shape = computed(() => {
  const s = props.spec, k = (H - 8) / props.height;
  const floor = H - 2, priY = floor - s.stand * k;
  const secTop = priY - 3 - s.sec.h * k, topCy = secTop - (s.top.d * k) / 2;
  const cx = W * 0.38, tilt = (s.pin.tilt * Math.PI) / 180;
  const pinX = cx + (s.top.D * k) / 2, pinLen = s.pin.h * k;
  return {
    floor, priY, cx, k,
    pri: { x1: cx - (s.pri.od * k) / 2, x2: cx + (s.pri.od * k) / 2 },
    sec: { x: cx - (s.sec.d * k) / 2, y: secTop, w: s.sec.d * k, h: s.sec.h * k },
    top: { cy: topCy, rx: (s.top.D * k) / 2, ry: Math.max(1.5, (s.top.d * k) / 2) },
    pin: { x1: pinX, y1: topCy, x2: pinX + pinLen * Math.cos(tilt), y2: topCy - pinLen * Math.sin(tilt) },
  };
});
</script>

<template>
  <svg class="coil-sil" :viewBox="`0 0 ${W} ${H}`" aria-hidden="true">
    <line class="coil-sil__floor" x1="2" :x2="W - 2" :y1="shape.floor" :y2="shape.floor" />
    <line class="coil-sil__stand" :x1="shape.cx" :x2="shape.cx" :y1="shape.floor" :y2="shape.priY" />
    <line class="coil-sil__pri" :x1="shape.pri.x1" :x2="shape.pri.x2" :y1="shape.priY" :y2="shape.priY" />
    <rect class="coil-sil__sec" :x="shape.sec.x" :y="shape.sec.y" :width="shape.sec.w" :height="shape.sec.h" rx="1" />
    <ellipse class="coil-sil__top" :cx="shape.cx" :cy="shape.top.cy" :rx="shape.top.rx" :ry="shape.top.ry" />
    <line class="coil-sil__pin" :x1="shape.pin.x1" :y1="shape.pin.y1" :x2="shape.pin.x2" :y2="shape.pin.y2" />
  </svg>
</template>
