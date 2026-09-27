<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RELEASE_STEP, stepsAmplitude, type EnvStep } from '@/sysex/envelopes';
import { MAX_PHASES, cloneSteps, peakAmplitude, splitAt, stepRole, toShape, toSteps, walkChain } from '@/envelopes/chain';
import { notify } from '@/utils/toast';

/**
 * The envelope as a note of `noteMs` plays it (release included), plus the
 * held-on curve past the note-off. Dragging a step's point sets its duration and
 * amplitude, the release point its duration, the note-off line the note length;
 * a double-click adds a step there.
 */
const steps = defineModel<EnvStep[]>('steps', { required: true });
const noteMs = defineModel<number>('noteMs', { required: true });
const hoverStep = defineModel<number | null>('hoverStep', { default: null });
const props = defineProps<{ readonly: boolean; zoom: 'note' | 'attack'; maxNoteMs: number }>();

const M = { l: 46, r: 16, t: 30, b: 26 };
const ATTACK_ZOOM_MS = 250;
const TICK_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];

// the SVG is drawn at its pixel size, so text and strokes never stretch
const wrap = ref<HTMLElement | null>(null);
const size = ref({ w: 800, h: 300 });
let observer: ResizeObserver | null = null;
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    size.value = { w: Math.max(300, entry.contentRect.width), h: Math.max(140, entry.contentRect.height) };
  });
  if (wrap.value) observer.observe(wrap.value);
});
onBeforeUnmount(() => observer?.disconnect());

const chain = computed(() => walkChain(steps.value));
const releaseMs = computed(() => steps.value[RELEASE_STEP].durMs);
const peak = computed(() => peakAmplitude(steps.value));
// a chain that ends on the release plays it as soon as it gets there, held or not
const oneShot = computed(() => chain.value.sustain == null && chain.value.loopTo == null);
const chainEndMs = computed(() => chain.value.points.at(-1)?.t ?? 0);
const releaseStartMs = computed(() => (oneShot.value ? Math.min(noteMs.value, chainEndMs.value) : noteMs.value));

// frozen while dragging, or the axes would rescale under the pointer
const frozen = ref<{ x: number; y: number } | null>(null);
const xMax = computed(() => {
  if (frozen.value) return frozen.value.x;
  const lastT = chain.value.points.at(-1)?.t ?? 0;
  let x = Math.max(noteMs.value + releaseMs.value, Math.min(lastT, noteMs.value * 3 + releaseMs.value)) * 1.06;
  if (props.zoom === 'attack') x = Math.min(x, ATTACK_ZOOM_MS);
  return Math.max(10, x);
});
const yMax = computed(() => frozen.value?.y ?? Math.min(4.5, Math.ceil(peak.value * 1.12 * 2) / 2));

const plotW = computed(() => size.value.w - M.l - M.r);
const plotH = computed(() => size.value.h - M.t - M.b);
const X = (t: number): number => M.l + (t / xMax.value) * plotW.value;
const Y = (a: number): number => size.value.h - M.b - (Math.min(a, yMax.value) / yMax.value) * plotH.value;

const xTicks = computed(() => {
  const most = Math.max(3, Math.floor(plotW.value / 90));
  const step = TICK_STEPS.find((c) => xMax.value / c <= most) ?? 20000;
  const out: number[] = [];
  for (let t = 0; t <= xMax.value; t += step) out.push(t);
  return out;
});
const yTicks = computed(() => {
  const step = plotH.value / (yMax.value / 0.5) < 22 ? 1 : 0.5;
  const out: number[] = [];
  for (let a = 0; a <= yMax.value + 1e-9; a += step) out.push(a);
  return out;
});
const fmtTick = (t: number): string => (t >= 1000 ? `${+(t / 1000).toFixed(2)} s` : `${t} ms`);

const curves = computed(() => {
  const n = Math.min(900, Math.round(size.value.w));
  let played = '';
  let held = '';
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * xMax.value;
    const x = X(t).toFixed(1);
    played += `${i ? 'L' : 'M'}${x},${Y(stepsAmplitude(steps.value, t, noteMs.value)).toFixed(1)}`;
    if (t >= noteMs.value) held += `${held ? 'L' : 'M'}${x},${Y(stepsAmplitude(steps.value, t, null)).toFixed(1)}`;
  }
  return { played, held, fill: `${played}L${X(xMax.value)},${Y(0)}L${X(0)},${Y(0)}Z` };
});

