<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { coilColor } from '@/ui/coil-colors';
import type { CoilConfig } from '@/types/domain';
import type { MidiAnalysis } from '@/midi/analyze';
import type { CoilLimits } from '@/devices/coil-limits';
import type { Simulation } from '@/devices/coil-sim';
import { loadLane, loadLimit, loadMode, type LoadMode } from '@/ui/load-lane';
import { pctLabel } from '@/utils/format';

const props = withDefaults(defineProps<{
  analysis: MidiAnalysis | null;
  coils: CoilConfig[];
  /** 'roll' = the score; 'combined' = the score above each coil's load, on the same time axis. */
  view: 'roll' | 'combined';
  output2Mask?: number;
  playheadMs?: number;
  playing?: boolean;
  /** Paused = keep the playhead cursor visible (frozen) but don't auto-scroll. */
  paused?: boolean;
  /** Compact rail: the coil's number and its limit only. */
  compact?: boolean;
  /** What the board makes of the song (devices/coil-sim.ts), for the coils' lanes. */
  sim?: Simulation | null;
  /** In the simulation's order. */
  loadCoils?: { coilIndex: number; name: string; limits: CoilLimits | null }[];
}>(), {
  output2Mask: 0, playheadMs: 0, playing: false, paused: false, compact: false, sim: null, loadCoils: () => [],
});

const SPEAKER = 'var(--plasma)';
function inSpeaker(ch: number): boolean { return (props.output2Mask & (1 << ch)) !== 0; }

const PX_PER_SEC = 60;
const RULER_H = 16;
const MIN_WIDTH = 600;
const RAIL_W = 104;
const ROLL_MAX_ROW = 13;
const MIN_LANE_H = 30;

const showLanes = computed(() => props.view === 'combined' && !!props.sim?.tracks.length && props.loadCoils.length > 0);
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
const laneCount = computed(() => (showLanes.value ? props.loadCoils.length : 0));

const avail = computed(() => Math.max(120, containerH.value) - RULER_H);
const rollRow = computed(() => {
  if (showLanes.value) {
    // Combined shares the height between the score (top) and the coils' lanes (bottom).
    // Aim for ~42% for the score, but NEVER take so much that the lanes fall below
    // their minimum — a wide pitch span would otherwise push the lanes off the bottom
    // (cropped, and only reachable by scrolling the score out of view). Reserving the
    // lanes' minimum keeps the whole view fitting the container; the score rows just go
    // thinner (it's an overview — the dedicated Score tab is there for detail).
    const rollBudget = Math.min(avail.value * 0.42, Math.max(0, avail.value - MIN_LANE_H * laneCount.value));
    return Math.min(ROLL_MAX_ROW, rollBudget / pitchSpan.value);
  }
  return Math.max(3, avail.value / pitchSpan.value);
});
const rollH = computed(() => rollRow.value * pitchSpan.value);
const laneH = computed(() => (showLanes.value ? Math.max(MIN_LANE_H, (avail.value - rollH.value) / laneCount.value) : 0));
const lanesH = computed(() => laneH.value * laneCount.value);
const rollTopY = RULER_H;
const lanesTopY = computed(() => RULER_H + rollH.value);
const heightPx = computed(() => RULER_H + rollH.value + lanesH.value);

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
  const seen = new Map<string, { id: string; colors: string[] }>();
  for (const n of props.analysis?.notes ?? []) {
    const cols = destColors(n.channel);
    if (cols.length < 2) continue;
    const id = `hatch-${destKey(n.channel)}`;
    if (!seen.has(id)) seen.set(id, { id, colors: cols });
  }
  return [...seen.values()];
});

const rollRects = computed(() => {
  const rr = rollRow.value;
  return (props.analysis?.notes ?? []).map((n) => ({
    x: (n.startMs / 1000) * PX_PER_SEC,
    w: Math.max(1.5, ((n.endMs - n.startMs) / 1000) * PX_PER_SEC),
    y: rollTopY + (pitch.value.max - n.note) * rr,
    h: Math.max(2, rr - 1),
    fill: rollFill(n.channel),
  }));
});

const octaveLines = computed(() => {
  const lines: number[] = [];
  for (let n = Math.ceil(pitch.value.min / 12) * 12; n <= pitch.value.max; n += 12) {
    lines.push(rollTopY + (pitch.value.max - n) * rollRow.value);
  }
  return lines;
});
const laneLines = computed(() =>
  showLanes.value ? Array.from({ length: laneCount.value + 1 }, (_, i) => lanesTopY.value + i * laneH.value) : []);

// each coil's load, on the score's time axis (the same choice as the Load view)
const mode = computed(() => loadMode.value);
function setMode(m: LoadMode): void { loadMode.value = m; }
const uid = useId();
const lanes = computed(() => {
  const sim = props.sim;
  if (!showLanes.value || !sim) return [];
  const steps = sim.tracks[0].duty.length;
  const width = ((steps * sim.stepMs) / 1000) * PX_PER_SEC;
  return props.loadCoils.map((c, i) => {
    const limit = loadLimit(mode.value, c.limits);
    const box = { width, top: lanesTopY.value + i * laneH.value, height: laneH.value, cols: Math.max(40, Math.floor(width / 3)) };
    return {
      ...loadLane(sim.tracks[i], mode.value, limit, box),
      color: coilColor(c.coilIndex),
      num: String(c.coilIndex),
      name: c.name,
      sub: limit == null ? '' : mode.value === 'duty' ? `max ${pctLabel(limit)} %` : `max ${limit} µs`,
    };
  });
});

