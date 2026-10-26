<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CoilLimits } from '@/model/devices/coil-limits';
import { FATE_KINDS, type DevNoteFate, type FateKind, type LoadMark } from '@/model/devices/simulation';
import type { CoilResponse } from '@/model/coils/response';
import { DevOutput, type CoilDrive } from '@/model/devices/output';
import { MidNote } from '@/model/midi/note';
import { formatDuration, pctLabel } from '@/utils/format';

/**
 * A coil's pulse by note, in µs: the bold curve is a lone note at
 * full velocity; the bass follow the duty's slope (ontime = duty ÷ frequency),
 * the treble its floor (the ontime), the higher of the two under the max
 * ontime. Behind, what the physics says of a pulse there (its arcs strike the
 * ground, or none starts) and the sheet's limits, padlocked. The song's notes
 * are dots at the pulse each really fired (its velocity, the chords, the
 * limits), in the colour of their fate; without a song, how many notes fit
 * together. `editable`: the slope, the floor and the crossover are dragged
 * (`update:drive`). Hovering a column tells it all, and hands the song's moments
 * to the coil view (`marks`).
 */
const props = defineProps<{
  drive: CoilDrive;
  limits: CoilLimits | null;
  /** The notes drawn, lowest and highest. */
  lo: number;
  hi: number;
  /** The coil's notes in the song (model/devices/simulation); none: the chords that fit. */
  fates?: DevNoteFate[] | null;
  /** The coil's physics, from its sheet; none: no sheet. */
  physics?: CoilResponse | null;
  editable?: boolean;
}>();
const emit = defineEmits<{
  /** The moments of the hovered (or pinned) note in the song, null when none. */
  (e: 'marks', marks: LoadMark[] | null): void;
  (e: 'update:drive', drive: CoilDrive): void;
}>();
const { t } = useI18n();
const uid = useId();

// the frame (viewBox units, one a pixel): the plot, without a song the chords under
// it, the notes' names at the bottom
const L = 38, R = 8, T0 = 16, T1 = 190;
const song = computed(() => !!props.fates);
const AX = computed(() => (song.value ? T1 + 6 : T1 + 74));
const XL = computed(() => AX.value + 12);
const H = computed(() => AX.value + 16);
const B0 = T1 + 14;
const B1 = computed(() => AX.value - 2);

const plotEl = ref<HTMLElement | null>(null);
const svgEl = ref<SVGSVGElement | null>(null);
const W = ref(300);
let ro: ResizeObserver | null = null;
onMounted(() => {
  const el = plotEl.value;
  if (!el) return;
  const fit = (w: number): void => { if (w > 0) W.value = Math.max(220, Math.round(w)); };
  fit(el.clientWidth);
  if ('ResizeObserver' in window) {
    ro = new ResizeObserver((entries) => fit(entries[0].contentRect.width));
    ro.observe(el);
  }
});
onBeforeUnmount(() => ro?.disconnect());

/* ---------------------------------------------------------------- the notes */
const lo = computed(() => props.lo - 1);
const hi = computed(() => props.hi + 1);
const cw = computed(() => (W.value - L - R) / (hi.value - lo.value + 1));
const xs = (n: number): number => L + (n - lo.value + 0.5) * cw.value;
const edge = (n: number): number => L + (n - lo.value) * cw.value;
const nAt = (x: number): number => lo.value + (x - L) / cw.value - 0.5;
const noteOf = (hz: number): number => 69 + 12 * Math.log2(hz / 440);
const notes = computed(() => Array.from({ length: hi.value - lo.value + 1 }, (_, k) => lo.value + k));
const fb = computed(() => new DevOutput(props.drive).crossoverHz);
const nb = computed(() => noteOf(fb.value));
const nbKey = computed(() => MidNote.nearest(fb.value));
const inRange = computed(() => nb.value > lo.value && nb.value < hi.value + 1);
const xb = computed(() => xs(nb.value));

