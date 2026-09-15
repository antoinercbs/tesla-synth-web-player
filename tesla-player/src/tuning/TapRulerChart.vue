<script setup lang="ts">
import { computed, ref } from 'vue';
import { noteHzLabel, noteName } from '@/ui/piano-layout';
import { formatTurns, type Trial } from './api';
import { snap } from './suggest';

/**
 * The primary, unrolled: one shared horizontal scale in TURNS carries both the
 * trials (arc length per note and the trial score, above) and the tap ruler
 * (graduated at every turn and every tap step, below) with the draggable tap
 * handle and the best / previous / suggested marks. Reading where a trial sits
 * on the primary and moving the tap there is the same gesture.
 */
const props = withDefaults(defineProps<{
  trials: Trial[];
  notes: number[];
  /** Explored range (turns) = the scale's domain. */
  min: number;
  max: number;
  step: number;
  /** Total turns of the primary (for the caption). */
  turns: number;
  best?: number | null;
  previous?: number | null;
  suggested?: number | null;
  disabled?: boolean;
  /** When false the ruler only shows the tap (the spiral is the control). */
  interactive?: boolean;
  labels: { score: string; empty: string; tap: string; length: string; best: string; previous: string; suggested: string; turnsCaption: string };
}>(), { best: null, previous: null, suggested: null, disabled: false, interactive: true });

const tap = defineModel<number>({ required: true });

const SERIES = ['var(--volt)', 'var(--plasma)', 'var(--amber)', 'var(--coil-2)', 'var(--coil-5)', 'var(--coil-3)'];
const W = 760, H = 300;
const ML = 50, MR = 18, MT = 24;
const CH_BOTTOM = 196; // chart baseline
const RULER_Y = 240; // ruler track centre
const RULER_H = 12;
const LABEL_Y = 276;

const domain = computed(() => ({ min: props.min, max: Math.max(props.max, props.min + props.step) }));
const px = (t: number): number => ML + ((t - domain.value.min) / (domain.value.max - domain.value.min)) * (W - ML - MR);
const turnsAt = (x: number): number => domain.value.min + ((x - ML) / (W - ML - MR)) * (domain.value.max - domain.value.min);

/* ---------------------------------------------------------------- y scale */
const ymax = computed(() => {
  let m = 10;
  for (const t of props.trials) { m = Math.max(m, t.score); for (const n of t.notes) m = Math.max(m, n.p90); }
  const s = niceStep(m / 4);
  return Math.ceil((m * 1.1) / s) * s;
});
function niceStep(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1e-6))));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
const yticks = computed(() => {
  const s = niceStep(ymax.value / 4);
  const out: number[] = [];
  for (let v = 0; v <= ymax.value + 1e-9; v += s) out.push(Math.round(v * 100) / 100);
  return out;
});
const py = (v: number): number => MT + (1 - v / ymax.value) * (CH_BOTTOM - MT);

/* ------------------------------------------------------------------ ruler */
const ticks = computed(() => {
  const { min, max } = domain.value;
  const out: { x: number; t: number; kind: 'turn' | 'half' | 'step' }[] = [];
  const n = Math.round((max - min) / props.step);
  if (n <= 0 || n > 400) return out;
  for (let i = 0; i <= n; i++) {
    const t = min + i * props.step;
    const whole = Math.abs(t - Math.round(t)) < 1e-6;
    const half = !whole && Math.abs(t * 2 - Math.round(t * 2)) < 1e-6;
    out.push({ x: px(t), t, kind: whole ? 'turn' : half ? 'half' : 'step' });
  }
  return out;
});
// label every turn; halves too when there is room
const labelled = computed(() => {
  const range = domain.value.max - domain.value.min;
  const showHalves = range <= 6;
  return ticks.value.filter((tk) => tk.kind === 'turn' || (showHalves && tk.kind === 'half'));
});

