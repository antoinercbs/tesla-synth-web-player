<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { MAX_RATIO, levelSamples, snapToBeat } from '@/midi/automation';
import type { MidiAnalysis } from '@/midi/analyze';
import { coilColor } from '@/ui/coil-colors';
import { SONG_WIDE, type CoilEvent, type CoilParam } from '@/types/domain';

/**
 * The automation tracks: the song's power, and each coil's ontime or duty when
 * `perCoil`. Drag a point (snapped to the beats, Alt to move freely), double-click
 * a track to add one, Delete or right-click to remove the selected one. Selection
 * is an index into `events`, which edits replace in place to keep it valid.
 */
const events = defineModel<CoilEvent[]>('events', { required: true });
const selected = defineModel<number | null>('selected', { default: null });
const cursorMs = defineModel<number>('cursorMs', { required: true });
const props = defineProps<{
  coilCount: number;
  analysis: MidiAnalysis | null;
  perCoil: boolean;
  param: CoilParam;
  durationMs: number;
}>();
const { t } = useI18n();

// the zoom floor: a short song is stretched to the tracks' width instead
const MIN_PX_PER_S = 40;
const RULER_H = 18;
const NOTES_H = 34;
const SONG_H = 92;
const COIL_H = 56;
const PAD = 8;
const VALUE_STEP = 0.05;

interface Lane { key: string; coilIndex: number; param: CoilEvent['param']; label: string; sub: string; color: string; top: number; h: number }
const lanes = computed<Lane[]>(() => {
  const out: Lane[] = [];
  let y = RULER_H + NOTES_H;
  out.push({ key: 'song', coilIndex: SONG_WIDE, param: 'power', label: t('dynamics.songTrack'), sub: t('dynamics.songTrackSub'), color: 'var(--volt)', top: y, h: SONG_H });
  y += SONG_H;
  if (props.perCoil) {
    for (let c = 0; c < props.coilCount; c++) {
      out.push({ key: `c${c}`, coilIndex: c, param: props.param, label: `${t('label.coil')} ${c}`, sub: t(`dynamics.param.${props.param}`), color: coilColor(c), top: y, h: COIL_H });
      y += COIL_H;
    }
  }
  return out;
});
const height = computed(() => lanes.value.reduce((h, l) => Math.max(h, l.top + l.h), 0) + 2);
const scrollerWidth = ref(600);
let observer: ResizeObserver | null = null;
const pxPerS = computed(() => Math.max(MIN_PX_PER_S, (scrollerWidth.value - 24) / Math.max(1, props.durationMs / 1000)));
const width = computed(() => Math.max(scrollerWidth.value, (props.durationMs / 1000) * pxPerS.value + 24));
const X = (ms: number): number => (ms / 1000) * pxPerS.value;
const Y = (lane: Lane, v: number): number => lane.top + lane.h - PAD - (Math.min(v, MAX_RATIO) / MAX_RATIO) * (lane.h - 2 * PAD);

/* --------------------------------- grid ----------------------------------- */
const beats = computed(() => props.analysis?.beats ?? []);
const gridLines = computed(() => {
  const per = props.analysis?.beatsPerBar ?? 4;
  if (beats.value.length) return beats.value.map((ms, i) => ({ x: X(ms), bar: i % per === 0 }));
  const out: { x: number; bar: boolean }[] = [];
  for (let ms = 0; ms <= props.durationMs; ms += 1000) out.push({ x: X(ms), bar: ms % 4000 === 0 });
  return out;
});
const fmt = (ms: number): string => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const rulerLabels = computed(() => {
  const step = props.durationMs > 150000 ? 15000 : props.durationMs > 60000 ? 10000 : 5000;
  const out: { x: number; label: string }[] = [];
  for (let ms = 0; ms <= props.durationMs; ms += step) out.push({ x: X(ms), label: fmt(ms) });
  return out;
});
/** On the beats, unless Alt is held. */
function snap(ms: number, free: boolean): number {
  const clamped = Math.max(0, Math.min(props.durationMs, ms));
  return free ? Math.round(clamped) : snapToBeat(beats.value, clamped);
}

/* ------------------------------ notes context ------------------------------ */
const noteMarks = computed(() => {
  const a = props.analysis;
  if (!a || !a.notes.length) return [];
  const { min, max } = a.pitchRange;
  const span = Math.max(1, max - min);
  return a.notes.map((n) => ({
    x: X(n.startMs), w: Math.max(1.5, X(n.endMs - n.startMs)),
    y: RULER_H + 3 + (1 - (n.note - min) / span) * (NOTES_H - 8),
  }));
});