const handles = computed(() =>
  chain.value.points
    .filter((p) => p.t <= xMax.value)
    .map((p) => ({ step: p.step, x: X(p.t), y: Y(p.amp), role: stepRole(p.step, chain.value) })),
);
const releaseHandle = computed(() => {
  const t = releaseStartMs.value + releaseMs.value;
  return t <= xMax.value ? { x: X(t), y: Y(0) } : null;
});
const oneShotLabel = computed(() => {
  const last = chain.value.points.at(-1);
  if (!oneShot.value || !last || last.t >= noteMs.value || last.t > xMax.value) return null;
  return { x: X(last.t) + 8, y: Y(last.amp) - 14 };
});
const noteOffX = computed(() => (noteMs.value <= xMax.value ? X(noteMs.value) : null));

const loopArc = computed(() => {
  const c = chain.value;
  if (c.loopTo == null) return null;
  const from = c.points[c.points.length - 1];
  if (from.t > xMax.value) return null;
  // the loop re-ramps from the level of the point before its first step
  const before = c.points[c.points.findIndex((p) => p.step === c.loopTo) - 1];
  const fx = X(from.t);
  const fy = Y(from.amp) - 10;
  const tx = X(before?.t ?? 0);
  const ty = Y(before?.amp ?? 0) - 10;
  const top = M.t + 8; // over the whole curve, which it would otherwise cross
  return { d: `M${fx},${fy} C${fx},${top} ${tx},${top} ${tx},${ty}`, x: fx + 8, y: top + 4, from: c.loopTo + 1, to: from.step + 1 };
});

/* -------------------------------- dragging -------------------------------- */
type Drag = { kind: 'step'; step: number; prevT: number } | { kind: 'release' } | { kind: 'noteOff' };
const svg = ref<SVGSVGElement | null>(null);
let drag: Drag | null = null;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const roundDur = (ms: number): number => (ms < 10 ? Math.round(ms * 10) / 10 : Math.round(ms));

function startDrag(e: PointerEvent, d: Drag): void {
  if (props.readonly && d.kind !== 'noteOff') return;
  frozen.value = { x: xMax.value, y: yMax.value };
  drag = d;
  svg.value?.setPointerCapture(e.pointerId);
  e.preventDefault();
}
function startStepDrag(e: PointerEvent, step: number): void {
  const pts = chain.value.points;
  const i = pts.findIndex((p) => p.step === step);
  startDrag(e, { kind: 'step', step, prevT: i > 0 ? pts[i - 1].t : 0 });
}
function onMove(e: PointerEvent): void {
  if (!drag || !svg.value) return;
  const r = svg.value.getBoundingClientRect();
  const t = ((e.clientX - r.left - M.l) / plotW.value) * xMax.value;
  const a = ((size.value.h - M.b - (e.clientY - r.top)) / plotH.value) * yMax.value;
  if (drag.kind === 'noteOff') {
    noteMs.value = clamp(Math.round(t), 20, props.maxNoteMs);
    return;
  }
  const next = cloneSteps(steps.value);
  if (drag.kind === 'release') {
    next[RELEASE_STEP].durMs = roundDur(Math.max(0.1, t - releaseStartMs.value));
  } else {
    next[drag.step].durMs = roundDur(Math.max(0.1, t - drag.prevT));
    next[drag.step].amp = Math.round(clamp(a, 0, 4) * 100) / 100;
  }
  steps.value = next;
}
function endDrag(): void {
  drag = null;
  frozen.value = null;
}

function onDoubleClick(e: MouseEvent): void {
  if (props.readonly || !svg.value) return;
  if ((e.target as Element).closest('.env-graph__handle, .env-graph__noteoff')) return;
  const r = svg.value.getBoundingClientRect();
  const t = ((e.clientX - r.left - M.l) / plotW.value) * xMax.value;
  const shape = toShape(steps.value);
  const next = splitAt(shape, t);
  if (next) steps.value = toSteps(next);
  else if (shape.phases.length >= MAX_PHASES) notify('envelopes.maxSteps', 'info');
}
</script>