/* ----------------------------------------------------------------- the µs */
const at = (n: number): number => new DevOutput(props.drive, props.limits).effective(MidNote.hz(n));
const maxOn = computed(() => props.limits?.ontimeUs ?? null);
const maxDuty = computed(() => props.limits?.duty ?? null);
const minOn = computed(() => props.limits?.minOntimeUs ?? 0);
// the scale holds still while a handle is dragged: it would slide under the hand
const heldTop = ref<number | null>(null);
const yTop = computed(() => heldTop.value ?? Math.max(maxOn.value ?? 0, props.drive.ontimeUs + minOn.value, at(props.lo), 20) * 1.25);
const y = (us: number): number => T1 - (Math.min(Math.max(us, 0), yTop.value) / yTop.value) * (T1 - T0);
const usAt = (py: number): number => ((T1 - py) / (T1 - T0)) * yTop.value;
const grid = computed(() => {
  const step = yTop.value > 600 ? 200 : yTop.value > 260 ? 100 : yTop.value > 120 ? 50 : 20;
  const out: number[] = [];
  for (let v = 0; v <= yTop.value; v += step) out.push(v);
  return out;
});
// the floor: no note fires shorter (the min ontime added); the curve
const floorUs = computed(() => Math.min(props.drive.ontimeUs + minOn.value, maxOn.value ?? Infinity));
const STEP = 0.25;
function pathOf(of: (n: number) => number, clip = true): string {
  let d = '', on = false;
  for (let n = lo.value - 0.5; n <= hi.value + 0.5 + 1e-9; n += STEP) {
    const us = of(n);
    if (!Number.isFinite(us) || (clip && us > yTop.value)) { on = false; continue; }
    d += `${on ? 'L' : 'M'}${xs(n).toFixed(1)} ${y(us).toFixed(1)}`;
    on = true;
  }
  return d;
}
const curve = computed(() => pathOf(at, false));
const slope = computed(() => pathOf((n) => minOn.value + (props.drive.duty * 1e6) / MidNote.hz(n)));
const dutyMaxLine = computed(() => (maxDuty.value != null ? pathOf((n) => (maxDuty.value! * 1e6) / MidNote.hz(n)) : ''));
const dutyMaxLabel = computed(() => {
  if (maxDuty.value == null) return null;
  for (let n = lo.value; n <= hi.value; n++) {
    const us = (maxDuty.value * 1e6) / MidNote.hz(n);
    if (us <= yTop.value) return { x: xs(n) + 4, y: Math.min(y(us) + 11, T1 - 4) };
  }
  return null;
});

/* ------------------------------------------------- what the physics says */
// a zone between a threshold by note and an edge of the plot: above (strike) or below (no arc)
function zoneOf(of: (hz: number) => number, toTop: boolean): string {
  let d = '';
  for (let n = lo.value - 0.5; n <= hi.value + 0.5 + 1e-9; n += STEP) {
    const us = of(MidNote.hz(n));
    const yy = Number.isFinite(us) ? y(us) : toTop ? T0 : T1;
    d += `${d ? 'L' : 'M'}${xs(n).toFixed(1)} ${yy.toFixed(1)}`;
  }
  const edgeY = toTop ? T0 : T1;
  return `${d} L${xs(hi.value + 0.5).toFixed(1)} ${edgeY} L${xs(lo.value - 0.5).toFixed(1)} ${edgeY} Z`;
}
const strikeZone = computed(() => (props.physics ? zoneOf(props.physics.strikeFrom, true) : ''));
const arcZone = computed(() => (props.physics ? zoneOf(props.physics.arcFrom, false) : ''));
// the OCD in the air only: where it trips because the arcs strike, the strike's zone says it
const ocdInAir = (hz: number): number => {
  const p = props.physics!, ocd = p.ocdFrom(hz);
  return ocd < p.strikeFrom(hz) - 0.5 ? ocd : Infinity;
};
const ocdLine = computed(() => (props.physics ? pathOf((n) => ocdInAir(MidNote.hz(n))) : ''));
// what is sent past it is spent for nothing: from the OCD up to where the arcs strike (or the top)
const ocdZone = computed(() => {
  if (!ocdLine.value) return '';
  const p = props.physics!;
  const lower: string[] = [], upper: string[] = [];
  for (let n = lo.value - 0.5; n <= hi.value + 0.5 + 1e-9; n += STEP) {
    const hz = MidNote.hz(n), strike = p.strikeFrom(hz), ocd = ocdInAir(hz);
    const top = Number.isFinite(strike) ? y(strike) : T0;
    const x = xs(n).toFixed(1);
    lower.push(`${x} ${(Number.isFinite(ocd) ? y(ocd) : top).toFixed(1)}`);
    upper.push(`${x} ${top.toFixed(1)}`);
  }
  return `M${lower.join(' L')} L${upper.reverse().join(' L')} Z`;
});
function lowest(of: (hz: number) => number): { x: number; y: number } | null {
  let best: { x: number; y: number; us: number } | null = null;
  for (let n = lo.value; n <= hi.value; n++) {
    const us = of(MidNote.hz(n));
    if (Number.isFinite(us) && us <= yTop.value && (!best || us < best.us)) best = { x: xs(n), y: y(us), us };
  }
  return best;
}
const strikeLabel = computed(() => {
  const p = props.physics && lowest(props.physics.strikeFrom);
  return p ? { x: Math.max(L + 14, p.x), y: Math.max(T0 + 9, p.y - 4) } : null;
});
const arcLabel = computed(() => {
  if (!props.physics) return null;
  const us = props.physics.arcFrom(MidNote.hz(props.hi));
  return Number.isFinite(us) && us <= yTop.value ? { x: W.value - R - 2, y: y(us) - 3 } : null;
});
const ocdLabel = computed(() => {
  const p = props.physics && ocdLine.value ? lowest(ocdInAir) : null;
  return p ? { x: p.x, y: p.y - 4 } : null;
});