const playheadX = computed(() => (props.playheadMs / 1000) * PX_PER_SEC);
const hasData = computed(() => (props.analysis?.notes.length ?? 0) > 0);

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
      <!-- what the coils' lanes show: full width, integrated at the top of the frame -->
      <div v-if="showLanes" class="segmented preview__param" role="group" :aria-label="$t('ontime.load.title')">
        <button type="button" :class="{ 'is-active': mode === 'ontime' }" :aria-pressed="mode === 'ontime'"
          @click="setMode('ontime')">{{ $t('ontime.load.ontime') }}</button>
        <button type="button" :class="{ 'is-active': mode === 'duty' }" :aria-pressed="mode === 'duty'"
          @click="setMode('duty')">{{ $t('ontime.load.duty') }}</button>
      </div>

      <div ref="bodyEl" class="preview__body">
        <div class="preview__inner" :style="{ height: heightPx + 'px' }">
          <div v-if="hasData && showLanes" class="preview__rail" :class="{ 'is-compact': compact }"
            :style="{ width: railW + 'px' }">
            <div class="preview__rail-head" :style="{ height: RULER_H + 'px' }"></div>
            <div class="preview__rail-roll" :style="{ height: rollH + 'px' }"><i class="fas fa-music"></i></div>
            <div v-for="lane in lanes" :key="lane.num" class="preview__rail-lane"
              :style="{ height: laneH + 'px', '--c': lane.color }">
              <span class="preview__rail-dot"></span>
              <template v-if="compact">
                <span class="preview__rail-cnum">{{ lane.num }}</span>
                <span class="preview__rail-csub">{{ lane.sub }}</span>
              </template>
              <template v-else>
                <span class="preview__rail-id">{{ lane.num }}<span v-if="lane.name" class="preview__rail-name"> · {{
                    lane.name }}</span></span>
                <span class="preview__rail-sub">{{ lane.sub }}</span>
              </template>
            </div>
          </div>

          <div ref="scrollEl" class="preview__scroll">
            <svg v-if="hasData" :width="widthPx" :height="heightPx" class="preview__svg">
              <defs>
                <pattern v-for="p in patterns" :id="p.id" :key="p.id" patternUnits="userSpaceOnUse"
                  :width="p.colors.length * 4" :height="p.colors.length * 4" patternTransform="rotate(45)">
                  <rect v-for="(col, k) in p.colors" :key="k" :x="k * 4" :y="0" :width="4" :height="p.colors.length * 4"
                    :fill="col" />
                </pattern>
                <pattern :id="`${uid}-hatch`" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect class="cload__hatch-bg" width="6" height="6"></rect>
                  <line class="cload__hatch-line" x1="0" y1="0" x2="0" y2="6"></line>
                </pattern>
              </defs>
              <line v-for="(t, i) in timeTicks" :key="`t${i}`" :x1="t.x" :x2="t.x" :y1="RULER_H" :y2="heightPx"
                class="preview__tick" :class="{ 'is-major': t.major }" />
              <text v-for="(t, i) in timeTicks" v-show="t.label" :key="`tl${i}`" :x="t.x + 3" :y="11"
                class="preview__ticklabel">{{ t.label }}</text>
              <line v-for="(y, i) in octaveLines" :key="`o${i}`" :x1="0" :x2="widthPx" :y1="y" :y2="y"
                class="preview__grid" />
              <line v-if="showLanes" :x1="0" :x2="widthPx" :y1="lanesTopY" :y2="lanesTopY" class="preview__divider" />
              <line v-for="(y, i) in laneLines" :key="`l${i}`" :x1="0" :x2="widthPx" :y1="y" :y2="y"
                class="preview__grid" />
              <rect v-for="(r, i) in rollRects" :key="`r${i}`" :x="r.x" :y="r.y" :width="r.w" :height="r.h"
                :fill="r.fill" rx="1.5" />
              <g v-for="lane in lanes" :key="`g${lane.num}`" :style="{ '--c': lane.color }">
                <path class="cload__area" :d="lane.area"></path>
                <path class="cload__line" :d="lane.line"></path>
                <path v-if="lane.over" class="cload__over" :d="lane.over" :fill="`url(#${uid}-hatch)`"></path>
                <line v-if="lane.capY != null" class="cload__cap" x1="0" :x2="widthPx" :y1="lane.capY" :y2="lane.capY"></line>
                <path v-if="lane.lost" class="cload__lost" :d="lane.lost"></path>
              </g>

              <line v-if="playing || paused" class="preview__playhead" :x1="playheadX" :x2="playheadX" :y1="0"
                :y2="heightPx" />
            </svg>
            <div v-else class="preview__empty">{{ $t('label.noMidiData') }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
