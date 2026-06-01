<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { coilColor } from '@/ui/coil-colors';
import type { CoilConfig } from '@/types/domain';
import type { MidiAnalysis } from '@/midi/analyze';

const props = withDefaults(defineProps<{
  analysis: MidiAnalysis | null;
  coils: CoilConfig[];
  coilCount: number;
  view: 'roll' | 'lanes';
  /** 16-bit mask of channels mirrored to the 2nd (speaker) output. */
  output2Mask?: number;
  playheadMs?: number;
  playing?: boolean;
}>(), { output2Mask: 0, playheadMs: 0, playing: false });

const SPEAKER = 'var(--plasma)';
function inSpeaker(ch: number): boolean { return (props.output2Mask & (1 << ch)) !== 0; }
const hasSpeaker = computed(() => props.output2Mask !== 0);

const PX_PER_SEC = 60;
const ROLL_ROW = 5; // px per semitone
const LANE_H = 34; // px per coil lane
const RULER_H = 16; // top time-ruler height
const MIN_WIDTH = 600;

const durationMs = computed(() => props.analysis?.durationMs ?? 0);
const widthPx = computed(() => Math.max(MIN_WIDTH, (durationMs.value / 1000) * PX_PER_SEC));

function fmtSec(s: number): string {
  return `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;
}
// vertical time graduations: a tick every second, labelled every `major` seconds
const timeTicks = computed(() => {
  const dur = durationMs.value / 1000;
  if (dur <= 0) return [];
  const major = dur > 150 ? 30 : dur > 60 ? 15 : dur > 20 ? 5 : dur > 6 ? 2 : 1;
  const out: { x: number; label: string; major: boolean }[] = [];
  for (let s = 0; s <= Math.ceil(dur); s++) {
    const isMajor = s % major === 0;
    out.push({ x: s * PX_PER_SEC, label: isMajor ? fmtSec(s) : '', major: isMajor });
  }
  return out;
});

// which coils listen to a given MIDI channel
function coilsForChannel(ch: number): number[] {
  const out: number[] = [];
  for (const c of props.coils) if ((c.channelMask & (1 << ch)) !== 0) out.push(c.coilIndex);
  return out;
}
// every destination a channel reaches: its coil colours + the speaker colour
function destColors(ch: number): string[] {
  const cols = coilsForChannel(ch).map((c) => coilColor(c));
  if (inSpeaker(ch)) cols.push(SPEAKER);
  return cols;
}
function destKey(ch: number): string {
  return coilsForChannel(ch).join('-') + (inSpeaker(ch) ? '-s' : '');
}
/** roll note fill: solid if one destination, grey if none, hatched if ≥2 (coils + speaker) */
function rollFill(ch: number): string {
  const cols = destColors(ch);
  if (cols.length === 0) return 'rgba(150,170,200,0.35)';
  if (cols.length === 1) return cols[0];
  return `url(#hatch-${destKey(ch)})`;
}
// distinct multi-destination hatch patterns needed by the roll
const patterns = computed(() => {
  if (props.view !== 'roll') return [];
  const seen = new Map<string, { id: string; colors: string[] }>();
  for (const n of props.analysis?.notes ?? []) {
    const cols = destColors(n.channel);
    if (cols.length < 2) continue;
    const id = `hatch-${destKey(n.channel)}`;
    if (!seen.has(id)) seen.set(id, { id, colors: cols });
  }
  return [...seen.values()];
});

/* piano-roll geometry */
const pitch = computed(() => {
  const r = props.analysis?.pitchRange ?? { min: 48, max: 72 };
  return { min: r.min - 1, max: r.max + 1 };
});
const rollHeight = computed(() => Math.max(1, pitch.value.max - pitch.value.min + 1) * ROLL_ROW);
// lanes = one per coil, plus a "speakers" lane when the 2nd output is used
const laneCount = computed(() => props.coilCount + (hasSpeaker.value ? 1 : 0));
const speakerLaneIndex = computed(() => (hasSpeaker.value ? props.coilCount : -1));
const lanesHeight = computed(() => Math.max(1, laneCount.value) * LANE_H);
const contentHeight = computed(() => (props.view === 'roll' ? rollHeight.value : lanesHeight.value));
const heightPx = computed(() => RULER_H + contentHeight.value);

interface Rect { x: number; y: number; w: number; h: number; fill: string }
const rects = computed<Rect[]>(() => {
  const notes = props.analysis?.notes ?? [];
  const out: Rect[] = [];
  for (const n of notes) {
    const x = (n.startMs / 1000) * PX_PER_SEC;
    const w = Math.max(1.5, ((n.endMs - n.startMs) / 1000) * PX_PER_SEC);
    if (props.view === 'roll') {
      out.push({ x, w, y: (pitch.value.max - n.note) * ROLL_ROW + RULER_H, h: Math.max(2, ROLL_ROW - 1), fill: rollFill(n.channel) });
    } else {
      for (const c of coilsForChannel(n.channel)) {
        out.push({ x, w, y: c * LANE_H + 3 + RULER_H, h: LANE_H - 6, fill: coilColor(c) });
      }
      if (inSpeaker(n.channel)) {
        out.push({ x, w, y: speakerLaneIndex.value * LANE_H + 3 + RULER_H, h: LANE_H - 6, fill: SPEAKER });
      }
    }
  }
  return out;
});

// faint octave gridlines (roll) at every C
const octaveLines = computed(() => {
  if (props.view !== 'roll') return [];
  const lines: number[] = [];
  for (let n = Math.ceil(pitch.value.min / 12) * 12; n <= pitch.value.max; n += 12) {
    lines.push((pitch.value.max - n) * ROLL_ROW + RULER_H);
  }
  return lines;
});
const laneLines = computed(() =>
  props.view === 'lanes' ? Array.from({ length: laneCount.value }, (_, i) => i * LANE_H + RULER_H) : [],
);

const playheadX = computed(() => (props.playheadMs / 1000) * PX_PER_SEC);

const hasData = computed(() => (props.analysis?.notes.length ?? 0) > 0);

// auto-scroll to keep the playhead in view while playing
const scrollEl = ref<HTMLElement | null>(null);
watch(() => props.playheadMs, () => {
  if (!props.playing || !scrollEl.value) return;
  const el = scrollEl.value;
  const target = playheadX.value - el.clientWidth * 0.4;
  el.scrollLeft = Math.max(0, target);
});
</script>

<template>
  <div class="preview">
    <div ref="scrollEl" class="preview__scroll">
      <svg v-if="hasData" :width="widthPx" :height="heightPx" class="preview__svg">
        <defs>
          <pattern v-for="p in patterns" :id="p.id" :key="p.id" patternUnits="userSpaceOnUse"
            :width="p.colors.length * 4" :height="p.colors.length * 4" patternTransform="rotate(45)">
            <rect v-for="(col, k) in p.colors" :key="k" :x="k * 4" :y="0" :width="4" :height="p.colors.length * 4"
              :fill="col" />
          </pattern>
        </defs>
        <!-- time graduations -->
        <line v-for="(t, i) in timeTicks" :key="`t${i}`" :x1="t.x" :x2="t.x" :y1="RULER_H" :y2="heightPx"
          class="preview__tick" :class="{ 'is-major': t.major }" />
        <text v-for="(t, i) in timeTicks" v-show="t.label" :key="`tl${i}`" :x="t.x + 3" :y="11"
          class="preview__ticklabel">{{ t.label }}</text>
        <line v-for="(y, i) in octaveLines" :key="`o${i}`" :x1="0" :x2="widthPx" :y1="y" :y2="y" class="preview__grid" />
        <line v-for="(y, i) in laneLines" :key="`l${i}`" :x1="0" :x2="widthPx" :y1="y" :y2="y" class="preview__grid" />
        <rect v-for="(r, i) in rects" :key="i" :x="r.x" :y="r.y" :width="r.w" :height="r.h" :fill="r.fill" rx="1.5" />
        <line v-if="playing" class="preview__playhead" :x1="playheadX" :x2="playheadX" :y1="0" :y2="heightPx" />
      </svg>
      <div v-else class="preview__empty">{{ $t('label.noMidiData') }}</div>
    </div>
  </div>
</template>

<style scoped>
.preview { display: flex; flex-direction: column; min-height: 0; min-width: 0; flex: 1 1 auto; gap: 0.4rem; padding: 0.5rem 1rem 0.7rem; }
.preview__time { margin-left: auto; font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-mute); }

.preview__scroll {
  flex: 1 1 auto; min-height: 120px; overflow: auto;
  background: rgba(255, 255, 255, 0.02); border: 1px solid var(--line); border-radius: 8px;
}
.preview__svg { display: block; }
.preview__grid { stroke: var(--line); stroke-width: 1; opacity: 0.6; }
.preview__tick { stroke: var(--line); stroke-width: 1; opacity: 0.3; }
.preview__tick.is-major { opacity: 0.55; }
.preview__ticklabel { fill: var(--text-mute); font-family: var(--font-mono); font-size: 9px; }
.preview__playhead { stroke: var(--volt); stroke-width: 2; filter: drop-shadow(0 0 4px var(--volt)); }
.preview__empty {
  height: 100%; min-height: 120px; display: grid; place-items: center;
  color: var(--text-mute); font-family: var(--font-mono); font-size: 0.85rem;
}
</style>
