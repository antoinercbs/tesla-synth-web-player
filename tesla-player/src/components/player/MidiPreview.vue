<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { coilColor } from '@/ui/coil-colors';
import { useMidiStore } from '@/stores/midi';
import { MAX_RATIO, effectiveRatio, levelSamples } from '@/midi/automation';
import type { CoilConfig, CoilEvent, CoilParam, SongStereo } from '@/types/domain';
import type { MidiAnalysis } from '@/midi/analyze';
import { noteCoilVolumes } from '@/midi/stereo';

const props = withDefaults(defineProps<{
  analysis: MidiAnalysis | null;
  coils: CoilConfig[];
  coilCount: number;
  /** 'roll' = score only, 'lanes' = coils only, 'combined' = score above coils. */
  view: 'roll' | 'lanes' | 'combined';
  output2Mask?: number;
  playheadMs?: number;
  playing?: boolean;
  /** Paused = keep the playhead cursor visible (frozen) but don't auto-scroll. */
  paused?: boolean;
  /** Power automation points (edited in the song editor's section; drawn here). */
  events?: CoilEvent[];
  /** Which coil parameter the lanes show the level of. */
  editParam?: CoilParam;
  /** Compact rail: number + ontime/duty only, no coil name. */
  compact?: boolean;
  /** Spatialisation: the coil lanes then show what each coil actually plays, and how loud. */
  stereo?: SongStereo | null;
}>(), {
  output2Mask: 0, playheadMs: 0, playing: false, paused: false,
  events: () => [], editParam: 'ontime', compact: false,
});