/* ----------------------------------------------------------- the song's notes */
type Buckets = Record<FateKind, DevNoteFate[]>;
const empty = (): Buckets => ({ cut: [], short: [], strike: [], ocd: [], reduced: [], ok: [] });
const byNote = computed(() => {
  const out = new Map<number, Buckets>();
  for (const f of props.fates ?? []) {
    let b = out.get(f.note.note);
    if (!b) out.set(f.note.note, (b = empty()));
    b[f.kind].push(f);
  }
  return out;
});
const countOf = (b: Buckets): number => FATE_KINDS.reduce((n, k) => n + b[k].length, 0);
// a dot per note: a pitch's notes spread across its column in the song's order, see-through
// so that where they pile up shows
const dots = computed(() => {
  const r = Math.max(1, Math.min(2, cw.value * 0.12));
  const width = Math.max(0, cw.value - 2 * r - 1);
  const out: { x: number; y: number; r: number; kind: FateKind }[] = [];
  for (const [n, b] of byNote.value) {
    const list = FATE_KINDS.flatMap((k) => b[k]).sort((p, q) => p.note.startMs - q.note.startMs);
    list.forEach((f, k) => out.push({
      x: xs(n) + (list.length > 1 ? (k / (list.length - 1) - 0.5) * width : 0),
      y: y(f.peakUs),
      r,
      kind: f.kind,
    }));
  }
  return out;
});
const totals = computed(() => {
  const s: Record<FateKind, number> = { cut: 0, short: 0, strike: 0, ocd: 0, reduced: 0, ok: 0 };
  for (const b of byNote.value.values()) for (const k of FATE_KINDS) s[k] += b[k].length;
  return s;
});
const fileVolume = computed(() => {
  const v = (props.fates ?? []).reduce((m, f) => Math.min(m, f.note.volume), 1);
  return v < 1 ? Math.round(v * 100) : null;
});

/* ------------------------------------------- without a song: the chords that fit */
function fit(n: number): { ok: number; byVoices: boolean; one: number } | null {
  const voices = props.limits?.voices ?? Infinity;
  if (maxDuty.value == null && voices === Infinity) return null;
  const f = MidNote.hz(n);
  const one = (at(n) * f) / 1e6;
  const byDuty = maxDuty.value == null || one <= 0 ? Infinity : Math.floor(maxDuty.value / one + 1e-9);
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
      heads: Array.from({ length: shown }, (_, k) => B1.value - 4 - k * 6.6),
      last: B1.value - 4 - shown * 6.6,
    });
  }
  return out;
});

