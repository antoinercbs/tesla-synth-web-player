<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CoilLimits } from '@/devices/coil-limits';
import { fateKind, type LoadMark, type NoteFate } from '@/devices/coil-sim';
import {
  crossoverHz, effectiveOntimeUs, requestedOntimeUs, saturationHz, type CoilDrive,
} from '@/devices/ontime-model';
import { hzLabel, nearestNote, noteFrequency, noteName } from '@/ui/piano-layout';
import { formatDuration, pctLabel } from '@/utils/format';

/**
 * A coil's notes, one column each, on one axis: above, the pulse a lone note
 * fires at full volume (the cap of the coil, its crossover); below, what the
 * song does with them (cut, reduced, untouched), or, without a song, how many
 * notes fit together before the board reduces them all. Hovering a column
 * tells it all, and hands the song's moments to the coil view (`marks`).
 */
const props = defineProps<{
  drive: CoilDrive;
  limits: CoilLimits | null;
  /** The notes drawn, lowest and highest. */
  lo: number;
  hi: number;
  /** The coil's notes in the song (devices/coil-sim.ts); none: the chords that fit. */
  fates?: NoteFate[] | null;
}>();
const emit = defineEmits<{
  /** The moments of the hovered (or pinned) note in the song, null when none. */
  (e: 'marks', marks: LoadMark[] | null): void;
}>();
const { t } = useI18n();
const uid = useId();

// the drawing's frame (viewBox units): the curve, the bars, the notes' names once at the bottom
const L = 36, R = 6, T0 = 16, T1 = 84, B0 = 96, B1 = 158, XL = 169, H = 172;
// drawn at the card's own width, one unit a pixel: a wider card widens the drawing, not its text
const plotEl = ref<HTMLElement | null>(null);
const W = ref(300);
let ro: ResizeObserver | null = null;
onMounted(() => {
  const el = plotEl.value;
  if (!el) return;
  const fit = (w: number): void => { if (w > 0) W.value = Math.max(240, Math.round(w)); };
  fit(el.clientWidth);
  if ('ResizeObserver' in window) {
    ro = new ResizeObserver((entries) => fit(entries[0].contentRect.width));
    ro.observe(el);
  }
});
onBeforeUnmount(() => ro?.disconnect());
const PW = computed(() => W.value - L - R);
const lo = computed(() => props.lo - 1);
const hi = computed(() => props.hi + 1);
const cw = computed(() => PW.value / (hi.value - lo.value + 1));
const xs = (n: number): number => L + (n - lo.value + 0.5) * cw.value;
const edge = (n: number): number => L + (n - lo.value) * cw.value;
const noteOf = (hz: number): number => 69 + 12 * Math.log2(hz / 440);
const notes = computed(() => Array.from({ length: hi.value - lo.value + 1 }, (_, k) => lo.value + k));

const at = (n: number): number => effectiveOntimeUs(props.drive, noteFrequency(n), props.limits);
const maxOn = computed(() => props.limits?.ontimeUs ?? null);
const fb = computed(() => crossoverHz(props.drive));
const nb = computed(() => noteOf(fb.value));
const nbKey = computed(() => nearestNote(fb.value));
const inRange = computed(() => nb.value > lo.value && nb.value < hi.value + 1);
const xb = computed(() => xs(nb.value));
// the first note the cap leaves alone
const firstFree = computed(() => {
  const fs = saturationHz(props.drive, props.limits);
  return fs === Infinity ? hi.value + 1 : Math.ceil(noteOf(Math.max(fs, 1e-9)));
});
const capEdge = computed(() => Math.min(edge(firstFree.value), W.value - R));
const showZone = computed(() => maxOn.value != null && firstFree.value > lo.value);