/* ----------------------------------------------------------------- series */
const sorted = computed(() => [...props.trials].sort((a, b) => a.tapTurns - b.tapTurns));
const seriesPaths = computed(() =>
  props.notes.map((note, k) => {
    const pts = sorted.value
      .map((t) => ({ t, n: t.notes.find((x) => x.note === note) ?? t.notes[k] }))
      .filter((p) => p.n);
    return {
      note, color: SERIES[k % SERIES.length],
      d: pts.map((p, i) => `${i ? 'L' : 'M'}${px(p.t.tapTurns).toFixed(1)},${py(p.n!.p90).toFixed(1)}`).join(''),
      pts: pts.map((p) => ({ x: px(p.t.tapTurns), y: py(p.n!.p90) })),
    };
  }),
);
const scorePath = computed(() => sorted.value.map((t, i) => `${i ? 'L' : 'M'}${px(t.tapTurns).toFixed(1)},${py(t.score).toFixed(1)}`).join(''));
const bestId = computed(() => {
  let b: Trial | null = null;
  for (const t of props.trials) if (!b || t.score > b.score) b = t;
  return b?.id ?? null;
});

/* ------------------------------------------------------------- interaction */
const svg = ref<SVGSVGElement | null>(null);
const dragging = ref(false);
const hover = ref<Trial | null>(null);