<template>
  <div ref="wrap" class="env-graph">
    <svg ref="svg" :viewBox="`0 0 ${size.w} ${size.h}`" :width="size.w" :height="size.h" role="img"
      :aria-label="$t('envelopes.graphLabel')" @pointermove="onMove" @pointerup="endDrag" @pointercancel="endDrag"
      @dblclick="onDoubleClick">
      <defs>
        <linearGradient id="env-graph-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" class="env-graph__stop-top" />
          <stop offset="1" class="env-graph__stop-bottom" />
        </linearGradient>
        <marker id="env-graph-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7"
          orient="auto-start-reverse">
          <path d="M0,0L10,5L0,10z" class="env-graph__arrow" />
        </marker>
      </defs>

      <!-- above nominal: the device caps the ontime at the coil limits -->
      <rect :x="M.l" :y="Y(yMax)" :width="plotW" :height="Math.max(0, Y(1) - Y(yMax))" class="env-graph__over" />
      <g class="env-graph__grid">
        <template v-for="t in xTicks" :key="'x' + t">
          <line :x1="X(t)" :x2="X(t)" :y1="M.t" :y2="size.h - M.b" />
          <text :x="X(t)" :y="size.h - M.b + 17" text-anchor="middle">{{ fmtTick(t) }}</text>
        </template>
        <template v-for="a in yTicks" :key="'y' + a">
          <line v-if="a !== 1" :x1="M.l" :x2="size.w - M.r" :y1="Y(a)" :y2="Y(a)" />
          <text :x="M.l - 8" :y="Y(a) + 4" text-anchor="end">×{{ a }}</text>
        </template>
      </g>
      <line :x1="M.l" :x2="size.w - M.r" :y1="Y(1)" :y2="Y(1)" class="env-graph__nominal" />
      <text :x="size.w - M.r - 4" :y="Y(1) - 6" text-anchor="end" class="env-graph__nominal-label">{{
        $t('envelopes.nominal') }}</text>

      <path :d="curves.fill" class="env-graph__fill" />
      <path v-if="curves.held" :d="curves.held" class="env-graph__held" />
      <path :d="curves.played" class="env-graph__played" />

      <g v-if="loopArc" class="env-graph__loop">
        <path :d="loopArc.d" marker-end="url(#env-graph-arrow)" />
        <text :x="loopArc.x" :y="loopArc.y">{{ $t('envelopes.loop', { from: loopArc.from, to: loopArc.to }) }}</text>
      </g>

      <text v-if="oneShotLabel" :x="oneShotLabel.x" :y="oneShotLabel.y" class="env-graph__oneshot">{{
        $t('envelopes.oneShot') }}</text>

      <g v-if="noteOffX != null" class="env-graph__noteoff" @pointerdown="startDrag($event, { kind: 'noteOff' })">
        <line :x1="noteOffX" :x2="noteOffX" :y1="M.t" :y2="size.h - M.b" />
        <rect :x="noteOffX - 8" :y="M.t" width="16" :height="plotH" class="env-graph__hit" />
        <text :x="noteOffX + 6" :y="M.t + 12">note-off</text>
      </g>

      <g v-for="h in handles" :key="h.step" class="env-graph__handle" :class="['is-' + h.role, {
        'is-hover': hoverStep === h.step, 'is-readonly': readonly }]" @pointerdown="startStepDrag($event, h.step)"
        @pointerenter="hoverStep = h.step" @pointerleave="hoverStep = null">
        <circle :cx="h.x" :cy="h.y" :r="hoverStep === h.step ? 9 : 7" />
        <text :x="h.x" :y="h.y - 13" text-anchor="middle">{{ h.step + 1 }}</text>
        <circle :cx="h.x" :cy="h.y" r="16" class="env-graph__hit" />
      </g>
      <g v-if="releaseHandle" class="env-graph__handle is-release is-horizontal" :class="{
        'is-hover': hoverStep === RELEASE_STEP, 'is-readonly': readonly }"
        @pointerdown="startDrag($event, { kind: 'release' })" @pointerenter="hoverStep = RELEASE_STEP"
        @pointerleave="hoverStep = null">
        <circle :cx="releaseHandle.x" :cy="releaseHandle.y" :r="hoverStep === RELEASE_STEP ? 9 : 7" />
        <text :x="releaseHandle.x" :y="releaseHandle.y - 13" text-anchor="middle">{{ RELEASE_STEP + 1 }}</text>
        <circle :cx="releaseHandle.x" :cy="releaseHandle.y" r="16" class="env-graph__hit" />
      </g>

      <!-- legend (left) and peak (right), in the top margin -->
      <g class="env-graph__legend">
        <line :x1="M.l" :x2="M.l + 16" y1="12" y2="12" class="env-graph__played" />
        <text :x="M.l + 22" y="16">{{ $t('envelopes.legendPlayed') }}</text>
        <line :x1="M.l + 110" :x2="M.l + 126" y1="12" y2="12" class="env-graph__held" />
        <text :x="M.l + 132" y="16">{{ $t('envelopes.legendHeld') }}</text>
        <text v-if="!readonly && size.w > 640" :x="M.l + 210" y="16">· {{ $t('envelopes.legendDrag') }}</text>
      </g>
      <text :x="size.w - M.r" y="16" text-anchor="end" class="env-graph__peak" :class="{ 'is-over': peak > 1 }">{{
        peak > 1 ? $t('envelopes.peakCapped', { v: +peak.toFixed(2) }) : $t('envelopes.peak', { v: +peak.toFixed(2) })
      }}</text>
    </svg>
  </div>
