<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CoilLimits } from '@/model/devices/coil-limits';
import { BANG_OCD, BANG_STRIKE, type DevSimulation, type LoadMark } from '@/model/devices/simulation';
import { coilColor } from '@/ui/helpers/coil-colors';
import { formatDuration, pctLabel } from '@/utils/format';
import { loadLane, loadLimit, loadMode, type LoadMode } from '@/ui/helpers/load-lane';
import LoadKey from '@/ui/components/player/LoadKey.vue';

/**
 * Each coil along the whole song, as the board plays it (model/devices/simulation):
 * in Duty, the load of its notes against its max duty, hatched where the board
 * reduces them all; in Ontime, its longest pulse against its max ontime,
 * hatched where the demand is cut. Red marks: notes silenced for lack of a voice.
 */
const props = withDefaults(defineProps<{
  sim: DevSimulation | null;
  /** In the simulation's order. */
  coils: { coilIndex: number; name: string; limits: CoilLimits | null }[];
  /** Where the song is heard; null: no playhead. */
  playheadMs?: number | null;
  /** Where the song is heard, read every frame while it plays: `playheadMs` comes a few times a second only. */
  clock?: (() => number) | null;
  playing?: boolean;
  /** Moments a coil card points at (a note's passages), on its lane. */
  marks?: { coilIndex: number; list: LoadMark[] } | null;
  compact?: boolean;
}>(), { playheadMs: null, clock: null, playing: false, marks: null, compact: false });
const { t } = useI18n();
const uid = useId();

// drawn at the plot's own width, so the hatching and the strokes are not stretched
const LABEL_W = 112;
const lanesEl = ref<HTMLElement | null>(null);
const width = ref(600);
let ro: ResizeObserver | null = null;
onMounted(() => {
  if (!lanesEl.value) return;
  width.value = Math.max(100, lanesEl.value.clientWidth - LABEL_W);
  if ('ResizeObserver' in window) {
    ro = new ResizeObserver((entries) => { width.value = Math.max(100, entries[0].contentRect.width - LABEL_W); });
    ro.observe(lanesEl.value);
  }
});
// the lanes share the view's height, never under LANE_H: drawn at their own height too
const plots = ref<HTMLElement[]>([]);
const plotH = ref(0);
let plotRo: ResizeObserver | null = null;
watch(() => plots.value[0], (el) => {
  plotRo?.disconnect();
  if (!el || !('ResizeObserver' in window)) return;
  plotRo = new ResizeObserver((entries) => { plotH.value = Math.round(entries[0].contentRect.height); });
  plotRo.observe(el);
}, { flush: 'post' });
onBeforeUnmount(() => {
  ro?.disconnect();
  plotRo?.disconnect();
});

// the same choice as the Combined view's
const mode = computed(() => loadMode.value);
function setMode(m: LoadMode): void { loadMode.value = m; }

const LANE_H = computed(() => (props.compact ? 44 : 56));
const laneH = computed(() => Math.max(LANE_H.value, plotH.value));

const lanes = computed(() => {
  const sim = props.sim;
  if (!sim?.tracks.length) return [];
  const W = width.value;
  // a coil just added has no track until the simulation catches up
  return props.coils.slice(0, sim.tracks.length).map((c, i) => {
    const limit = loadLimit(mode.value, c.limits);
    const lane = loadLane(sim.tracks[i], mode.value, limit, { width: W, top: 0, height: laneH.value, cols: Math.max(40, Math.floor(W / 3)) });
    const limitLabel = limit == null ? '' : mode.value === 'duty' ? `max ${pctLabel(limit)} %` : `max ${limit} µs`;
    return { ...lane, coilIndex: c.coilIndex, name: c.name, color: coilColor(c.coilIndex), limitLabel };
  });
});

// the physics' keys, once a coil's lane has something to show

const durationMs = computed(() => props.sim?.durationMs ?? 0);
const ticks = computed(() => {
  const d = durationMs.value;
  if (!d) return [];
  return [0, 0.25, 0.5, 0.75, 1].map((f) => ({ pct: f * 100, label: formatDuration(f * d) }));
});
// moved every frame on its own: redrawing the lanes 60 times a second would not keep up
const heads = ref<HTMLElement[]>([]);
let headRaf = 0;
function paintHead(): void {
  const d = durationMs.value;
  if (!d || props.playheadMs == null) return;
  const left = `${Math.min(100, ((props.clock?.() ?? props.playheadMs) / d) * 100)}%`;
  for (const el of heads.value) el.style.left = left;
}
function followClock(): void {
  paintHead();
  headRaf = requestAnimationFrame(followClock);
}
watch(() => props.playing, (playing) => {
  cancelAnimationFrame(headRaf);
  if (playing) followClock();
  else paintHead();
});
watch([() => props.playheadMs, durationMs, () => heads.value.length], () => { if (!props.playing) paintHead(); }, { flush: 'post' });
onMounted(() => { if (props.playing) followClock(); });
onBeforeUnmount(() => cancelAnimationFrame(headRaf));
const markPct = (ms: number): number => (durationMs.value ? (ms / durationMs.value) * 100 : 0);

