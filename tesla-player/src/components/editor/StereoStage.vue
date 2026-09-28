<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { coilColor } from '@/ui/coil-colors';
import { MIN_REACH } from '@/midi/stereo';
import type { SongStereo, StereoBlend } from '@/types/domain';

/**
 * The stage, left to right: each coil's place (drag the marker, or arrow keys)
 * and reach (the handles on its band), with dots where the song's notes land.
 */
const coils = defineModel<SongStereo['coils']>('coils', { required: true });
const props = defineProps<{ blend: StereoBlend; notePans: number[] }>();

const H = 158;
const PAD = 34;
const AXIS_Y = 100;
const BAND_H = 52;
const DOTS_Y = 20;
// reach handles sit a third of the way down each slope: at the band's edge (or
// halfway) they would land on a neighbour's marker or handle when coils are evenly spread
const HANDLE_AT = 0.35;

const wrap = ref<HTMLElement | null>(null);
const width = ref(800);
let observer: ResizeObserver | null = null;
onMounted(() => {
  observer = new ResizeObserver(([e]) => { width.value = Math.max(320, e.contentRect.width); });
  if (wrap.value) observer.observe(wrap.value);
});
onBeforeUnmount(() => observer?.disconnect());

const X = (p: number): number => PAD + p * (width.value - 2 * PAD);
const round = (v: number): number => Math.round(v * 100) / 100;

const bands = computed(() =>
  coils.value.map((k, i) => {
    const color = coilColor(i);
    const left = X(k.position - k.reach);
    const right = X(k.position + k.reach);
    const shape = props.blend === 'fade'
      ? `M${left},${AXIS_Y} L${X(k.position)},${AXIS_Y - BAND_H} L${right},${AXIS_Y} Z`
      : `M${left},${AXIS_Y} V${AXIS_Y - BAND_H} H${right} V${AXIS_Y} Z`;
    const handles = [-1, 1]
      .map((side) => {
        const p = props.blend === 'fade' ? k.position + side * k.reach * HANDLE_AT : k.position + side * k.reach;
        if (p < 0 || p > 1) return null;
        const x = X(p) - (props.blend === 'fade' ? 0 : side * 6);
        const y = props.blend === 'fade' ? AXIS_Y - BAND_H * (1 - HANDLE_AT) : AXIS_Y - BAND_H / 2;
        return { side, x, y };
      })
      .filter((h): h is { side: number; x: number; y: number } => h != null);
    return { i, color, shape, handles, x: X(k.position), pct: Math.round(k.position * 100) };
  }),
);
// one dot per distinct place: thousands of notes land on a few dozen spots
const dots = computed(() => [...new Set(props.notePans.map((p) => Math.round(p * 200) / 200))].map(X));

/* -------------------------------- dragging -------------------------------- */
type Drag = { kind: 'position' | 'reach'; i: number };
const svg = ref<SVGSVGElement | null>(null);
let drag: Drag | null = null;

function setCoil(i: number, patch: Partial<SongStereo['coils'][number]>): void {
  coils.value = coils.value.map((k, j) => (j === i ? { ...k, ...patch } : k));
}
function start(e: PointerEvent, d: Drag): void {
  drag = d;
  svg.value?.setPointerCapture(e.pointerId);
  e.preventDefault();
}
function move(e: PointerEvent): void {
  if (!drag || !svg.value) return;
  const r = svg.value.getBoundingClientRect();
  const p = Math.min(1, Math.max(0, (e.clientX - r.left - PAD) / (r.width - 2 * PAD)));
  const k = coils.value[drag.i];
  if (drag.kind === 'position') setCoil(drag.i, { position: round(p) });
  else {
    const scale = props.blend === 'fade' ? HANDLE_AT : 1;
    setCoil(drag.i, { reach: round(Math.min(1, Math.max(MIN_REACH, Math.abs(p - k.position) / scale))) });
  }
}
function end(): void {
  drag = null;
}
function nudge(e: KeyboardEvent, i: number): void {
  const step = e.shiftKey ? 0.05 : 0.01;
  const delta = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
  if (!delta) return;
  e.preventDefault();
  setCoil(i, { position: round(Math.min(1, Math.max(0, coils.value[i].position + delta))) });
}
</script>

<template>
  <div ref="wrap" class="stage">
    <svg ref="svg" :viewBox="`0 0 ${width} ${H}`" :width="width" :height="H" @pointermove="move" @pointerup="end"
      @pointercancel="end">
      <line :x1="X(0)" :x2="X(1)" :y1="DOTS_Y" :y2="DOTS_Y" class="stage__dots-track" />
      <circle v-for="(x, k) in dots" :key="k" :cx="x" :cy="DOTS_Y" r="2.2" class="stage__dot" />
      <text :x="X(0)" :y="DOTS_Y - 8" class="stage__label">{{ $t('stereo.notePlaces') }}</text>

      <clipPath id="stage-clip"><rect :x="X(0)" y="0" :width="X(1) - X(0)" :height="H" /></clipPath>
      <g clip-path="url(#stage-clip)">
        <path v-for="b in bands" :key="`b${b.i}`" :d="b.shape" :fill="b.color" :stroke="b.color" class="stage__band" />
      </g>
      <line :x1="X(0)" :x2="X(1)" :y1="AXIS_Y" :y2="AXIS_Y" class="stage__axis" />
      <text :x="X(0)" :y="AXIS_Y + 42" class="stage__label">{{ $t('stereo.left') }}</text>
      <text :x="X(1)" :y="AXIS_Y + 42" class="stage__label" text-anchor="end">{{ $t('stereo.right') }}</text>

      <template v-for="b in bands" :key="`h${b.i}`">
        <!-- diamonds, so a reach handle never reads as another coil -->
        <g v-for="h in b.handles" :key="h.side" class="stage__handle" @pointerdown="start($event, { kind: 'reach', i: b.i })">
          <path :d="`M${h.x},${h.y - 5.5} L${h.x + 5.5},${h.y} L${h.x},${h.y + 5.5} L${h.x - 5.5},${h.y} Z`" :stroke="b.color" />
          <circle :cx="h.x" :cy="h.y" r="11" class="stage__hit" />
        </g>
      </template>
      <g v-for="b in bands" :key="`m${b.i}`" class="stage__marker" tabindex="0" role="slider"
        :aria-label="$t('stereo.coilPlace', { n: b.i })" :aria-valuenow="b.pct" aria-valuemin="0" aria-valuemax="100"
        @pointerdown="start($event, { kind: 'position', i: b.i })" @keydown="nudge($event, b.i)">
        <circle :cx="b.x" :cy="AXIS_Y" r="13" :stroke="b.color" />
        <text :x="b.x" :y="AXIS_Y + 4" :fill="b.color" text-anchor="middle" class="stage__num">{{ b.i }}</text>
        <text :x="b.x" :y="AXIS_Y + 27" text-anchor="middle" class="stage__pct">{{ b.pct }} %</text>
      </g>
    </svg>
  </div>
</template>