// ---- above: the pulse of a lone note
const top = computed(() => Math.max(maxOn.value ?? 0, at(props.lo), 1) * 1.22);
const y = (us: number): number => T1 - (Math.min(us, top.value) / top.value) * (T1 - T0);
const grid = computed(() => {
  const step = top.value > 600 ? 200 : top.value > 260 ? 100 : 50;
  const out: number[] = [];
  for (let v = 0; v <= top.value; v += step) out.push(v);
  return out;
});
const curve = computed(() => {
  let d = '';
  for (let n = lo.value - 0.5; n <= hi.value + 0.5 + 1e-9; n += 0.25) d += `${d ? 'L' : 'M'}${xs(n).toFixed(1)} ${y(at(n)).toFixed(1)}`;
  return d;
});
const wash = computed(() => `${curve.value} L${xs(hi.value + 0.5)} ${T1} L${xs(lo.value - 0.5)} ${T1} Z`);
const capOnRight = computed(() => !(inRange.value && xb.value > L + PW.value / 2));
const endValue = computed(() => {
  const v = at(props.hi);
  return maxOn.value != null && Math.abs(v - maxOn.value) <= 1 ? null : { x: xs(props.hi), y: y(v) - 5, v: Math.round(v) };
});
// the curve's key, on the side the crossover leaves free
const keyX = computed(() => {
  const KW = 96;
  if (!inRange.value || xb.value - 48 > L + KW + 6) return L;
  if (xb.value + 46 < W.value - R - KW - 6) return W.value - R - KW;
  return null;
});

// ---- below: the song's notes, or the chords that fit
const byNote = computed(() => {
  const out = new Map<number, { cut: NoteFate[]; reduced: NoteFate[]; ok: NoteFate[] }>();
  for (const f of props.fates ?? []) {
    let b = out.get(f.note.note);
    if (!b) out.set(f.note.note, (b = { cut: [], reduced: [], ok: [] }));
    b[fateKind(f)].push(f);
  }
  return out;
});
const song = computed(() => !!props.fates);
const maxCount = computed(() => {
  let m = 1;
  for (const b of byNote.value.values()) m = Math.max(m, b.cut.length + b.reduced.length + b.ok.length);
  return m;
});
const bars = computed(() => {
  const hb = (v: number): number => (v / maxCount.value) * (B1 - B0);
  const out: { x: number; y: number; w: number; h: number; cls: string }[] = [];
  for (const [n, b] of byNote.value) {
    let v = 0;
    for (const [cls, k] of [['is-cut', b.cut.length], ['is-reduced', b.reduced.length], ['is-ok', b.ok.length]] as const) {
      if (!k) continue;
      out.push({ x: edge(n) + 0.6, y: B1 - hb(v + k), w: Math.max(1, cw.value - 1.2), h: Math.max(1, hb(k) - (v ? 1 : 0)), cls });
      v += k;
    }
  }
  return out;
});
const totals = computed(() => {
  const s = { cut: 0, reduced: 0, ok: 0 };
  for (const b of byNote.value.values()) { s.cut += b.cut.length; s.reduced += b.reduced.length; s.ok += b.ok.length; }
  return s;
});
const fileVolume = computed(() => {
  const v = (props.fates ?? []).reduce((m, f) => Math.min(m, f.note.volume), 1);
  return v < 1 ? Math.round(v * 100) : null;
});
/** How many notes at full volume fit together at note `n` before the max duty reduces them all. */
function fit(n: number): { ok: number; byVoices: boolean; one: number } | null {
  const maxDuty = props.limits?.duty;
  const voices = props.limits?.voices ?? Infinity;
  if (maxDuty == null && voices === Infinity) return null;
  const f = noteFrequency(n);
  const one = (at(n) * f) / 1e6;
  const byDuty = maxDuty == null || one <= 0 ? Infinity : Math.floor(maxDuty / one + 1e-9);
  return { ok: Math.min(byDuty, voices), byVoices: voices <= byDuty, one };
}
const chords = computed(() => {
  if (song.value) return [];
  const out: { x: number; heads: number[]; last: number; lost: boolean; n: number }[] = [];
  for (let n = Math.ceil(lo.value / 12) * 12; n <= hi.value; n += 12) {
    const c = fit(n);
    if (!c) continue;
    const shown = Math.min(c.ok, 7);
    out.push({
      x: xs(n), n: c.ok, lost: c.byVoices,
      heads: Array.from({ length: shown }, (_, k) => B1 - 4 - k * 6.6),
      last: B1 - 4 - shown * 6.6,
    });
  }
  return out;
});