// the moment under the pointer, on one lane
const hover = ref<{ lane: number; pct: number } | null>(null);
function onMove(lane: number, e: PointerEvent): void {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  hover.value = { lane, pct: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)) };
}
const tip = computed(() => {
  const h = hover.value, sim = props.sim;
  if (!h || !sim) return null;
  const c = props.coils[h.lane];
  const tr = sim.tracks[h.lane];
  const ms = (h.pct / 100) * sim.durationMs;
  const s = sim.stepAt(ms);
  const lines: { text: string; cls?: string }[] = [];
  if (mode.value === 'duty') {
    lines.push({ text: t('ontime.load.tipDuty', { duty: pctLabel(tr.dutyAsked[s]), max: c.limits?.duty != null ? pctLabel(c.limits.duty) : '–' }) });
  } else {
    lines.push({ text: t('ontime.load.tipPulse', { us: Math.round(tr.pulseUs[s]), asked: Math.round(tr.askedUs[s]) }) });
  }
  if (tr.factor[s] < 0.995) lines.push({ text: t('ontime.load.tipReduced', { pct: Math.round((1 - tr.factor[s]) * 100) }), cls: 'is-reduced' });
  if (tr.skipped[s]) {
    lines.push({ text: t('ontime.load.tipSkipped', { n: tr.skipped[s], voices: c.limits?.voices ?? '–' }, tr.skipped[s]), cls: 'is-cut' });
  }
  if (tr.bang[s] === BANG_STRIKE) lines.push({ text: t('ontime.load.tipStrike'), cls: 'is-strike' });
  else if (tr.bang[s] === BANG_OCD) lines.push({ text: t('ontime.load.tipOcd', { us: Math.round(tr.ocdUs[s]) }), cls: 'is-ocd' });
  if (tr.arcM[s] > 0) lines.push({ text: t('ontime.load.tipArc', { m: tr.arcM[s].toFixed(1), kw: (tr.powerW[s] / 1e3).toFixed(1) }) });
  if (tr.silent[s]) lines.push({ text: t('ontime.load.tipSilent'), cls: 'is-short' });
  return { title: `${c.coilIndex} · ${c.name || t('label.coil')} · ${formatDuration(ms)}`, lines, lane: h.lane, pct: h.pct };
});
</script>

<template>
  <div class="cload" :class="{ 'is-compact': compact }" :style="{ '--lane-h': `${LANE_H}px` }">
    <div class="cload__head">
      <div class="segmented cload__mode" role="group" :aria-label="$t('ontime.load.title')">
        <button type="button" :class="{ 'is-active': mode === 'ontime' }" :aria-pressed="mode === 'ontime'"
          @click="setMode('ontime')">{{ $t('ontime.load.ontime') }}</button>
        <button type="button" :class="{ 'is-active': mode === 'duty' }" :aria-pressed="mode === 'duty'"
          @click="setMode('duty')">{{ $t('ontime.load.duty') }}</button>
      </div>
    </div>

    <div ref="lanesEl" class="cload__lanes">
      <svg width="0" height="0" class="cload__defs" aria-hidden="true">
        <defs>
          <pattern :id="`${uid}-hatch`" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect class="cload__hatch-bg" width="6" height="6"></rect>
            <line class="cload__hatch-line" x1="0" y1="0" x2="0" y2="6"></line>
          </pattern>
        </defs>
      </svg>
      <div v-for="(l, i) in lanes" :key="l.coilIndex" class="cload__lane" :style="{ '--c': l.color }">
        <div class="cload__label">
          <b><span class="fiber-cap"><span class="fiber-cap__n">{{ l.coilIndex }}</span></span>{{ l.name }}</b>
          <span>{{ l.limitLabel }}</span>
        </div>
        <div ref="plots" class="cload__plot" @pointermove="onMove(i, $event)" @pointerleave="hover = null">
          <svg :viewBox="`0 0 ${width} ${laneH}`" preserveAspectRatio="none">
            <path class="cload__area" :d="l.area"></path>
            <path class="cload__line" :d="l.line"></path>
            <path v-if="l.over" :d="l.over" :fill="`url(#${uid}-hatch)`" class="cload__over"></path>
            <line v-if="l.capY != null" class="cload__cap" x1="0" :x2="width" :y1="l.capY" :y2="l.capY"></line>
            <path v-if="l.lost" class="cload__lost" :d="l.lost"></path>
            <path v-if="l.ocdOver" class="cload__ocd-over" :d="l.ocdOver"></path>
            <path v-if="l.ocd" class="cload__ocd" :d="l.ocd"></path>
            <path v-if="l.strikes" class="cload__strike" :d="l.strikes"></path>
            <path v-if="l.silent" class="cload__silent" :d="l.silent"></path>
          </svg>
          <template v-if="marks && marks.coilIndex === l.coilIndex">
            <span v-for="(m, k) in marks.list" :key="k" class="cload__mark" :class="`is-${m[1]}`"
              :style="{ left: markPct(m[0]) + '%' }"></span>
          </template>
          <span v-if="hover && hover.lane === i" class="cload__cross" :style="{ left: hover.pct + '%' }"></span>
          <span v-if="playheadMs != null && durationMs" ref="heads" class="cload__playhead"></span>
          <div v-if="tip && tip.lane === i" class="cload__tip" :style="{ '--x': tip.pct + '%' }" role="tooltip">
            <span class="cload__tip-title">{{ tip.title }}</span>
            <span v-for="(ln, k) in tip.lines" :key="k" :class="ln.cls">{{ ln.text }}</span>
          </div>
        </div>
      </div>
      <div class="cload__axis">
        <span></span>
        <div><span v-for="tk in ticks" :key="tk.pct">{{ tk.label }}</span></div>
      </div>
    </div>

    <load-key :mode="mode" :lanes="lanes" />
  </div>
</template>
