<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CoilLimits } from '@/devices/coil-limits';
import { stepAt, type LoadMark, type Simulation } from '@/devices/coil-sim';
import { coilColor } from '@/ui/coil-colors';
import { formatDuration, pctLabel } from '@/utils/format';
import { loadLane, loadLimit, loadMode, type LoadMode } from '@/ui/load-lane';

/**
 * Each coil along the whole song, as the board plays it (devices/coil-sim.ts):
 * in Duty, the load of its notes against its max duty, hatched where the board
 * reduces them all; in Ontime, its longest pulse against its max ontime,
 * hatched where the demand is cut. Red marks: notes silenced for lack of a voice.
 */
const props = withDefaults(defineProps<{
  sim: Simulation | null;
  /** In the simulation's order. */
  coils: { coilIndex: number; name: string; limits: CoilLimits | null }[];
  /** Where the song is heard; null: no playhead. */
  playheadMs?: number | null;
  /** Moments a coil card points at (a note's passages), on its lane. */
  marks?: { coilIndex: number; list: LoadMark[] } | null;
  compact?: boolean;
}>(), { playheadMs: null, marks: null, compact: false });
const { t } = useI18n();
const uid = useId();

// drawn at the plot's own width, so the hatching and the strokes are not stretched
const LABEL_W = 92;
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
onBeforeUnmount(() => ro?.disconnect());

// the same choice as the Combined view's
const mode = computed(() => loadMode.value);
function setMode(m: LoadMode): void { loadMode.value = m; }

const LANE_H = computed(() => (props.compact ? 44 : 56));

const lanes = computed(() => {
  const sim = props.sim;
  if (!sim?.tracks.length) return [];
  const W = width.value;
  return props.coils.map((c, i) => {
    const limit = loadLimit(mode.value, c.limits);
    const lane = loadLane(sim.tracks[i], mode.value, limit, { width: W, top: 0, height: LANE_H.value, cols: Math.max(40, Math.floor(W / 3)) });
    const limitLabel = limit == null ? '' : mode.value === 'duty' ? `max ${pctLabel(limit)} %` : `max ${limit} µs`;
    return { ...lane, coilIndex: c.coilIndex, name: c.name, color: coilColor(c.coilIndex), limitLabel };
  });
});

const durationMs = computed(() => props.sim?.durationMs ?? 0);
const ticks = computed(() => {
  const d = durationMs.value;
  if (!d) return [];
  return [0, 0.25, 0.5, 0.75, 1].map((f) => ({ pct: f * 100, label: formatDuration(f * d) }));
});
const playheadPct = computed(() =>
  props.playheadMs == null || !durationMs.value ? null : Math.min(100, (props.playheadMs / durationMs.value) * 100));
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
  const s = stepAt(sim, ms);
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
  return { title: `${c.coilIndex} · ${c.name || t('label.coil')} · ${formatDuration(ms)}`, lines, lane: h.lane, pct: h.pct };
});
</script>

<template>
  <div class="cload" :class="{ 'is-compact': compact }">
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
          <b>{{ l.coilIndex }}<template v-if="l.name"> · {{ l.name }}</template></b>
          <span>{{ l.limitLabel }}</span>
        </div>
        <div class="cload__plot" @pointermove="onMove(i, $event)" @pointerleave="hover = null">
          <svg :viewBox="`0 0 ${width} ${LANE_H}`" :height="LANE_H" preserveAspectRatio="none">
            <path class="cload__area" :d="l.area"></path>
            <path class="cload__line" :d="l.line"></path>
            <path v-if="l.over" :d="l.over" :fill="`url(#${uid}-hatch)`" class="cload__over"></path>
            <line v-if="l.capY != null" class="cload__cap" x1="0" :x2="width" :y1="l.capY" :y2="l.capY"></line>
            <path v-if="l.lost" class="cload__lost" :d="l.lost"></path>
          </svg>
          <template v-if="marks && marks.coilIndex === l.coilIndex">
            <span v-for="(m, k) in marks.list" :key="k" class="cload__mark" :class="`is-${m[1]}`"
              :style="{ left: markPct(m[0]) + '%' }"></span>
          </template>
          <span v-if="hover && hover.lane === i" class="cload__cross" :style="{ left: hover.pct + '%' }"></span>
          <span v-if="playheadPct != null" class="cload__playhead" :style="{ left: playheadPct + '%' }"></span>
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

    <div class="cload__key">
      <span><span class="cload__sw is-area"></span>{{ mode === 'duty' ? $t('ontime.load.keyDuty') : $t('ontime.load.keyPulse') }}</span>
      <span><span class="cload__sw is-limit"></span>{{ mode === 'duty' ? $t('ontime.load.keyDutyMax') : $t('ontime.load.keyOntimeMax') }}</span>
      <span><span class="cload__sw is-hatch"></span>{{ mode === 'duty' ? $t('ontime.load.keyReduced') : $t('ontime.load.keyCut') }}</span>
      <span><span class="cload__sw is-lost"></span>{{ $t('ontime.load.keySkipped') }}</span>
    </div>
  </div>
</template>
