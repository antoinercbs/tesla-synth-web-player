<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import type { RulerData, RulerZone } from './use-play-point';

/**
 * The coil sheet's ontime slider, drawn as what the ontime does at the note:
 * on its track the zones (no arc, in the air, the OCD cuts, the arcs strike
 * the mat, past what the board sends), above it the arc's reach (the model's
 * middle arc, its spread around it) up to the mat. Its thumb is the play
 * point; the board's max ontime is a handle of its own (the sheet's field),
 * with a proposal just short of the mat or the OCD.
 */
const props = withDefaults(defineProps<{ data: RulerData; reach: number; compact?: boolean }>(), { compact: false });
const ontime = defineModel<number>('ontime', { required: true });
const max = defineModel<number>('max', { required: true });
const { t, locale } = useI18n();
const uid = useId();
const fr = (v: number, d = 0) => v.toLocaleString(locale.value, { minimumFractionDigits: d, maximumFractionDigits: d });

/* ------------------------------------------------------------ its size: drawn at the screen's pixels, the text never scales */
const svg = ref<SVGSVGElement | null>(null);
const W = ref(560);
const H = computed(() => (props.compact ? 196 : 236));
let ro: ResizeObserver | null = null;
onMounted(() => {
  ro = new ResizeObserver(([e]) => { W.value = Math.max(240, Math.round(e.contentRect.width)); });
  if (svg.value) ro.observe(svg.value);
});
onBeforeUnmount(() => ro?.disconnect());

const L = 34, R = 10, T = 30, TRACK = 26;
const plotH = computed(() => H.value - T - TRACK - 48);
const trackY = computed(() => T + plotH.value + 14);
// a hand moving the board's max keeps the scale it took: the handle stays under it
const heldTop = ref<number | null>(null);
const top = computed(() => heldTop.value ?? props.data.top);
const x = (on: number) => L + (Math.min(on, top.value) / top.value) * (W.value - L - R);
const y = (m: number) => T + (1 - Math.min(m, props.data.yMax) / props.data.yMax) * plotH.value;
const onAt = (px: number) => Math.max(0, Math.min(top.value, ((px - L) / (W.value - L - R)) * top.value));

const linePath = computed(() => props.data.line.filter((p) => p[0] <= top.value)
  .map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(''));