function svgX(clientX: number): number {
  const el = svg.value!;
  const r = el.getBoundingClientRect();
  return ((clientX - r.left) / r.width) * W;
}
function svgY(clientY: number): number {
  const el = svg.value!;
  const r = el.getBoundingClientRect();
  return ((clientY - r.top) / r.height) * H;
}
function setTapFromClient(clientX: number): void {
  tap.value = snap(turnsAt(svgX(clientX)), props.step, props.min, props.max);
}
function onPointerDown(e: PointerEvent): void {
  if (props.disabled || !props.interactive) return;
  // the ruler band (and its handle) moves the tap; the chart area is for reading
  if (svgY(e.clientY) < CH_BOTTOM + 14) return;
  dragging.value = true;
  (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  setTapFromClient(e.clientX);
}
function onPointerMove(e: PointerEvent): void {
  if (dragging.value) { setTapFromClient(e.clientX); return; }
  if (svgY(e.clientY) > CH_BOTTOM) { hover.value = null; return; }
  const t = turnsAt(svgX(e.clientX));
  let best: Trial | null = null, bd = Infinity;
  for (const tr of props.trials) { const d = Math.abs(tr.tapTurns - t); if (d < bd) { bd = d; best = tr; } }
  hover.value = bd <= props.step * 1.5 ? best : null;
}
function onPointerUp(): void { dragging.value = false; }
function onKey(e: KeyboardEvent): void {
  if (props.disabled || !props.interactive) return;
  const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
  if (!d) return;
  e.preventDefault();
  tap.value = snap(tap.value + d * props.step * (e.shiftKey ? 4 : 1), props.step, props.min, props.max);
}
const tapX = computed(() => px(tap.value));
const tapLabelAnchor = computed(() => (tapX.value < ML + 40 ? 'start' : tapX.value > W - MR - 40 ? 'end' : 'middle'));
</script>

<template>
  <div class="tap-chart" :class="{ 'is-disabled': disabled }">
    <svg ref="svg" :viewBox="`0 0 ${W} ${H}`" :role="interactive ? 'slider' : 'img'" :tabindex="interactive ? 0 : -1"
      :aria-valuemin="min" :aria-valuemax="max" :aria-valuenow="tap" :aria-valuetext="formatTurns(tap, step)" :aria-label="interactive ? labels.tap : labels.length"
      @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp" @pointerleave="hover = null" @keydown="onKey">
      <!-- grid + y axis -->
      <line v-for="v in yticks" :key="'g' + v" :x1="ML" :x2="W - MR" :y1="py(v)" :y2="py(v)" class="grid" :class="{ axis: v === 0 }" />
      <text v-for="v in yticks" :key="'yl' + v" :x="ML - 8" :y="py(v) + 3.5" text-anchor="end" class="tick">{{ v }}</text>
      <text :x="ML - 8" :y="MT - 9" text-anchor="end" class="tick dim">px</text>

      <!-- vertical guides from the ruler marks up through the chart -->
      <line v-if="suggested != null" :x1="px(suggested)" :x2="px(suggested)" :y1="MT" :y2="RULER_Y" class="guide guide--suggested" />
      <line :x1="tapX" :x2="tapX" :y1="MT" :y2="RULER_Y" class="guide guide--tap" />
      <line v-if="hover" :x1="px(hover.tapTurns)" :x2="px(hover.tapTurns)" :y1="MT" :y2="CH_BOTTOM" class="guide guide--hover" />

      <!-- series -->
      <g v-for="s in seriesPaths" :key="s.note">
        <path :d="s.d" fill="none" :stroke="s.color" stroke-width="1.5" stroke-linejoin="round" opacity="0.8" />
        <circle v-for="(p, i) in s.pts" :key="i" :cx="p.x" :cy="p.y" r="3" :fill="s.color" />
      </g>
      <path :d="scorePath" fill="none" stroke="var(--text)" stroke-width="2.4" stroke-linejoin="round" />
      <g v-for="t in sorted" :key="t.id">
        <circle v-if="t.id === bestId" :cx="px(t.tapTurns)" :cy="py(t.score)" r="9" fill="none" stroke="var(--ok)" stroke-width="1.5" />
        <circle :cx="px(t.tapTurns)" :cy="py(t.score)" r="4.5" fill="var(--text)" stroke="var(--panel)" stroke-width="2" />
      </g>
      <text v-if="!trials.length" :x="(ML + W - MR) / 2" :y="(MT + CH_BOTTOM) / 2" text-anchor="middle" class="empty">{{ labels.empty }}</text>

      <!-- ruler -->
      <rect :x="ML" :y="RULER_Y - RULER_H / 2" :width="W - ML - MR" :height="RULER_H" rx="7" class="track" />
      <template v-for="tk in ticks" :key="tk.t">
        <line :x1="tk.x" :x2="tk.x" :y1="RULER_Y - (tk.kind === 'turn' ? 16 : tk.kind === 'half' ? 11 : 6)" :y2="RULER_Y + (tk.kind === 'turn' ? 16 : tk.kind === 'half' ? 11 : 6)" class="rtick" :class="tk.kind" />
      </template>
      <text v-for="tk in labelled" :key="'l' + tk.t" :x="tk.x" :y="LABEL_Y" text-anchor="middle" class="rlabel" :class="tk.kind">{{ formatTurns(tk.t, step) }}</text>

      <!-- marks: previous, suggested, best -->
      <g v-if="previous != null" class="mark mark--previous"><circle :cx="px(previous)" :cy="RULER_Y" r="7" /><title>{{ labels.previous }} · {{ formatTurns(previous, step) }}</title></g>
      <g v-if="suggested != null" class="mark mark--suggested"><circle :cx="px(suggested)" :cy="RULER_Y" r="10" /><title>{{ labels.suggested }} · {{ formatTurns(suggested, step) }}</title></g>
      <g v-if="best != null" class="mark mark--best"><circle :cx="px(best)" :cy="RULER_Y" r="6" /><title>{{ labels.best }} · {{ formatTurns(best, step) }}</title></g>

      <!-- tap: draggable handle, or a plain marker when the spiral is the control -->
      <g v-if="interactive" class="handle" :class="{ 'is-dragging': dragging }">
        <circle :cx="tapX" :cy="RULER_Y" r="15" class="handle__halo" />
        <circle :cx="tapX" :cy="RULER_Y" r="8" class="handle__knob" />
        <text :x="tapX" :y="RULER_Y - 24" :text-anchor="tapLabelAnchor" class="handle__label">{{ formatTurns(tap, step) }} tr</text>
      </g>
      <g v-else class="tapmark">
        <polygon :points="`${tapX - 6},${RULER_Y - 18} ${tapX + 6},${RULER_Y - 18} ${tapX},${RULER_Y - 9}`" />
        <text :x="tapX" :y="RULER_Y - 22" :text-anchor="tapLabelAnchor" class="handle__label">{{ formatTurns(tap, step) }} tr</text>
      </g>
    </svg>

    <div class="tap-chart__foot">
      <div class="legend">
        <span v-for="s in seriesPaths" :key="s.note" :title="noteHzLabel(s.note)"><i :style="{ background: s.color }"></i>{{ noteName(s.note) }} <em>{{ noteHzLabel(s.note) }}</em></span>
        <span><i class="score"></i>{{ labels.score }}</span>
        <span class="sep"></span>
        <span><i class="dot dot--tap"></i>{{ labels.tap }}</span>
        <span v-if="best != null"><i class="dot dot--best"></i>{{ labels.best }}</span>
        <span v-if="suggested != null"><i class="dot dot--suggested"></i>{{ labels.suggested }}</span>
        <span v-if="previous != null"><i class="dot dot--previous"></i>{{ labels.previous }}</span>
      </div>
      <span class="caption mono">{{ labels.turnsCaption }}</span>
    </div>
    <div v-if="hover" class="tip mono">
      <strong>{{ formatTurns(hover.tapTurns, step) }} tr</strong>
      <span>{{ labels.score }} {{ hover.score.toFixed(0) }} px</span>
      <span v-for="n in hover.notes" :key="n.note">{{ noteName(n.note) }} {{ n.p90.toFixed(0) }} px · {{ Math.round(n.hitRate * 100) }} %</span>
    </div>
  </div>
</template>

<style scoped>
.tap-chart { display: flex; flex-direction: column; gap: 0.5rem; }
svg { width: 100%; height: auto; display: block; font-family: var(--font-mono); font-size: 11px; touch-action: none; user-select: none; outline: none; border-radius: var(--radius-sm); cursor: default; }
.tapmark polygon { fill: var(--volt); }
svg:focus-visible { box-shadow: 0 0 0 2px var(--volt-30); }
.grid { stroke: var(--line); }
.grid.axis { stroke: var(--line-strong); }
.tick { fill: var(--text-dim); }
.tick.dim { fill: var(--text-mute); }
.empty { fill: var(--text-mute); font-family: var(--font-body); font-size: 12.5px; }
.guide { stroke-width: 1; }
.guide--tap { stroke: var(--volt); stroke-dasharray: 4 4; opacity: 0.8; }
.guide--suggested { stroke: var(--volt); stroke-dasharray: 2 5; opacity: 0.45; }
.guide--hover { stroke: var(--text-dim); stroke-dasharray: 3 3; }
.track { fill: var(--bg-2); stroke: var(--line-strong); }
.rtick { stroke: var(--text-mute); stroke-width: 1; }
.rtick.half { stroke: var(--text-dim); }
.rtick.turn { stroke: var(--text); stroke-width: 1.6; }
.rlabel { fill: var(--text-dim); font-size: 11px; }
.rlabel.turn { fill: var(--text); font-weight: 600; font-size: 12.5px; }
.mark--previous circle { fill: none; stroke: var(--amber); stroke-width: 1.6; stroke-dasharray: 3 2; }
.mark--suggested circle { fill: none; stroke: var(--volt); stroke-width: 1.4; stroke-dasharray: 3 3; }
.mark--best circle { fill: var(--ok); }
.handle { cursor: grab; }
.handle.is-dragging { cursor: grabbing; }
.handle__halo { fill: var(--volt); opacity: 0.16; }
.handle__knob { fill: var(--volt); stroke: var(--bg); stroke-width: 2.5; }
.handle__label { fill: var(--text); font-weight: 600; font-size: 13px; }
.is-disabled svg { opacity: 0.75; }
.is-disabled .handle { cursor: not-allowed; }
.tap-chart__foot { display: flex; justify-content: space-between; gap: 0.6rem 1rem; flex-wrap: wrap; align-items: center; }
.legend { display: flex; flex-wrap: wrap; gap: 0.3rem 1rem; font-size: 0.76rem; color: var(--text-dim); font-family: var(--font-mono); }
.legend span { display: inline-flex; align-items: center; gap: 0.4rem; }
.legend i { display: inline-block; width: 14px; height: 3px; border-radius: 2px; }
.legend em { font-style: normal; color: var(--text-mute); }
.legend i.score { background: var(--text); height: 4px; }
.legend i.dot { width: 10px; height: 10px; border-radius: 50%; }
.legend i.dot--tap { background: var(--volt); }
.legend i.dot--best { background: var(--ok); }
.legend i.dot--suggested { background: transparent; border: 1.5px dashed var(--volt); }
.legend i.dot--previous { background: transparent; border: 1.5px dashed var(--amber); }
.legend .sep { width: 1px; height: 0.9rem; background: var(--line-strong); }
.caption { font-size: 0.74rem; color: var(--text-mute); }
.mono { font-family: var(--font-mono); }
.tip { display: flex; flex-wrap: wrap; gap: 0.3rem 1rem; font-size: 0.8rem; color: var(--text-dim); }
.tip strong { color: var(--text); }
</style>