/* -------------------------------------------------------------- the axis */
const ticks = computed(() => notes.value.filter((n) => n % 12 === 0 && Math.abs(xs(n) - splitX.value) > 30));
const splitX = computed(() => Math.min(Math.max(xb.value, L + 24), W.value - R - 24));
const splitLabel = computed(() => `${nb.value <= lo.value ? '◂ ' : ''}${MidNote.name(nbKey.value)}${nb.value >= hi.value + 1 ? ' ▸' : ''}`);

/* ----------------------------------------------------------- the handles */
const nSlope = computed(() => lo.value + 0.14 * (hi.value - lo.value));
const clampY = (v: number): number => Math.min(Math.max(v, T0 + 9), T1 - 9);
const pillW = (text: string): number => text.length * 5.6 + 16;
const slopePill = computed(() => {
  const text = `${t('ontime.fig.bassShort')} ${pctLabel(props.drive.duty)} %`, w = pillW(text);
  const x = Math.min(Math.max(xs(nSlope.value), L + w / 2 + 2), W.value - R - w / 2 - 2);
  return { x, y: clampY(y(minOn.value + (props.drive.duty * 1e6) / MidNote.hz(nSlope.value))), w, text };
});
const floorPill = computed(() => {
  const text = `${t('ontime.fig.trebleShort')} ${Math.round(props.drive.ontimeUs)} µs`, w = pillW(text);
  return { x: W.value - R - w / 2 - 4, y: clampY(y(floorUs.value)), w, text };
});