const emit = defineEmits<{
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
const RAIL_W = 104;
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
const MIN_LANE_H = 30;

const avail = computed(() => Math.max(120, containerH.value) - RULER_H);
const rollRow = computed(() => {
  if (!showRoll.value) return 0;
  if (props.view === 'combined') {
    // Combined shares the height between the score (top) and the coil lanes (bottom).
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
const laneH = computed(() => {
  if (!showLanes.value) return 0;
  return Math.max(MIN_LANE_H, (avail.value - rollH.value) / laneCount.value);
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

/** lane = coil index (or the speaker lane's index); -1 for score notes. `alpha` = a coil
 *  playing the note below full volume (spatialisation). */
interface Rect { x: number; y: number; w: number; h: number; fill: string; roll: boolean; lane: number; alpha?: number }
const laneVolumes = computed(() =>
  props.stereo && props.analysis && showLanes.value ? noteCoilVolumes(props.analysis, props.coils, props.stereo) : null);
const rects = computed<Rect[]>(() => {
  const notes = props.analysis?.notes ?? [];
  const h = laneH.value; const rr = rollRow.value; const lt = lanesTopY.value;
  const vols = laneVolumes.value;
  const out: Rect[] = [];
  notes.forEach((n, idx) => {
    const x = (n.startMs / 1000) * PX_PER_SEC;
    const w = Math.max(1.5, ((n.endMs - n.startMs) / 1000) * PX_PER_SEC);
    if (showRoll.value) {
      out.push({ x, w, y: rollTopY + (pitch.value.max - n.note) * rr, h: Math.max(2, rr - 1), fill: rollFill(n.channel), roll: true, lane: -1 });
    }
    if (showLanes.value) {
      if (vols) {
        props.coils.forEach((c, k) => {
          const v = vols[idx][k];
          if (v <= 0.01) return; // out of reach: the coil does not play it
          const lane = c.coilIndex;
          out.push({ x, w, y: lt + lane * h + 3, h: h - 6, fill: coilColor(lane), roll: false, lane, alpha: v < 1 ? 0.25 + 0.75 * v : undefined });
        });
      } else {
        for (const c of coilsForChannel(n.channel)) {
          out.push({ x, w, y: lt + c * h + 3, h: h - 6, fill: coilColor(c), roll: false, lane: c });
        }
      }
      if (inSpeaker(n.channel)) {
        out.push({ x, w, y: lt + speakerLaneIndex.value * h + 3, h: h - 6, fill: SPEAKER, roll: false, lane: speakerLaneIndex.value });
      }
    }
  });
  return out;
});
const rollRects = computed(() => rects.value.filter((r) => r.roll));
const laneRects = computed(() => rects.value.filter((r) => !r.roll));

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

// ---- automation: each coil's effective level (the song's power × its own curve) ----
function timeX(ms: number): number { return (ms / 1000) * PX_PER_SEC; }
const levelCurves = computed(() =>
  Array.from({ length: props.coilCount }, (_, c) => levelSamples(props.events, c, props.editParam, durationMs.value)));
const valueMax = computed(() => {
  let max = MAX_RATIO;
  for (const samples of levelCurves.value) for (const [, v] of samples) max = Math.max(max, v);
  return max * 1.08;
});
function valueY(coilIdx: number, ratio: number): number {
  const top = lanesTopY.value + coilIdx * laneH.value;
  const usable = laneH.value - 2 * AUTO_PAD;
  const frac = Math.max(0, Math.min(1, ratio / valueMax.value));
  return top + AUTO_PAD + (1 - frac) * usable;
}
function levelAtX(c: number, x: number): number {
  return effectiveRatio(props.events, c, props.editParam, (x / PX_PER_SEC) * 1000);
}
function staircase(coilIdx: number): string {
  const samples = levelCurves.value[coilIdx] ?? [];
  const pts = samples.map(([t, v]) => `${timeX(t).toFixed(1)},${valueY(coilIdx, v).toFixed(1)}`);
  pts.push(`${widthPx.value.toFixed(1)},${valueY(coilIdx, levelAtX(coilIdx, widthPx.value)).toFixed(1)}`);
  return pts.join(' ');
}
const autoCurves = computed(() =>
  showLanes.value && showAutomation.value ? Array.from({ length: props.coilCount }, (_, c) => ({
    coilIdx: c, points: staircase(c), baseY: valueY(c, 1), color: coilColor(c),
  })) : []);

// Under automation the blocks are cut at the curve and their rim follows it, so a block's
// height reads as the level; the bare curve only stays visible (faintly) between notes.
const uid = useId();
function laneBottom(c: number): number { return lanesTopY.value + (c + 1) * laneH.value; }
function spansOf(rs: Rect[]): [number, number][] {
  const out: [number, number][] = [];
  for (const r of [...rs].sort((a, b) => a.x - b.x)) {
    const last = out[out.length - 1];
    if (last && r.x <= last[1] + 0.5) last[1] = Math.max(last[1], r.x + r.w);
    else out.push([r.x, r.x + r.w]);
  }
  return out;
}
/** The level curve, drawn only over the given spans. */
function rimPath(c: number, spans: [number, number][]): string {
  const samples = levelCurves.value[c] ?? [];
  let d = '';
  for (const [x0, x1] of spans) {
    d += `M${x0.toFixed(1)},${valueY(c, levelAtX(c, x0)).toFixed(1)}`;
    for (const [t, v] of samples) {
      const x = timeX(t);
      if (x > x0 && x < x1) d += `L${x.toFixed(1)},${valueY(c, v).toFixed(1)}`;
    }
    d += `L${x1.toFixed(1)},${valueY(c, levelAtX(c, x1)).toFixed(1)}`;
  }
  return d;
}
const laneGroups = computed(() => {
  const byLane = new Map<number, Rect[]>();
  for (const r of laneRects.value) {
    const list = byLane.get(r.lane);
    if (list) list.push(r);
    else byLane.set(r.lane, [r]);
  }
  return [...byLane].map(([lane, rs]) => {
    const auto = showAutomation.value && lane < props.coilCount; // the speaker lane has no automation
    const bottom = laneBottom(lane);
    return {
      lane,
      rects: rs,
      clipId: auto ? `${uid}-lvl-${lane}` : '',
      area: auto ? `${staircase(lane)} ${widthPx.value.toFixed(1)},${bottom} 0,${bottom}` : '',
      rim: auto ? rimPath(lane, spansOf(rs)) : '',
    };
  });
});

const playheadX = computed(() => (props.playheadMs / 1000) * PX_PER_SEC);
const hasData = computed(() => (props.analysis?.notes.length ?? 0) > 0);
const hasEvents = computed(() => props.events.length > 0);
// without any automation the curves are flat-line clutter
const showAutomation = computed(() => hasEvents.value);
const showParam = computed(() => showLanes.value && props.coilCount > 0 && showAutomation.value);

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
        <button type="button" :class="{ 'is-active': editParam === 'ontime' }"
          @click="emit('update:editParam', 'ontime')">Ontime</button>
        <button type="button" :class="{ 'is-active': editParam === 'duty' }"
          @click="emit('update:editParam', 'duty')">Duty</button>
      </div>

      <div ref="bodyEl" class="preview__body">
        <div class="preview__inner" :style="{ height: heightPx + 'px' }">
          <div v-if="hasData && showLanes" class="preview__rail" :class="{ 'is-compact': compact }"
            :style="{ width: railW + 'px' }">
            <div class="preview__rail-head" :style="{ height: RULER_H + 'px' }"></div>
            <div v-if="showRoll" class="preview__rail-roll" :style="{ height: rollH + 'px' }"><i
                class="fas fa-music"></i></div>
            <div v-for="(lane, i) in railLanes" :key="i" class="preview__rail-lane"
              :style="{ height: laneH + 'px', '--c': lane.color }">
              <span class="preview__rail-dot"></span>
              <span v-if="lane.speaker" class="preview__rail-id"><i class="fas fa-volume-high"></i></span>
              <template v-else-if="compact">
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
                <template v-for="g in laneGroups" :key="`c${g.lane}`">
                  <clipPath v-if="g.clipId" :id="g.clipId">
                    <polygon :points="g.area" />
                  </clipPath>
                </template>
              </defs>
              <line v-for="(t, i) in timeTicks" :key="`t${i}`" :x1="t.x" :x2="t.x" :y1="RULER_H" :y2="heightPx"
                class="preview__tick" :class="{ 'is-major': t.major }" />
              <text v-for="(t, i) in timeTicks" v-show="t.label" :key="`tl${i}`" :x="t.x + 3" :y="11"
                class="preview__ticklabel">{{ t.label }}</text>
              <line v-for="(y, i) in octaveLines" :key="`o${i}`" :x1="0" :x2="widthPx" :y1="y" :y2="y"
                class="preview__grid" />
              <line v-if="view === 'combined'" :x1="0" :x2="widthPx" :y1="lanesTopY" :y2="lanesTopY"
                class="preview__divider" />
              <line v-for="(y, i) in laneLines" :key="`l${i}`" :x1="0" :x2="widthPx" :y1="y" :y2="y"
                class="preview__grid" />
              <rect v-for="(r, i) in rollRects" :key="`r${i}`" :x="r.x" :y="r.y" :width="r.w" :height="r.h"
                :fill="r.fill" rx="1.5" />
              <!-- opacity on the group, not per block: overlapping notes would stack back up to full colour -->
              <g opacity="0.32">
                <g v-for="g in laneGroups" :key="`g${g.lane}`" :clip-path="g.clipId ? `url(#${g.clipId})` : undefined">
                  <rect v-for="(r, i) in g.rects" :key="i" :x="r.x" :y="r.y" :width="r.w" :height="r.h" :fill="r.fill"
                    :fill-opacity="r.alpha" rx="1.5" />
                </g>
              </g>
              <template v-for="g in laneGroups" :key="`m${g.lane}`">
                <path v-if="g.rim" :d="g.rim" class="lane-rim" :stroke="g.rects[0].fill" />
                <template v-else>
                  <rect v-for="(r, i) in g.rects" :key="i" :x="r.x" :y="r.y" :width="r.w" height="2" :fill="r.fill"
                    rx="1" />
                </template>
              </template>

              <g v-for="a in autoCurves" :key="`a${a.coilIdx}`">
                <line :x1="0" :x2="widthPx" :y1="a.baseY" :y2="a.baseY" class="auto-base" :stroke="a.color" />
                <polyline :points="a.points" class="auto-line" :stroke="a.color" />
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
