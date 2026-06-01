<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { coilColor } from '@/ui/coil-colors';
import { useMidiStore } from '@/stores/midi';
import { effectiveRatio } from '@/midi/automation';
import type { CoilConfig, CoilEvent, CoilParam } from '@/types/domain';
import type { MidiAnalysis } from '@/midi/analyze';

const props = withDefaults(defineProps<{
  analysis: MidiAnalysis | null;
  coils: CoilConfig[];
  coilCount: number;
  /** 'roll' = score only, 'lanes' = coils only, 'combined' = score above coils. */
  view: 'roll' | 'lanes' | 'combined';
  output2Mask?: number;
  playheadMs?: number;
  playing?: boolean;
  /** Mid-song coil automation points. value = RATIO of the coil's configured value (1 = 100%). */
  events?: CoilEvent[];
  editable?: boolean;
  editParam?: CoilParam;
  /** Compact rail: number + ontime/duty only, no coil name. */
  compact?: boolean;
}>(), {
  output2Mask: 0, playheadMs: 0, playing: false,
  events: () => [], editable: false, editParam: 'ontime', compact: false,
});

const emit = defineEmits<{
  (e: 'update:events', events: CoilEvent[]): void;
  (e: 'update:editParam', param: CoilParam): void;
}>();
const midiStore = useMidiStore();

const SPEAKER = 'var(--plasma)';
function inSpeaker(ch: number): boolean { return (props.output2Mask & (1 << ch)) !== 0; }
const hasSpeaker = computed(() => props.output2Mask !== 0);

const PX_PER_SEC = 60;
const RULER_H = 16;
const MIN_WIDTH = 600;
const AUTO_PAD = 7;
const SNAP_MS = 90;
const RAIL_W = 104;
const DRAG_SLOP = 4;
const ROLL_MAX_ROW = 13;

const showRoll = computed(() => props.view !== 'lanes');
const showLanes = computed(() => props.view !== 'roll');
const railW = computed(() => (props.compact ? 30 : RAIL_W));

const bodyEl = ref<HTMLElement | null>(null);
const containerH = ref(320);
let ro: ResizeObserver | null = null;
onMounted(() => {
  if (bodyEl.value && 'ResizeObserver' in window) {
    ro = new ResizeObserver((entries) => { containerH.value = entries[0].contentRect.height; });
    ro.observe(bodyEl.value);
  }
});
onBeforeUnmount(() => ro?.disconnect());

const pitch = computed(() => {
  const r = props.analysis?.pitchRange ?? { min: 48, max: 72 };
  return { min: r.min - 1, max: r.max + 1 };
});
const pitchSpan = computed(() => Math.max(1, pitch.value.max - pitch.value.min + 1));
const laneCount = computed(() => Math.max(1, props.coilCount + (hasSpeaker.value ? 1 : 0)));
const minLaneH = computed(() => (props.editable ? 56 : 30));

const avail = computed(() => Math.max(120, containerH.value) - RULER_H);
const rollRow = computed(() => {
  if (!showRoll.value) return 0;
  if (props.view === 'combined') return Math.max(3, Math.min(ROLL_MAX_ROW, (avail.value * 0.42) / pitchSpan.value));
  return Math.max(3, avail.value / pitchSpan.value);
});
const rollH = computed(() => rollRow.value * pitchSpan.value);
const laneH = computed(() => {
  if (!showLanes.value) return 0;
  return Math.max(minLaneH.value, (avail.value - rollH.value) / laneCount.value);
});
const lanesH = computed(() => laneH.value * laneCount.value);
const rollTopY = RULER_H;
const lanesTopY = computed(() => RULER_H + rollH.value);
const heightPx = computed(() => RULER_H + rollH.value + lanesH.value);
const speakerLaneIndex = computed(() => (hasSpeaker.value ? props.coilCount : -1));

const durationMs = computed(() => props.analysis?.durationMs ?? 0);
const widthPx = computed(() => Math.max(MIN_WIDTH, (durationMs.value / 1000) * PX_PER_SEC));