/* --------------------------------- curves ---------------------------------- */
const curves = computed(() =>
  lanes.value.map((lane) => {
    const own = events.value.filter((e) => e.coilIndex === lane.coilIndex && e.param === lane.param);
    // a coil track draws its own curve: the song's power applies on top of it
    const samples = levelSamples(own, lane.coilIndex, lane.param, props.durationMs);
    const pts = samples.map(([ms, v]) => `${X(ms).toFixed(1)},${Y(lane, v).toFixed(1)}`);
    const last = samples.at(-1)?.[1] ?? 1;
    pts.push(`${width.value},${Y(lane, last).toFixed(1)}`);
    const line = `M${pts.join('L')}`;
    const bottom = lane.top + lane.h - PAD;
    return { lane, line, area: `${line}L${width.value},${bottom}L0,${bottom}Z` };
  }),
);
const points = computed(() =>
  events.value
    .map((e, i) => ({ e, i, lane: lanes.value.find((l) => l.coilIndex === e.coilIndex && l.param === e.param) }))
    .filter((p): p is { e: CoilEvent; i: number; lane: Lane } => !!p.lane)
    .map(({ e, i, lane }) => ({ i, x: X(e.atMs), y: Y(lane, e.value), color: lane.color, pct: Math.round(e.value * 100) })),
);

/* ------------------------------- interaction ------------------------------- */
const svg = ref<SVGSVGElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
let drag: { i: number; lane: Lane } | null = null;
// the click that ends a drag must not deselect the point just moved
let justDragged = false;

function local(e: MouseEvent): { x: number; y: number } {
  const r = svg.value!.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function valueAt(lane: Lane, y: number): number {
  const v = ((lane.top + lane.h - PAD - y) / (lane.h - 2 * PAD)) * MAX_RATIO;
  return Math.round(Math.min(MAX_RATIO, Math.max(0, v)) / VALUE_STEP) * VALUE_STEP;
}
function laneAt(y: number): Lane | undefined {
  return lanes.value.find((l) => y >= l.top && y < l.top + l.h);
}
function replace(i: number, patch: Partial<CoilEvent>): void {
  const next = events.value.slice();
  next[i] = { ...next[i], ...patch };
  events.value = next;
}
function onPointPointerDown(e: PointerEvent, i: number): void {
  if (e.button !== 0) return;
  const lane = lanes.value.find((l) => l.coilIndex === events.value[i].coilIndex && l.param === events.value[i].param);
  if (!lane) return;
  selected.value = i;
  drag = { i, lane };
  svg.value?.setPointerCapture(e.pointerId);
  e.preventDefault();
  e.stopPropagation();
}
function onPointerMove(e: PointerEvent): void {
  if (!drag) return;
  const { x, y } = local(e);
  replace(drag.i, { atMs: snap((x / pxPerS.value) * 1000, e.altKey), value: valueAt(drag.lane, y) });
}
function onPointerUp(): void {
  if (drag) justDragged = true;
  drag = null;
}
function onDoubleClick(e: MouseEvent): void {
  const { x, y } = local(e);
  const lane = y < RULER_H ? undefined : laneAt(y);
  if (!lane || (e.target as Element).closest('.dyn-tracks__point')) return;
  const point: CoilEvent = { coilIndex: lane.coilIndex, param: lane.param, atMs: snap((x / pxPerS.value) * 1000, e.altKey), value: valueAt(lane, y) };
  events.value = [...events.value, point];
  selected.value = events.value.length - 1;
}
function onClick(e: MouseEvent): void {
  if (justDragged) {
    justDragged = false;
    return;
  }
  const { x, y } = local(e);
  if (y < RULER_H) cursorMs.value = snap((x / pxPerS.value) * 1000, e.altKey);
  else if (!(e.target as Element).closest('.dyn-tracks__point')) selected.value = null;
}
function remove(i: number): void {
  events.value = events.value.filter((_, k) => k !== i);
  selected.value = null;
}
function onContextMenu(e: MouseEvent, i: number): void {
  e.preventDefault();
  remove(i);
}
function onKey(e: KeyboardEvent): void {
  if (selected.value == null) return;
  const target = e.target as HTMLElement;
  if (target.closest('input, select, textarea')) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    remove(selected.value);
  } else if (e.key === 'Escape') {
    selected.value = null;
  }
}
onMounted(() => {
  window.addEventListener('keydown', onKey);
  observer = new ResizeObserver(([entry]) => { scrollerWidth.value = Math.max(300, entry.contentRect.width); });
  if (scroller.value) observer.observe(scroller.value);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  observer?.disconnect();
});

// a point picked from the list comes into view
watch(selected, (i) => {
  const el = scroller.value;
  if (i == null || !el || drag) return;
  const e = events.value[i];
  if (!e) return;
  const x = X(e.atMs);
  if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.4);
});

</script>