// ---- the axis: the C of every octave, the crossover note in bold
const ticks = computed(() => notes.value.filter((n) => n % 12 === 0 && !(inRange.value && Math.abs(n - nbKey.value) <= 4)));

// ---- one tooltip per column
const hover = ref<number | null>(null);
const pinned = ref<number | null>(null);
function marksOf(n: number): LoadMark[] | null {
  const b = byNote.value.get(n);
  if (!b) return null;
  return (['cut', 'reduced', 'ok'] as const).flatMap((k) => b[k].map((f): LoadMark => [f.note.startMs, k]));
}
function enter(n: number): void {
  hover.value = n;
  if (song.value) emit('marks', marksOf(n));
}
function leave(): void {
  hover.value = null;
  if (song.value) emit('marks', pinned.value != null ? marksOf(pinned.value) : null);
}
function pin(n: number): void {
  pinned.value = pinned.value === n ? null : n;
  if (song.value) emit('marks', pinned.value != null ? marksOf(pinned.value) : null);
}
const times = (list: NoteFate[]): string => {
  const all = [...list].sort((a, b) => a.note.startMs - b.note.startMs).map((f) => formatDuration(f.note.startMs));
  return all.slice(0, 6).join(', ') + (all.length > 6 ? ` … (+${all.length - 6})` : '');
};
const tip = computed(() => {
  const n = hover.value;
  if (n == null) return null;
  const f = noteFrequency(n);
  const asked = requestedOntimeUs(props.drive, f);
  const by = f >= fb.value ? t('ontime.treble') : t('ontime.bass');
  const us = Math.round(at(n));
  const lines: { text: string; cls?: string }[] = [{
    text: maxOn.value != null && us >= maxOn.value && asked > maxOn.value
      ? t('ontime.fig.aloneCapped', { us, asked: Math.round(asked), by })
      : t('ontime.fig.alone', { us, by }),
  }];
  if (song.value) {
    const b = byNote.value.get(n);
    if (!b) lines.push({ text: t('ontime.fig.notPlayed') });
    else {
      lines.push({ text: t('ontime.fig.played', { n: b.cut.length + b.reduced.length + b.ok.length }) });
      if (b.cut.length) lines.push({ text: t('ontime.fig.tipCut', { n: b.cut.length, times: times(b.cut) }, b.cut.length), cls: 'is-cut' });
      if (b.reduced.length) {
        const pct = Math.round((1 - Math.min(...b.reduced.map((x) => x.minFactor))) * 100);
        lines.push({ text: t('ontime.fig.tipReduced', { n: b.reduced.length, pct, times: times(b.reduced) }, b.reduced.length), cls: 'is-reduced' });
      }
      if (b.ok.length) lines.push({ text: t('ontime.fig.tipOk', { n: b.ok.length }, b.ok.length) });
    }
  } else {
    const c = fit(n);
    if (c && props.limits?.duty != null) {
      const named = { one: pctLabel(c.one), max: pctLabel(props.limits.duty), n: c.ok };
      lines.push({ text: t(c.byVoices ? 'ontime.fig.tipChordVoices' : 'ontime.fig.tipChord', named) });
    }
  }
  return { title: `${noteName(n)} · ${hzLabel(f)}`, lines, left: (xs(n) / W.value) * 100 };
});
</script>