</template>

<style scoped>
.env-graph { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; }
.env-graph svg { position: absolute; inset: 0; display: block; user-select: none; touch-action: none; }
.env-graph text { font-family: var(--font-body); font-size: 11px; fill: var(--text-mute); }
.env-graph__grid line { stroke: var(--line-006); }
.env-graph__grid text { font-family: var(--font-mono); }
.env-graph__over { fill: rgb(224 169 59 / 0.06); }
.env-graph__nominal { stroke: var(--amber); stroke-dasharray: 4 4; stroke-opacity: 0.7; }
.env-graph text.env-graph__nominal-label { fill: var(--amber); }
.env-graph__stop-top { stop-color: var(--volt); stop-opacity: 0.28; }
.env-graph__stop-bottom { stop-color: var(--volt); stop-opacity: 0.02; }
.env-graph__fill { fill: url(#env-graph-fill); }
.env-graph__played { fill: none; stroke: var(--volt); stroke-width: 2.4; stroke-linejoin: round; }
.env-graph__held { fill: none; stroke: var(--text-mute); stroke-width: 1.5; stroke-dasharray: 3 4; opacity: 0.8; }
.env-graph__loop path { fill: none; stroke: var(--coil-4); stroke-width: 1.5; stroke-dasharray: 4 3; }
.env-graph__arrow { fill: var(--coil-4); }
.env-graph .env-graph__loop text { fill: var(--coil-4); }
.env-graph text.env-graph__oneshot { fill: var(--danger); }
.env-graph__noteoff { cursor: ew-resize; }
.env-graph__noteoff line { stroke: var(--danger); stroke-opacity: 0.7; stroke-dasharray: 5 4; }
.env-graph .env-graph__noteoff text { fill: var(--danger); }
.env-graph__hit { fill: transparent; stroke: none; }
.env-graph__handle { cursor: grab; --h: var(--text); }
.env-graph__handle.is-horizontal { cursor: ew-resize; }
.env-graph__handle.is-readonly { cursor: default; }
.env-graph__handle.is-attack { --h: var(--volt); }
.env-graph__handle.is-sustain { --h: var(--ok); }
.env-graph__handle.is-loop { --h: var(--coil-4); }
.env-graph__handle.is-release { --h: var(--danger); }
.env-graph__handle circle:first-child { fill: var(--panel); stroke: var(--h); stroke-width: 2.2; transition: r 0.1s; }
.env-graph .env-graph__handle text { fill: var(--h); font-family: var(--font-mono); }
.env-graph__legend line { stroke-dasharray: none; }
.env-graph__legend line.env-graph__held { stroke-dasharray: 3 3; }
.env-graph text.env-graph__peak { font-size: 11.5px; fill: var(--ok); }
.env-graph text.env-graph__peak.is-over { fill: var(--amber); }
</style>