type Handle = 'slope' | 'floor' | 'knee' | 'split';
let drag: { h: Handle; x: number; y: number; on: number; duty: number; n: number; pinned: boolean } | null = null;
const dragging = ref<Handle | null>(null);
function point(e: PointerEvent): { x: number; y: number } {
  const r = svgEl.value!.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (W.value / r.width), y: (e.clientY - r.top) * (H.value / r.height) };
}
function grab(h: Handle, e: PointerEvent): void {
  if (!props.editable || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  svgEl.value?.setPointerCapture(e.pointerId);
  const first = Math.ceil(nb.value - 1e-6);
  drag = { h, ...point(e), on: props.drive.ontimeUs, duty: props.drive.duty, n: first, pinned: first < lo.value || first > hi.value + 1 };
  dragging.value = h;
  heldTop.value = yTop.value;
}
const dutyAt = (on: number, n: number): number => Math.min(1, Math.max(0.0005, Math.round(((on * MidNote.hz(n - 0.02)) / 1e6) * 1e5) / 1e5));
function move(e: PointerEvent): void {
  if (!drag) return;
  const p = point(e);
  // the floor moves by the µs the hand moves; the slope scales, as the duty does every note's pulse
  const ratio = Math.max(0, usAt(p.y) - minOn.value) / Math.max(1e-6, usAt(drag.y) - minOn.value);
  const topOn = Math.max((maxOn.value ?? 200) * 1.5, drag.on);
  const on = Math.min(topOn, Math.max(1, Math.round(drag.on + usAt(p.y) - usAt(drag.y))));
  const dn = nAt(p.x) - nAt(drag.x);
  let next: CoilDrive;
  if (drag.h === 'floor') next = { ontimeUs: on, duty: props.drive.duty };
  else if (drag.h === 'slope') next = { ontimeUs: props.drive.ontimeUs, duty: Math.min(1, Math.max(0.0005, Math.round(drag.duty * ratio * 1e4) / 1e4)) };
  else if (drag.h === 'knee') next = { ontimeUs: on, duty: dutyAt(on, Math.min(Math.max(Math.round(drag.n + dn), lo.value), hi.value + 1)) };
  else {
    const k = drag.pinned ? Math.round(nAt(p.x) + 0.5) : drag.n + Math.round(dn);
    next = { ontimeUs: drag.on, duty: dutyAt(drag.on, Math.min(Math.max(k, lo.value - 1), hi.value + 2)) };
  }
  if (next.ontimeUs !== props.drive.ontimeUs || next.duty !== props.drive.duty) emit('update:drive', next);
}
function release(): void {
  drag = null;
  heldTop.value = null;
  dragging.value = null;
}

/* ----------------------------------------------------- one tooltip per column */
const hover = ref<number | null>(null);
const pinned = ref<number | null>(null);
function marksOf(n: number): LoadMark[] | null {
  const b = byNote.value.get(n);
  if (!b) return null;
  return FATE_KINDS.flatMap((k) => b[k].map((f): LoadMark => [f.note.startMs, k]));
}
function enter(n: number): void {
  if (dragging.value) return;
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
const times = (list: DevNoteFate[]): string => {
  const all = [...list].sort((a, b) => a.note.startMs - b.note.startMs).map((f) => formatDuration(f.note.startMs));
  return all.slice(0, 6).join(', ') + (all.length > 6 ? ` … (+${all.length - 6})` : '');
};
const tip = computed(() => {
  const n = hover.value;
  if (n == null || dragging.value) return null;
  const f = MidNote.hz(n);
  const asked = new DevOutput(props.drive).requested(f);
  const by = f >= fb.value ? t('ontime.treble') : t('ontime.bass');
  const us = Math.round(at(n));
  const lines: { text: string; cls?: string }[] = [{
    text: maxOn.value != null && us >= maxOn.value && asked > maxOn.value
      ? t('ontime.fig.aloneCapped', { us, asked: Math.round(asked), by })
      : t('ontime.fig.alone', { us, by }),
  }];
  if (props.physics) {
    const ocd = props.physics.ocdFrom(f), strike = props.physics.strikeFrom(f), arc = props.physics.arcFrom(f);
    if (Number.isFinite(arc)) lines.push({ text: t('ontime.fig.tipArcFrom', { us: Math.round(arc) }), cls: 'is-short' });
    if (Number.isFinite(strike)) lines.push({ text: t('ontime.fig.tipStrikeFrom', { us: Math.round(strike) }), cls: 'is-strike' });
    if (Number.isFinite(ocd) && ocd < strike) lines.push({ text: t('ontime.fig.tipOcdFrom', { us: Math.round(ocd) }), cls: 'is-ocd' });
  }
  if (song.value) {
    const b = byNote.value.get(n);
    if (!b) lines.push({ text: t('ontime.fig.notPlayed') });
    else {
      const fired = FATE_KINDS.flatMap((k) => b[k]).map((x) => x.peakUs).filter((v) => v > 0);
      const a = Math.round(Math.min(...fired)), z = Math.round(Math.max(...fired));
      lines.push({ text: t('ontime.fig.played', { n: countOf(b) }) + (fired.length ? ` ${t('ontime.fig.tipFired', { us: a === z ? a : `${a}–${z}` })}` : '') });
      if (b.cut.length) lines.push({ text: t('ontime.fig.tipCut', { n: b.cut.length, times: times(b.cut) }, b.cut.length), cls: 'is-cut' });
      if (b.short.length) lines.push({ text: t('ontime.fig.tipShort', { n: b.short.length, times: times(b.short) }, b.short.length), cls: 'is-short' });
      if (b.strike.length) lines.push({ text: t('ontime.fig.tipStrike', { n: b.strike.length, times: times(b.strike) }, b.strike.length), cls: 'is-strike' });
      if (b.ocd.length) lines.push({ text: t('ontime.fig.tipOcd', { n: b.ocd.length, times: times(b.ocd) }, b.ocd.length), cls: 'is-ocd' });
      if (b.reduced.length) {
        const pct = Math.round((1 - Math.min(...b.reduced.map((x) => x.minFactor))) * 100);
        lines.push({ text: t('ontime.fig.tipReduced', { n: b.reduced.length, pct, times: times(b.reduced) }, b.reduced.length), cls: 'is-reduced' });
      }
      if (b.ok.length) lines.push({ text: t('ontime.fig.tipOk', { n: b.ok.length }, b.ok.length) });
    }
  } else {
    const c = fit(n);
    if (c && maxDuty.value != null) {
      const named = { one: pctLabel(c.one), max: pctLabel(maxDuty.value), n: c.ok };
      lines.push({ text: t(c.byVoices ? 'ontime.fig.tipChordVoices' : 'ontime.fig.tipChord', named) });
    }
  }
  return { title: `${MidNote.name(n)} · ${MidNote.hzLabel(f)}`, lines, left: (xs(n) / W.value) * 100 };
});
</script>

<template>
  <div class="cfig" :class="{ 'is-editable': editable, 'is-dragging': dragging }">
    <div ref="plotEl" class="cfig__plot">
      <svg ref="svgEl" :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="$t('ontime.fig.label')" @pointermove="move"
        @pointerup="release" @pointercancel="release">
        <defs>
          <pattern :id="`${uid}-hatch`" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect class="cfig__hatch-bg" width="6" height="6"></rect>
            <line class="cfig__hatch-line" x1="0" y1="0" x2="0" y2="6"></line>
          </pattern>
        </defs>

        <!-- behind: the physics' zones, the grid, past the max ontime -->
        <path v-if="ocdZone" class="cfig__zone is-ocd" :d="ocdZone"><title>{{ $t('ontime.fig.ocdZoneHint') }}</title></path>
        <path v-if="strikeZone" class="cfig__zone is-strike" :d="strikeZone"></path>
        <path v-if="arcZone" class="cfig__zone is-short" :d="arcZone"></path>
        <g class="cfig__grid">
          <template v-for="v in grid" :key="v">
            <line :x1="L" :x2="W - R" :y1="y(v)" :y2="y(v)"></line>
            <text class="cfig__ax" :x="L - 4" :y="y(v) + 3" text-anchor="end">{{ v }}</text>
          </template>
        </g>
        <text class="cfig__vt" :transform="`rotate(-90 9 ${(T0 + T1) / 2})`" x="9" :y="(T0 + T1) / 2 + 3" text-anchor="middle">{{
          $t('ontime.fig.ontimeAxis') }} <tspan class="cfig__vt-u">(µs)</tspan></text>
        <rect v-if="maxOn != null" :x="L" :y="T0" :width="W - R - L" :height="Math.max(0, y(maxOn) - T0)" :fill="`url(#${uid}-hatch)`"></rect>
        <line v-if="maxOn != null" class="cfig__cap" :x1="L" :x2="W - R" :y1="y(maxOn)" :y2="y(maxOn)"></line>
        <path v-if="dutyMaxLine" class="cfig__dmax" :d="dutyMaxLine"></path>
        <path v-if="ocdLine" class="cfig__ocd" :d="ocdLine"></path>

        <!-- the two settings' lines, the curve they make, the song's notes over it -->
        <path class="cfig__guide" :d="slope"></path>
        <line class="cfig__guide" :x1="L" :x2="W - R" :y1="y(floorUs)" :y2="y(floorUs)"></line>
        <path class="cfig__curve" :d="curve"></path>
        <template v-if="song">
          <circle v-for="(d, i) in dots" :key="i" class="cfig__dot" :class="`is-${d.kind}`" :cx="d.x" :cy="d.y" :r="d.r"></circle>
        </template>

        <!-- what the lines and zones are -->
        <text v-if="strikeLabel" class="cfig__lab is-strike" :x="strikeLabel.x" :y="strikeLabel.y">{{ $t('ontime.fig.strikeLine') }}</text>
        <text v-if="arcLabel" class="cfig__lab is-short" :x="arcLabel.x" :y="arcLabel.y" text-anchor="end">{{ $t('ontime.fig.arcLine') }}</text>
        <text v-if="ocdLabel" class="cfig__lab is-ocd" :x="ocdLabel.x" :y="ocdLabel.y" text-anchor="middle">{{ $t('ontime.fig.ocdLine') }}</text>
        <text v-if="maxOn != null" class="cfig__lab is-max" :x="W - R - 4" :y="y(maxOn) - 4" text-anchor="end"><tspan class="cfig__lock">&#xf023;</tspan> {{
          $t('ontime.limits.ontime') }} <tspan class="cfig__val">{{ maxOn }}</tspan><title>{{ $t('ontime.fig.lockHint') }}</title></text>
        <text v-if="dutyMaxLabel" class="cfig__lab is-max" :x="dutyMaxLabel.x" :y="dutyMaxLabel.y"><tspan class="cfig__lock">&#xf023;</tspan> {{
          $t('ontime.limits.duty') }} <tspan class="cfig__val">{{ pctLabel(maxDuty!) }} %</tspan><title>{{ $t('ontime.fig.dutyMaxHint') }}</title></text>
        <template v-if="inRange">
          <line class="cfig__xo" :x1="xb" :x2="xb" :y1="T0" :y2="AX"></line>
          <text class="cfig__side" :x="xb - 4" :y="T0 - 5" text-anchor="end">{{ $t('ontime.fig.bass') }}</text>
          <text class="cfig__side" :x="xb + 4" :y="T0 - 5">{{ $t('ontime.fig.treble') }}</text>
        </template>
        <text v-else class="cfig__side" :x="W - R" :y="T0 - 5" text-anchor="end">{{
          $t(nb <= lo ? 'ontime.fig.allTreble' : 'ontime.fig.allBass', { note: MidNote.name(nbKey) }) }}</text>

        <!-- without a song: how many notes fit together -->
        <template v-if="!song">
          <g v-for="c in chords" :key="c.x">
            <ellipse v-for="(cy, k) in c.heads" :key="k" class="cfig__nh" :cx="c.x" :cy="cy" rx="4.4" ry="3.1"
              :transform="`rotate(-20 ${c.x} ${cy})`"></ellipse>
            <ellipse :class="c.lost ? 'cfig__nh-lost' : 'cfig__nh-cut'" :fill="c.lost ? undefined : `url(#${uid}-hatch)`"
              :cx="c.x" :cy="c.last" rx="4.4" ry="3.1" :transform="`rotate(-20 ${c.x} ${c.last})`"></ellipse>
            <text class="cfig__num" :x="c.x" :y="c.last - 6" text-anchor="middle">{{ c.n }}</text>
          </g>
          <text v-if="chords.length" class="cfig__vt" :transform="`rotate(-90 9 ${(B0 + B1) / 2})`" x="9"
            :y="(B0 + B1) / 2 + 3" text-anchor="middle">{{ $t('ontime.fig.chordAxis') }}</text>
        </template>

        <!-- the notes' axis -->
        <line class="cfig__base" :x1="L" :x2="W - R" :y1="AX" :y2="AX"></line>
        <template v-for="n in ticks" :key="`t${n}`">
          <line class="cfig__tick" :x1="xs(n)" :x2="xs(n)" :y1="AX" :y2="AX + 3"></line>
          <text class="cfig__ax" :x="xs(n)" :y="XL" text-anchor="middle">{{ MidNote.name(n) }}</text>
        </template>

        <!-- the columns -->
        <rect v-if="hover != null" class="cfig__col" :x="edge(hover)" :y="T0 - 2" :width="cw" :height="AX - T0 + 2"></rect>
        <rect v-for="n in notes" :key="`h${n}`" class="cfig__hit" :class="{ 'is-pinned': pinned === n }" :x="edge(n)"
          :y="T0 - 4" :width="cw" :height="AX - T0 + 4" @pointerenter="enter(n)" @pointerleave="leave" @click="pin(n)"></rect>

        <!-- the handles: the crossover on the notes' axis, the slope, the floor, where they meet -->
        <g class="cfig__split" :class="{ 'is-handle': editable }" @pointerdown="grab('split', $event)">
          <title>{{ $t(editable ? 'ontime.fig.dragSplit' : 'ontime.crossoverHint', { note: MidNote.name(nbKey), hz: MidNote.hzLabel(fb) }) }}</title>
          <rect class="cfig__pill" :x="splitX - 22" :y="AX + 2" width="44" height="14" rx="7"></rect>
          <text class="cfig__pill-txt" :x="splitX" :y="AX + 12" text-anchor="middle">{{ splitLabel }}</text>
        </g>
        <template v-if="editable">
          <g class="cfig__handle" @pointerdown="grab('slope', $event)">
            <title>{{ $t('ontime.fig.dragBass') }}</title>
            <rect class="cfig__hit-h" :x="slopePill.x - slopePill.w / 2 - 6" :y="slopePill.y - 15" :width="slopePill.w + 12" height="30"></rect>
            <rect class="cfig__pill" :x="slopePill.x - slopePill.w / 2" :y="slopePill.y - 8" :width="slopePill.w" height="16" rx="8"></rect>
            <text class="cfig__pill-txt" :x="slopePill.x" :y="slopePill.y + 3.5" text-anchor="middle">{{ slopePill.text }}</text>
          </g>
          <g class="cfig__handle" @pointerdown="grab('floor', $event)">
            <title>{{ $t('ontime.fig.dragTreble') }}</title>
            <rect class="cfig__hit-h" :x="floorPill.x - floorPill.w / 2 - 6" :y="floorPill.y - 15" :width="floorPill.w + 12" height="30"></rect>
            <rect class="cfig__pill" :x="floorPill.x - floorPill.w / 2" :y="floorPill.y - 8" :width="floorPill.w" height="16" rx="8"></rect>
            <text class="cfig__pill-txt" :x="floorPill.x" :y="floorPill.y + 3.5" text-anchor="middle">{{ floorPill.text }}</text>
          </g>
          <g v-if="inRange" class="cfig__handle" @pointerdown="grab('knee', $event)">
            <title>{{ $t('ontime.fig.dragKnee', { note: MidNote.name(nbKey) }) }}</title>
            <circle class="cfig__hit-h" :cx="xb" :cy="y(floorUs)" r="13"></circle>
            <circle class="cfig__knee" :cx="xb" :cy="y(floorUs)" r="5.5"></circle>
          </g>
        </template>
      </svg>
      <div v-if="tip" class="cfig__tip" :class="tip.left < 50 ? 'is-right' : 'is-left'" role="tooltip">
        <span class="cfig__tip-title">{{ tip.title }}</span>
        <span v-for="(l, i) in tip.lines" :key="i" :class="l.cls">{{ l.text }}</span>
      </div>
    </div>
    <div class="cfig__key">
      <span><span class="cfig__sw-line"></span>{{ $t('ontime.fig.key') }}</span>
      <template v-if="song">
        <span v-if="dots.length" :title="$t('ontime.fig.notesHint')"><span class="cfig__sw-dot"></span>{{ $t('ontime.fig.notes') }}</span>
        <span v-if="totals.cut" :title="$t('ontime.fig.cutHint')"><span class="cfig__sw is-cut"></span><b>{{ totals.cut }}</b> {{ $t('ontime.fig.cut') }}</span>
        <span v-if="totals.short" :title="$t('ontime.fig.shortHint')"><span class="cfig__sw is-short"></span><b>{{ totals.short }}</b> {{ $t('ontime.fig.short') }}</span>
        <span v-if="totals.strike" :title="$t('ontime.fig.strikeHint')"><span class="cfig__sw is-strike"></span><b>{{ totals.strike }}</b> {{ $t('ontime.fig.strike') }}</span>
        <span v-if="totals.ocd" :title="$t('ontime.fig.ocdHint')"><span class="cfig__sw is-ocd"></span><b>{{ totals.ocd }}</b> {{ $t('ontime.fig.ocd') }}</span>
        <span v-if="totals.reduced" :title="$t('ontime.fig.reducedHint')"><span class="cfig__sw is-reduced"></span><b>{{ totals.reduced }}</b> {{
          $t('ontime.fig.reduced') }}</span>
        <span v-if="totals.ok"><span class="cfig__sw is-ok"></span><b>{{ totals.ok }}</b> {{ $t('ontime.fig.ok') }}</span>
        <span v-if="fileVolume != null" :title="$t('ontime.fig.fileVolumeHint')">{{ $t('ontime.fig.fileVolume') }} <b>{{ fileVolume }} %</b></span>
      </template>
      <template v-else-if="chords.length">
        <span><span class="cfig__nhsw"></span>{{ $t('ontime.fig.pass') }}</span>
        <span v-if="chords.some((c) => !c.lost)"><span class="cfig__nhsw is-cut"></span>{{ $t('ontime.fig.allReduce') }}</span>
        <span v-if="chords.some((c) => c.lost)"><span class="cfig__nhsw is-lost"></span>{{ $t('ontime.fig.pastVoices') }}</span>
      </template>
    </div>
  </div>
</template>