<template>
  <div class="dyn-tracks">
    <div class="dyn-tracks__rail" :style="{ height: height + 'px' }">
      <div :style="{ height: RULER_H + NOTES_H + 'px' }" class="dyn-tracks__rail-notes"><i class="fas fa-music"></i></div>
      <div v-for="lane in lanes" :key="lane.key" class="dyn-tracks__rail-lane" :style="{ height: lane.h + 'px', '--c': lane.color }">
        <span class="dyn-tracks__rail-label">{{ lane.label }}</span>
        <span class="dyn-tracks__rail-sub">{{ lane.sub }}</span>
      </div>
    </div>
    <div ref="scroller" class="dyn-tracks__scroll">
      <svg ref="svg" :width="width" :height="height" class="dyn-tracks__svg" @pointermove="onPointerMove"
        @pointerup="onPointerUp" @pointercancel="onPointerUp" @dblclick="onDoubleClick" @click="onClick">
        <line v-for="(g, k) in gridLines" :key="`g${k}`" :x1="g.x" :x2="g.x" :y1="RULER_H" :y2="height"
          class="dyn-tracks__grid" :class="{ 'is-bar': g.bar }" />
        <rect x="0" y="0" :width="width" :height="RULER_H" class="dyn-tracks__ruler" />
        <text v-for="(r, k) in rulerLabels" :key="`r${k}`" :x="r.x + 3" y="12" class="dyn-tracks__ruler-label">{{ r.label }}</text>
        <rect v-for="(n, k) in noteMarks" :key="`n${k}`" :x="n.x" :y="n.y" :width="n.w" height="2.2" class="dyn-tracks__note" />

        <g v-for="c in curves" :key="c.lane.key">
          <line x1="0" :x2="width" :y1="c.lane.top" :y2="c.lane.top" class="dyn-tracks__lane-sep" />
          <line x1="0" :x2="width" :y1="Y(c.lane, 1)" :y2="Y(c.lane, 1)" class="dyn-tracks__nominal" />
          <path :d="c.area" :fill="c.lane.color" class="dyn-tracks__area" />
          <path :d="c.line" :stroke="c.lane.color" class="dyn-tracks__line" />
        </g>

        <g v-for="p in points" :key="`p${p.i}`" class="dyn-tracks__point" :class="{ 'is-selected': selected === p.i }"
          @pointerdown="onPointPointerDown($event, p.i)" @contextmenu="onContextMenu($event, p.i)">
          <circle :cx="p.x" :cy="p.y" :r="selected === p.i ? 7 : 5.5" :stroke="p.color" />
          <text :x="p.x" :y="p.y - 10" :fill="p.color" text-anchor="middle">{{ p.pct }}</text>
          <circle :cx="p.x" :cy="p.y" r="12" class="dyn-tracks__hit" />
        </g>

        <line :x1="X(cursorMs)" :x2="X(cursorMs)" :y1="0" :y2="height" class="dyn-tracks__cursor" />
      </svg>
    </div>
  </div>
</template>

<style scoped>
.dyn-tracks { display: flex; border-radius: var(--radius); background: var(--bg-2); border: 1px solid var(--line); overflow: hidden; }
.dyn-tracks__rail { flex: 0 0 6.5rem; border-right: 1px solid var(--line); background: var(--panel); }
.dyn-tracks__rail-notes { display: grid; place-items: center; color: var(--text-mute); font-size: 0.8rem; padding-top: 18px; }
.dyn-tracks__rail-lane { display: flex; flex-direction: column; justify-content: center; padding: 0 0.6rem; border-top: 1px solid var(--line); border-left: 3px solid var(--c); }
.dyn-tracks__rail-label { font-size: var(--fs-sm); font-weight: 600; color: var(--c); }
.dyn-tracks__rail-sub { font-size: var(--fs-xs); color: var(--text-mute); }
.dyn-tracks__scroll { flex: 1; min-width: 0; overflow-x: auto; overflow-y: hidden; }
.dyn-tracks__svg { display: block; user-select: none; touch-action: none; cursor: copy; }
.dyn-tracks__svg text { font-family: var(--font-mono); font-size: 10px; }
.dyn-tracks__grid { stroke: var(--line-005); }
.dyn-tracks__grid.is-bar { stroke: var(--line-018); }
.dyn-tracks__ruler { fill: var(--panel); cursor: pointer; }
.dyn-tracks__ruler-label { fill: var(--text-mute); pointer-events: none; }
.dyn-tracks__note { fill: var(--text-dim); opacity: 0.3; }
.dyn-tracks__lane-sep { stroke: var(--line); }
.dyn-tracks__nominal { stroke: var(--amber); stroke-dasharray: 4 4; stroke-opacity: 0.45; }
.dyn-tracks__area { fill-opacity: 0.1; pointer-events: none; }
.dyn-tracks__line { fill: none; stroke-width: 2; pointer-events: none; }
.dyn-tracks__point { cursor: grab; }
.dyn-tracks__point circle:first-child { fill: var(--panel); stroke-width: 2; }
.dyn-tracks__point.is-selected circle:first-child { stroke-width: 3; }
.dyn-tracks__hit { fill: transparent; }
.dyn-tracks__cursor { stroke: var(--danger); stroke-width: 1.5; opacity: 0.8; pointer-events: none; }
</style>