<template>
  <div class="cfig">
    <div ref="plotEl" class="cfig__plot">
      <svg :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="$t('ontime.fig.label')">
        <defs>
          <pattern :id="`${uid}-hatch`" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect class="cfig__hatch-bg" width="6" height="6"></rect>
            <line class="cfig__hatch-line" x1="0" y1="0" x2="0" y2="6"></line>
          </pattern>
        </defs>

        <!-- above: the pulse of a lone note at full volume -->
        <g class="cfig__grid">
          <template v-for="v in grid" :key="v">
            <line :x1="L" :x2="W - R" :y1="y(v)" :y2="y(v)"></line>
            <text class="cfig__ax" :x="L - 4" :y="y(v) + 3" text-anchor="end">{{ v }}</text>
          </template>
        </g>
        <text class="cfig__vt" :transform="`rotate(-90 9 ${(T0 + T1) / 2})`" x="9" :y="(T0 + T1) / 2 + 3" text-anchor="middle">{{
          $t('ontime.fig.ontimeAxis') }} <tspan class="cfig__vt-u">(µs)</tspan></text>
        <rect v-if="showZone" :x="L" :y="T0" :width="capEdge - L" :height="T1 - T0" :fill="`url(#${uid}-hatch)`"></rect>
        <path class="cfig__wash" :d="wash"></path>
        <line v-if="maxOn != null" class="cfig__cap" :x1="L" :x2="W - R" :y1="y(maxOn)" :y2="y(maxOn)"></line>
        <path class="cfig__curve" :d="curve"></path>
        <text v-if="maxOn != null" class="cfig__lab" :x="capOnRight ? W - R : L + 3" :y="y(maxOn) - 4"
          :text-anchor="capOnRight ? 'end' : 'start'">{{ $t('ontime.fig.maxCoil') }} <tspan class="cfig__val">{{ maxOn }}</tspan></text>
        <text v-if="showZone && firstFree > lo + 1" class="cfig__lab" :x="L + 3" :y="T1 - 5">{{ $t('ontime.fig.capped') }}</text>
        <text v-if="endValue" class="cfig__val" :x="endValue.x" :y="endValue.y" text-anchor="end">{{ endValue.v }}</text>
        <template v-if="keyX != null">
          <line class="cfig__keyline" :x1="keyX" :x2="keyX + 12" :y1="T0 - 8" :y2="T0 - 8"></line>
          <text class="cfig__side" :x="keyX + 16" :y="T0 - 5">{{ $t('ontime.fig.key') }}</text>
        </template>

        <!-- below: what the song does with them, or the chords that fit -->
        <template v-if="song">
          <line class="cfig__gridline" :x1="L" :x2="W - R" :y1="B0" :y2="B0"></line>
          <rect v-for="(b, i) in bars" :key="i" class="cfig__bar" :class="b.cls" :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="0.8"></rect>
          <text class="cfig__ax" :x="L - 4" :y="B0 + 3" text-anchor="end">{{ maxCount }}</text>
          <text class="cfig__ax" :x="L - 4" :y="B1" text-anchor="end">0</text>
          <text class="cfig__vt" :transform="`rotate(-90 9 ${(B0 + B1) / 2})`" x="9" :y="(B0 + B1) / 2 + 3"
            text-anchor="middle">{{ $t('ontime.fig.playedAxis') }} <tspan class="cfig__vt-u">({{ $t('ontime.fig.playedUnit') }})</tspan></text>
          <text v-if="fileVolume != null" class="cfig__lab" :x="W - R" :y="B0 + 9" text-anchor="end">{{
            $t('ontime.fig.fileVolume') }} <tspan class="cfig__val">{{ fileVolume }} %</tspan><title>{{
            $t('ontime.fig.fileVolumeHint') }}</title></text>
        </template>
        <template v-else>
          <g v-for="c in chords" :key="c.x">
            <ellipse v-for="(cy, k) in c.heads" :key="k" class="cfig__nh" :cx="c.x" :cy="cy" rx="4.4" ry="3.1"
              :transform="`rotate(-20 ${c.x} ${cy})`"></ellipse>
            <ellipse :class="c.lost ? 'cfig__nh-lost' : 'cfig__nh-cut'" :fill="c.lost ? undefined : `url(#${uid}-hatch)`"
              :cx="c.x" :cy="c.last" rx="4.4" ry="3.1" :transform="`rotate(-20 ${c.x} ${c.last})`"></ellipse>
            <text class="cfig__num" :x="c.x" :y="c.last - 6" text-anchor="middle">{{ c.n }}</text>
          </g>
          <text v-if="chords.length" class="cfig__vt" :transform="`rotate(-90 9 ${(B0 + B1) / 2})`" x="9"
            :y="(B0 + B1) / 2 + 3" text-anchor="middle">{{ $t('ontime.fig.chordAxis') }} <tspan class="cfig__vt-u">({{
            $t('ontime.fig.chordUnit') }})</tspan></text>
        </template>

        <!-- the notes' axis, once; the crossover through both drawings -->
        <line class="cfig__base" :x1="L" :x2="W - R" :y1="B1" :y2="B1"></line>
        <template v-for="n in ticks" :key="`t${n}`">
          <line class="cfig__tick" :x1="xs(n)" :x2="xs(n)" :y1="B1" :y2="B1 + 3"></line>
          <text class="cfig__ax" :x="xs(n)" :y="XL" text-anchor="middle">{{ noteName(n) }}</text>
        </template>
        <template v-if="inRange">
          <line class="cfig__xo" :x1="xb" :x2="xb" :y1="T0" :y2="B1 + 3"></line>
          <text class="cfig__side" :x="xb - 4" :y="T0 - 5" text-anchor="end">{{ $t('ontime.fig.bass') }}</text>
          <text class="cfig__side" :x="xb + 4" :y="T0 - 5">{{ $t('ontime.fig.treble') }}</text>
          <text class="cfig__xoname" :x="xb" :y="XL" text-anchor="middle">{{ noteName(nbKey) }}</text>
        </template>
        <text v-else class="cfig__side" :x="W - R" :y="T0 - 5" text-anchor="end">{{
          $t(nb <= lo ? 'ontime.fig.allTreble' : 'ontime.fig.allBass', { note: noteName(nbKey) }) }}</text>

        <!-- the columns -->
        <rect v-if="hover != null" class="cfig__col" :x="edge(hover)" :y="T0 - 2" :width="cw" :height="B1 - T0 + 4"></rect>
        <rect v-for="n in notes" :key="`h${n}`" class="cfig__hit" :class="{ 'is-pinned': pinned === n }" :x="edge(n)"
          :y="T0 - 4" :width="cw" :height="B1 - T0 + 8" @pointerenter="enter(n)" @pointerleave="leave" @click="pin(n)"></rect>
      </svg>
      <div v-if="tip" class="cfig__tip" :style="{ '--x': tip.left + '%' }" role="tooltip">
        <span class="cfig__tip-title">{{ tip.title }}</span>
        <span v-for="(l, i) in tip.lines" :key="i" :class="l.cls">{{ l.text }}</span>
      </div>
    </div>
    <div class="cfig__key">
      <span v-if="keyX == null"><span class="cfig__sw-line"></span>{{ $t('ontime.fig.key') }}</span>
      <template v-if="song">
        <span :title="$t('ontime.fig.cutHint')"><span class="cfig__sw is-cut"></span><b>{{ totals.cut }}</b> {{ $t('ontime.fig.cut') }}</span>
        <span :title="$t('ontime.fig.reducedHint')"><span class="cfig__sw is-reduced"></span><b>{{ totals.reduced }}</b> {{
          $t('ontime.fig.reduced') }}</span>
        <span><span class="cfig__sw is-ok"></span><b>{{ totals.ok }}</b> {{ $t('ontime.fig.ok') }}</span>
      </template>
      <template v-else-if="chords.length">
        <span><span class="cfig__nhsw"></span>{{ $t('ontime.fig.pass') }}</span>
        <span><span class="cfig__nhsw is-cut"></span>{{ $t('ontime.fig.allReduce') }}</span>
        <span><span class="cfig__nhsw is-lost"></span>{{ $t('ontime.fig.pastVoices') }}</span>
      </template>
    </div>
  </div>
</template>