const bandPoints = computed(() => {
  const b = props.data.band.filter((p) => p[0] <= top.value);
  return [...b.map((p) => `${x(p[0]).toFixed(1)},${y(p[2]).toFixed(1)}`), ...b.reverse().map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`)].join(' ');
});
const yTicks = computed(() => [0, props.data.yMax / 2, props.data.yMax]);
const xTicks = computed(() => {
  const want = props.compact ? 4 : 7, raw = top.value / want, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((k) => k >= raw) ?? raw;
  return Array.from({ length: Math.floor(top.value / step) + 1 }, (_, i) => i * step);
});

/* ------------------------------------------------------------ the zones, each saying itself when there is room */
const zoneKey = (z: RulerZone) => (z.kind === 'strike' && z.withOcd ? 'strikeOcd' : z.kind);
const zoneHint = (z: RulerZone) => t(`coils.ruler.${z.kind}Hint`, { from: Math.round(z.from), to: Math.round(z.to) });
// a label is about 6.3 px a letter at this size
const room = (label: string) => label.length * 6.3 + 14;
const zones = computed(() => {
  const tx = x(ontime.value), thumb = 16;
  return props.data.zones.map((z) => {
    const x0 = x(z.from), x1 = x(z.to);
    // beside the thumb when it sits in the zone: on the wider side of it
    const sides = tx > x0 && tx < x1 ? [[x0, tx - thumb], [tx + thumb, x1]] : [[x0, x1]];
    const [a, b] = sides.reduce((m, s) => (s[1] - s[0] > m[1] - m[0] ? s : m));
    const key = zoneKey(z), long = t(`coils.ruler.${key}`), short = t(`coils.ruler.${key}Short`);
    const label = b - a > room(long) && !props.compact ? long : b - a > room(short) ? short : '';
    return { ...z, x0, x1, label, at: (a + b) / 2, hint: zoneHint(z), wide: x1 - x0 > room(long) };
  });
});
// a short zone too narrow for its words says them above the track, unless the thumb is there
const short = computed(() => zones.value.find((z) => z.kind === 'short' && !z.wide && Math.abs(x(ontime.value) - z.x1) > 110) ?? null);

/* ------------------------------------------------------------ the point and the board's max */
const point = computed(() => {
  const cx = x(ontime.value), cy = y(props.reach), text = t('coils.ruler.point', { us: Math.round(ontime.value), m: fr(props.reach, 2) });
  const w = text.length * 7 + 16;
  return { cx, cy, text, w, bx: Math.max(L, Math.min(W.value - R - w, cx - w / 2)), by: Math.max(2, cy - 32) };
});
const lock = computed(() => {
  const lx = x(max.value), text = `${max.value} µs`, w = text.length * 7 + 30;
  return { lx, shown: max.value <= top.value, text, w, px: Math.max(L, Math.min(W.value - R - w, lx - w / 2)) };
});
const proposal = computed(() => {
  const us = props.data.propose;
  if (us == null || !lock.value.shown) return null;
  const text = t(props.compact ? 'coils.ruler.proposeShort' : 'coils.ruler.propose', { us }), w = text.length * 6.3 + 20;
  return { us, text, w, px: Math.max(L, lock.value.px - 8 - w) };
});
const matY = computed(() => y(props.data.mat.reach));

/* ------------------------------------------------------------ the hand */
type Drag = 'thumb' | 'lock';
let drag: Drag | null = null;
const localX = (e: PointerEvent) => e.clientX - (svg.value?.getBoundingClientRect().left ?? 0);
const setOntime = (px: number) => { ontime.value = Math.max(1, Math.round(onAt(px))); };
const setMax = (px: number) => { max.value = Math.max(1, Math.round(onAt(px))); };
function onDown(e: PointerEvent): void {
  if (e.button !== 0 || !svg.value) return;
  const px = localX(e), near = e.pointerType === 'touch' ? 16 : 8;
  const onLock = lock.value.shown && ((e.target as Element).closest('.oruler__lock') || Math.abs(px - lock.value.lx) <= near);
  drag = onLock ? 'lock' : 'thumb';
  if (drag === 'lock') heldTop.value = props.data.top;
  else setOntime(px);
  svg.value.setPointerCapture(e.pointerId);
  e.preventDefault();
}
function onMove(e: PointerEvent): void {
  if (drag === 'thumb') setOntime(localX(e));
  else if (drag === 'lock') setMax(localX(e));
}
function onUp(): void {
  drag = null;
  heldTop.value = null;
}
// the keys a slider takes: a step, ten with Shift or a page, the ends
function onKey(which: Drag, e: KeyboardEvent): void {
  const v = which === 'thumb' ? ontime : max;
  const step = e.shiftKey || e.key.startsWith('Page') ? 10 : 1;
  const next: Record<string, number> = {
    ArrowRight: v.value + step, ArrowUp: v.value + step, PageUp: v.value + step,
    ArrowLeft: v.value - step, ArrowDown: v.value - step, PageDown: v.value - step,
    Home: 1, End: which === 'thumb' ? max.value : Math.round(props.data.top),
  };
  if (!(e.key in next)) return;
  e.preventDefault();
  v.value = Math.max(1, Math.min(Math.round(props.data.top), next[e.key]));
}
</script>

<template>
  <div class="oruler" :class="{ 'is-compact': compact }">
    <svg ref="svg" :viewBox="`0 0 ${W} ${H}`" :height="H" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp">
      <defs>
        <pattern :id="`${uid}-hatch`" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect class="oruler__hatch-bg" width="6" height="6"></rect>
          <line class="oruler__hatch-line" x1="0" y1="0" x2="0" y2="6"></line>
        </pattern>
      </defs>
      <!-- the reach: its scale, the mat, the model's spread and its middle arc -->
      <g class="oruler__grid">
        <line v-for="m in yTicks.slice(0, -1)" :key="m" :x1="L" :x2="W - R" :y1="y(m)" :y2="y(m)" />
      </g>
      <text v-for="m in yTicks" :key="`y${m}`" class="oruler__tick" :x="L - 6" :y="y(m) + 4" text-anchor="end">{{ m === yTicks[2] ? 'm' : m.toLocaleString(locale, { maximumFractionDigits: 2 }) }}</text>
      <line class="oruler__mat" :x1="L" :x2="W - R" :y1="matY" :y2="matY" />
      <text class="oruler__mat-label" :x="L + 4" :y="matY - 5">{{ $t(compact ? 'coils.ruler.matShort' : 'coils.ruler.mat', { m: fr(data.mat.tip, 2) }) }}</text>
      <polygon class="oruler__band" :points="bandPoints"><title>{{ $t('coils.ruler.band') }}</title></polygon>
      <path class="oruler__line" :d="linePath" />

      <!-- the track: what each ontime does -->
      <g v-for="z in zones" :key="z.kind">
        <rect class="oruler__zone" :class="`is-${z.kind}`" :x="z.x0" :y="trackY" :width="Math.max(0, z.x1 - z.x0)" :height="TRACK"
          :fill="z.kind === 'past' ? `url(#${uid}-hatch)` : undefined"><title>{{ z.hint }}</title></rect>
        <text v-if="z.label" class="oruler__zone-label" :class="`is-${z.kind}`" :x="z.at" :y="trackY + TRACK / 2 + 4"
          text-anchor="middle">{{ z.label }}</text>
      </g>
      <rect class="oruler__track" :x="L" :y="trackY" :width="W - L - R" :height="TRACK" rx="6" />
      <text v-if="short && !compact" class="oruler__tick" :x="short.x1 + 2" :y="trackY - 5">{{ $t('coils.ruler.shortUnder', { us: Math.round(short.to) }) }}</text>
      <text v-for="v in xTicks" :key="`x${v}`" class="oruler__tick" :x="x(v)" :y="trackY + TRACK + 16"
        :text-anchor="v === 0 ? 'start' : 'middle'">{{ v === xTicks[xTicks.length - 1] ? `${v} µs` : v }}</text>

      <!-- the board's max ontime, its handle on top; the proposal beside it -->
      <g v-if="lock.shown" class="oruler__lock" role="slider" tabindex="0" :aria-label="$t('coils.ruler.lock')" aria-valuemin="1"
        :aria-valuemax="Math.round(data.top)" :aria-valuenow="max" @keydown="onKey('lock', $event)">
        <title>{{ $t('coils.ruler.lockHint') }}</title>
        <line class="oruler__lock-line" :x1="lock.lx" :x2="lock.lx" :y1="T - 8" :y2="trackY + TRACK" />
        <rect class="oruler__lock-pill" :x="lock.px" :y="T - 26" :width="lock.w" height="18" rx="9" />
        <text class="oruler__lock-icon" :x="lock.px + 9" :y="T - 13">&#xf023;</text>
        <text class="oruler__lock-text" :x="lock.px + 22" :y="T - 13">{{ lock.text }}</text>
      </g>
      <g v-if="proposal" class="oruler__propose" role="button" tabindex="0" @pointerdown.stop @click="max = proposal.us"
        @keydown.enter.prevent="max = proposal.us" @keydown.space.prevent="max = proposal.us">
        <title>{{ $t('coils.ruler.proposeHint') }}</title>
        <rect :x="proposal.px" :y="T - 26" :width="proposal.w" height="18" rx="9" />
        <text :x="proposal.px + proposal.w / 2" :y="T - 13" text-anchor="middle">{{ proposal.text }}</text>
      </g>

      <!-- the play point: the thumb on the track, its reach on the curve -->
      <g class="oruler__point" role="slider" tabindex="0" :aria-label="$t('coils.ruler.thumb')" aria-valuemin="1"
        :aria-valuemax="Math.round(data.top)" :aria-valuenow="ontime" :aria-valuetext="point.text" @keydown="onKey('thumb', $event)">
        <line class="oruler__point-line" :x1="point.cx" :x2="point.cx" :y1="point.cy" :y2="trackY" />
        <circle class="oruler__point-dot" :cx="point.cx" :cy="point.cy" r="4.5" />
        <rect class="oruler__bubble" :x="point.bx" :y="point.by" :width="point.w" height="22" rx="6" />
        <text class="oruler__bubble-text" :x="point.bx + point.w / 2" :y="point.by + 15" text-anchor="middle">{{ point.text }}</text>
        <circle class="oruler__thumb" :cx="point.cx" :cy="trackY + TRACK / 2" :r="compact ? 12 : 11" />
      </g>
    </svg>
    <p v-if="!compact" class="oruler__key"><i class="oruler__key-band"></i>{{ $t('coils.ruler.band') }}</p>
  </div>
</template>