function fmtSec(s: number): string {
  return `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;
}
const timeTicks = computed(() => {
  const dur = durationMs.value / 1000;
  if (dur <= 0) return [];
  const major = dur > 150 ? 30 : dur > 60 ? 15 : dur > 20 ? 5 : dur > 6 ? 2 : 1;
  const out: { x: number; label: string; major: boolean }[] = [];
  for (let s = 0; s <= Math.ceil(dur); s++) {
    out.push({ x: s * PX_PER_SEC, label: s % major === 0 ? fmtSec(s) : '', major: s % major === 0 });
  }
  return out;
});

function coilsForChannel(ch: number): number[] {
  const out: number[] = [];
  for (const c of props.coils) if ((c.channelMask & (1 << ch)) !== 0) out.push(c.coilIndex);
  return out;
}
function destColors(ch: number): string[] {
  const cols = coilsForChannel(ch).map((c) => coilColor(c));
  if (inSpeaker(ch)) cols.push(SPEAKER);
  return cols;
}
function destKey(ch: number): string {
  return coilsForChannel(ch).join('-') + (inSpeaker(ch) ? '-s' : '');
}
function rollFill(ch: number): string {
  const cols = destColors(ch);
  if (cols.length === 0) return 'rgba(150,170,200,0.35)';
  if (cols.length === 1) return cols[0];
  return `url(#hatch-${destKey(ch)})`;
}
const patterns = computed(() => {
  if (!showRoll.value) return [];
  const seen = new Map<string, { id: string; colors: string[] }>();
  for (const n of props.analysis?.notes ?? []) {
    const cols = destColors(n.channel);
    if (cols.length < 2) continue;
    const id = `hatch-${destKey(n.channel)}`;
    if (!seen.has(id)) seen.set(id, { id, colors: cols });
  }
  return [...seen.values()];
});

interface Rect { x: number; y: number; w: number; h: number; fill: string; roll: boolean }
const rects = computed<Rect[]>(() => {
  const notes = props.analysis?.notes ?? [];
  const h = laneH.value; const rr = rollRow.value; const lt = lanesTopY.value;
  const out: Rect[] = [];
  for (const n of notes) {
    const x = (n.startMs / 1000) * PX_PER_SEC;
    const w = Math.max(1.5, ((n.endMs - n.startMs) / 1000) * PX_PER_SEC);
    if (showRoll.value) {
      out.push({ x, w, y: rollTopY + (pitch.value.max - n.note) * rr, h: Math.max(2, rr - 1), fill: rollFill(n.channel), roll: true });
    }
    if (showLanes.value) {
      for (const c of coilsForChannel(n.channel)) {
        out.push({ x, w, y: lt + c * h + 3, h: h - 6, fill: coilColor(c), roll: false });
      }
      if (inSpeaker(n.channel)) {
        out.push({ x, w, y: lt + speakerLaneIndex.value * h + 3, h: h - 6, fill: SPEAKER, roll: false });
      }
    }
  }
  return out;
});

const octaveLines = computed(() => {
  if (!showRoll.value) return [];
  const lines: number[] = [];
  for (let n = Math.ceil(pitch.value.min / 12) * 12; n <= pitch.value.max; n += 12) {
    lines.push(rollTopY + (pitch.value.max - n) * rollRow.value);
  }
  return lines;
});
const laneLines = computed(() =>
  showLanes.value ? Array.from({ length: laneCount.value + 1 }, (_, i) => lanesTopY.value + i * laneH.value) : []);

function dutyPct(d: number): number { return Math.round(d * 1e4) / 100; }
// rail sub-label shows the CURRENT effective value at the playhead (base × active automation ratio)
const railLanes = computed(() => {
  if (!showLanes.value) return [];
  const out: { color: string; num: string; name: string; sub: string; speaker?: boolean }[] = [];
  for (let c = 0; c < props.coilCount; c++) {
    const cfg = props.coils.find((co) => co.coilIndex === c);
    const ot = cfg ? cfg.ontimeUs * effectiveRatio(props.events, c, 'ontime', props.playheadMs) : 0;
    const dt = cfg ? cfg.duty * effectiveRatio(props.events, c, 'duty', props.playheadMs) : 0;
    out.push({ color: coilColor(c), num: String(c), name: midiStore.coilName(c), sub: cfg ? `${Math.round(ot)}µs · ${dutyPct(dt)}%` : '' });
  }
  if (hasSpeaker.value) out.push({ color: SPEAKER, num: '', name: '', sub: '', speaker: true });
  return out;
});

// ---- automation: step curve of editParam as a RATIO of the coil base ----
function timeX(ms: number): number { return (ms / 1000) * PX_PER_SEC; }
function xToTime(x: number): number { return Math.max(0, (x / PX_PER_SEC) * 1000); }
const valueMax = computed(() => {
  let max = 2;
  for (const e of props.events) if (e.param === props.editParam) max = Math.max(max, e.value);
  return max * 1.08;
});
function valueY(coilIdx: number, ratio: number): number {
  const top = lanesTopY.value + coilIdx * laneH.value;
  const usable = laneH.value - 2 * AUTO_PAD;
  const frac = Math.max(0, Math.min(1, ratio / valueMax.value));
  return top + AUTO_PAD + (1 - frac) * usable;
}
function yToValue(coilIdx: number, y: number): number {
  const top = lanesTopY.value + coilIdx * laneH.value;
  const usable = laneH.value - 2 * AUTO_PAD;
  const frac = Math.max(0, Math.min(1, 1 - (y - top - AUTO_PAD) / usable));
  return Math.round(frac * valueMax.value * 100) / 100;
}
function laneOfY(y: number): number {
  if (y < lanesTopY.value) return -1;
  return Math.floor((y - lanesTopY.value) / laneH.value);
}
function eventsFor(coilIdx: number): CoilEvent[] {
  return props.events.filter((e) => e.coilIndex === coilIdx && e.param === props.editParam).sort((a, b) => a.atMs - b.atMs);
}
function staircase(coilIdx: number): string {
  const pts: string[] = [];
  let v = 1;
  pts.push(`0,${valueY(coilIdx, v).toFixed(1)}`);
  for (const e of eventsFor(coilIdx)) {
    const x = timeX(e.atMs).toFixed(1);
    pts.push(`${x},${valueY(coilIdx, v).toFixed(1)}`);
    pts.push(`${x},${valueY(coilIdx, e.value).toFixed(1)}`);
    v = e.value;
  }
  pts.push(`${widthPx.value.toFixed(1)},${valueY(coilIdx, v).toFixed(1)}`);
  return pts.join(' ');
}
const autoCurves = computed(() =>
  showLanes.value ? Array.from({ length: props.coilCount }, (_, c) => ({
    coilIdx: c, points: staircase(c), baseY: valueY(c, 1), color: coilColor(c),
  })) : []);
const handles = computed(() => {
  if (!showLanes.value) return [];
  const out: { i: number; cx: number; cy: number; color: string; pct: number }[] = [];
  props.events.forEach((e, i) => {
    if (e.param !== props.editParam || e.coilIndex < 0 || e.coilIndex >= props.coilCount) return;
    out.push({ i, cx: timeX(e.atMs), cy: valueY(e.coilIndex, e.value), color: coilColor(e.coilIndex), pct: Math.round(e.value * 100) });
  });
  return out;
});

const noteOnsets = computed(() => {
  const set = new Set<number>();
  for (const n of props.analysis?.notes ?? []) set.add(Math.round(n.startMs));
  return [...set].sort((a, b) => a - b);
});
function snapTime(ms: number): number {
  let best = ms; let bestD = SNAP_MS;
  for (const o of noteOnsets.value) { const d = Math.abs(o - ms); if (d < bestD) { bestD = d; best = o; } }
  return best;
}

const svgEl = ref<SVGSVGElement | null>(null);
const drag = ref<{ mode: 'pending' | 'handle'; index: number; x: number; y: number; moved: boolean } | null>(null);
function svgPoint(e: PointerEvent): { x: number; y: number } {
  const r = svgEl.value!.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function addWin(): void {
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}
function onSvgPointerDown(e: PointerEvent): void {
  if (!props.editable || !showLanes.value || e.button !== 0) return;
  const { x, y } = svgPoint(e);
  const lane = laneOfY(y);
  if (lane < 0 || lane >= props.coilCount) return;
  drag.value = { mode: 'pending', index: lane, x, y, moved: false };
  addWin();
}
function onHandlePointerDown(i: number, e: PointerEvent): void {
  if (!props.editable || e.button !== 0) return;
  const { x, y } = svgPoint(e);
  drag.value = { mode: 'handle', index: i, x, y, moved: false };
  addWin();
}
function onPointerMove(e: PointerEvent): void {
  const d = drag.value;
  if (!d) return;
  const { x, y } = svgPoint(e);
  if (Math.abs(x - d.x) > DRAG_SLOP || Math.abs(y - d.y) > DRAG_SLOP) d.moved = true;
  if (d.mode === 'handle') {
    const ev = props.events[d.index];
    if (!ev) return;
    const next = props.events.slice();
    next[d.index] = { ...ev, atMs: snapTime(xToTime(x)), value: yToValue(ev.coilIndex, y) };
    emit('update:events', next);
  }
}
function onPointerUp(): void {
  const d = drag.value;
  drag.value = null;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  if (d && d.mode === 'pending' && !d.moved) {
    emit('update:events', [...props.events, {
      coilIndex: d.index, param: props.editParam, atMs: snapTime(xToTime(d.x)), value: yToValue(d.index, d.y),
    }]);
  }
}
function removeEvent(i: number, e: Event): void {
  e.preventDefault();
  if (props.editable) emit('update:events', props.events.filter((_, k) => k !== i));
}

const playheadX = computed(() => (props.playheadMs / 1000) * PX_PER_SEC);
const hasData = computed(() => (props.analysis?.notes.length ?? 0) > 0);
const showParam = computed(() => showLanes.value && props.coilCount > 0);

const scrollEl = ref<HTMLElement | null>(null);
watch(() => props.playheadMs, () => {
  if (!props.playing || !scrollEl.value) return;
  const el = scrollEl.value;
  el.scrollLeft = Math.max(0, playheadX.value - el.clientWidth * 0.4);
});
</script>

<template>
  <div class="preview">
    <div class="preview__frame">
      <!-- automation parameter toggle: full width, integrated at the top of the frame -->
      <div v-if="showParam" class="segmented preview__param">
        <button type="button" :class="{ 'is-active': editParam === 'ontime' }" @click="emit('update:editParam', 'ontime')">Ontime</button>
        <button type="button" :class="{ 'is-active': editParam === 'duty' }" @click="emit('update:editParam', 'duty')">Duty</button>
      </div>

      <div ref="bodyEl" class="preview__body">
        <div v-if="hasData && showLanes" class="preview__rail" :class="{ 'is-compact': compact }"
          :style="{ width: railW + 'px', height: heightPx + 'px' }">
          <div class="preview__rail-head" :style="{ height: RULER_H + 'px' }"></div>
          <div v-if="showRoll" class="preview__rail-roll" :style="{ height: rollH + 'px' }"><i class="fas fa-music"></i></div>
          <div v-for="(lane, i) in railLanes" :key="i" class="preview__rail-lane" :style="{ height: laneH + 'px', '--c': lane.color }">
            <span class="preview__rail-dot"></span>
            <span v-if="lane.speaker" class="preview__rail-id"><i class="fas fa-volume-high"></i></span>
            <template v-else-if="compact">
              <span class="preview__rail-cnum">{{ lane.num }}</span>
              <span class="preview__rail-csub">{{ lane.sub }}</span>
            </template>
            <template v-else>
              <span class="preview__rail-id">{{ lane.num }}<span v-if="lane.name" class="preview__rail-name"> · {{ lane.name }}</span></span>
              <span class="preview__rail-sub">{{ lane.sub }}</span>
            </template>
          </div>
        </div>

        <div ref="scrollEl" class="preview__scroll">
          <svg v-if="hasData" ref="svgEl" :width="widthPx" :height="heightPx" class="preview__svg"
            :class="{ 'is-editable': editable && showLanes }" @pointerdown="onSvgPointerDown">
            <defs>
              <pattern v-for="p in patterns" :id="p.id" :key="p.id" patternUnits="userSpaceOnUse"
                :width="p.colors.length * 4" :height="p.colors.length * 4" patternTransform="rotate(45)">
                <rect v-for="(col, k) in p.colors" :key="k" :x="k * 4" :y="0" :width="4" :height="p.colors.length * 4" :fill="col" />
              </pattern>
            </defs>
            <line v-for="(t, i) in timeTicks" :key="`t${i}`" :x1="t.x" :x2="t.x" :y1="RULER_H" :y2="heightPx"
              class="preview__tick" :class="{ 'is-major': t.major }" />
            <text v-for="(t, i) in timeTicks" v-show="t.label" :key="`tl${i}`" :x="t.x + 3" :y="11" class="preview__ticklabel">{{ t.label }}</text>
            <line v-for="(y, i) in octaveLines" :key="`o${i}`" :x1="0" :x2="widthPx" :y1="y" :y2="y" class="preview__grid" />
            <line v-if="view === 'combined'" :x1="0" :x2="widthPx" :y1="lanesTopY" :y2="lanesTopY" class="preview__divider" />
            <line v-for="(y, i) in laneLines" :key="`l${i}`" :x1="0" :x2="widthPx" :y1="y" :y2="y" class="preview__grid" />
            <rect v-for="(r, i) in rects" :key="i" :x="r.x" :y="r.y" :width="r.w" :height="r.h" :fill="r.fill"
              :opacity="r.roll ? 1 : (events.length ? 0.3 : 1)" rx="1.5" />

            <g v-for="a in autoCurves" :key="`a${a.coilIdx}`">
              <line :x1="0" :x2="widthPx" :y1="a.baseY" :y2="a.baseY" class="auto-base" :stroke="a.color" />
              <polyline :points="a.points" class="auto-line" :stroke="a.color" />
            </g>
            <g v-for="h in handles" :key="`h${h.i}`">
              <text v-if="editable" :x="h.cx + 7" :y="h.cy - 5" class="auto-pct" :fill="h.color">{{ h.pct }}%</text>
              <circle :cx="h.cx" :cy="h.cy" :r="editable ? 5 : 3" class="auto-handle" :class="{ 'is-editable': editable }"
                :fill="h.color" @pointerdown.stop="onHandlePointerDown(h.i, $event)" @contextmenu="removeEvent(h.i, $event)" />
            </g>

            <!-- combined editor: only the coil lanes are editable, so the score area keeps the default cursor -->
            <rect v-if="editable && view === 'combined'" :x="0" :y="0" :width="widthPx" :height="lanesTopY"
              class="preview__noedit" />

            <line v-if="playing" class="preview__playhead" :x1="playheadX" :x2="playheadX" :y1="0" :y2="heightPx" />
          </svg>
          <div v-else class="preview__empty">{{ $t('label.noMidiData') }}</div>
        </div>
      </div>
    </div>
    <p v-if="editable && hasData && showLanes" class="preview__hint">{{ $t('label.addEvent') }}</p>
  </div>
</template>

<style scoped>
.preview { display: flex; flex-direction: column; min-height: 0; min-width: 0; flex: 1 1 auto; gap: 0.4rem; }
.preview__frame {
  flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column;
  border: 1px solid var(--line); border-radius: 8px; overflow: hidden;
  background: rgba(255, 255, 255, 0.02);
  user-select: none; -webkit-user-select: none;
}
.preview__param { display: flex; border-radius: 0; border: 0; border-bottom: 1px solid var(--line); background: rgba(0, 0, 0, 0.18); padding: 4px; gap: 4px; flex: 0 0 auto; }
.preview__param button { flex: 1 1 0; padding: 0.35rem; font-size: 0.74rem; }
.preview__body { flex: 1 1 auto; min-height: 100px; display: flex; overflow-y: auto; overflow-x: hidden; }
.preview__scroll { flex: 1 1 auto; min-width: 0; overflow-x: auto; overflow-y: hidden; }
.preview__svg { display: block; }
.preview__svg.is-editable { cursor: crosshair; }
.preview__noedit { fill: transparent; pointer-events: all; cursor: default; }

.preview__rail { flex: 0 0 auto; border-right: 1px solid var(--line); background: rgba(0, 0, 0, 0.18); }
.preview__rail-head { border-bottom: 1px solid var(--line); }
.preview__rail-roll { display: grid; place-items: center; color: var(--text-mute); border-bottom: 1px solid var(--line); }
.preview__rail-lane { display: flex; flex-direction: column; justify-content: center; gap: 1px; padding: 0 0.5rem; position: relative; overflow: hidden; border-bottom: 1px solid var(--line); }
.preview__rail-dot { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--c); box-shadow: 0 0 7px -1px var(--c); }
.preview__rail-id { font-family: var(--font-mono); font-size: 0.74rem; color: var(--text); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.preview__rail-name { color: var(--text-dim); font-weight: 400; }
.preview__rail-sub { font-family: var(--font-mono); font-size: 0.62rem; color: var(--text-mute); white-space: nowrap; }

/* compact rail: narrow column, number on top + ontime/duty written vertically */
.preview__rail.is-compact .preview__rail-lane { align-items: center; padding: 0.2rem 0; gap: 2px; }
.preview__rail-cnum { font-family: var(--font-mono); font-size: 0.74rem; font-weight: 600; color: var(--text); flex: 0 0 auto; }
.preview__rail-csub {
  writing-mode: vertical-rl; transform: rotate(180deg);
  font-family: var(--font-mono); font-size: 0.6rem; color: var(--text-mute);
  white-space: nowrap; overflow: hidden; min-height: 0; flex: 0 1 auto;
}

.preview__grid { stroke: var(--line); stroke-width: 1; opacity: 0.6; }
.preview__divider { stroke: var(--line-strong, var(--line)); stroke-width: 1.5; opacity: 0.9; }
.preview__tick { stroke: var(--line); stroke-width: 1; opacity: 0.3; }
.preview__tick.is-major { opacity: 0.55; }
.preview__ticklabel { fill: var(--text-mute); font-family: var(--font-mono); font-size: 9px; }
.preview__playhead { stroke: var(--volt); stroke-width: 2; filter: drop-shadow(0 0 4px var(--volt)); }
.preview__empty { height: 100%; min-height: 120px; display: grid; place-items: center; color: var(--text-mute); font-family: var(--font-mono); font-size: 0.85rem; }
.preview__hint { margin: 0; font-family: var(--font-mono); font-size: 0.68rem; color: var(--text-mute); }

.auto-base { stroke-width: 1; stroke-dasharray: 3 4; opacity: 0.4; }
.auto-line { fill: none; stroke-width: 2; opacity: 0.95; filter: drop-shadow(0 0 3px rgba(0, 0, 0, 0.4)); }
.auto-pct { font-family: var(--font-mono); font-size: 9px; opacity: 0.9; }
.auto-handle { stroke: #06090f; stroke-width: 1.5; }
.auto-handle.is-editable { cursor: grab; }
.auto-handle.is-editable:hover { stroke: #fff; }
</style>
