<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * A line chart of the coil sheet: one axis, its series drawn thin, the
 * thresholds as dashed lines (a padlock on the sheet's limits), zones along the
 * x axis behind them (no arc, the arcs strike the mat, past the sheet's max:
 * hatched), the values under the pointer, and a key of what the colours are.
 */
export interface ChartSeries {
  id: string;
  pts: [number, number][];
  color: string;
  label: string;
  dash?: string;
  /** The reference series: drawn thicker. */
  main?: boolean;
}
export interface ChartMark {
  at: number;
  color: string;
  label: string;
  dash?: string;
  /** One of the sheet's limits: a padlock before its label. */
  lock?: boolean;
  /** Its line in the key under the chart; none: not in it. */
  key?: string;
}
/** A stretch of the x axis: no arc, the arcs strike the mat, past the sheet's max. */
export interface ChartZone {
  from: number;
  to: number;
  kind: 'short' | 'strike' | 'past';
  label: string;
}

const props = defineProps<{
  title: string;
  series: ChartSeries[];
  x: [number, number];
  y: [number, number];
  xLabel: string;
  yLabel: string;
  xUnit: string;
  yUnit: string;
  hlines?: ChartMark[];
  vlines?: ChartMark[];
  zones?: ChartZone[];
}>();
const uid = useId();

const { locale } = useI18n();
// drawn at the screen's pixels: its text keeps its size whatever the width
const W = ref(560);
const H = 230, M = { l: 48, r: 14, t: 26, b: 34 };
const plot = ref<HTMLElement | null>(null);
let ro: ResizeObserver | null = null;
onMounted(() => {
  ro = new ResizeObserver(([e]) => { W.value = Math.max(260, Math.round(e.contentRect.width)); });
  if (plot.value) ro.observe(plot.value);
});
onBeforeUnmount(() => ro?.disconnect());
const X = (v: number) => M.l + ((v - props.x[0]) / (props.x[1] - props.x[0] || 1)) * (W.value - M.l - M.r);
const Y = (v: number) => H - M.b - ((Math.max(props.y[0], Math.min(props.y[1], v)) - props.y[0]) / (props.y[1] - props.y[0] || 1)) * (H - M.t - M.b);
const num = (v: number, d = 0) => v.toLocaleString(locale.value, { maximumFractionDigits: d });

function ticks([lo, hi]: [number, number], n: number): number[] {
  const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((k) => k >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(+v.toFixed(6));
  return out;
}
const xTicks = computed(() => ticks(props.x, 5));
const yTicks = computed(() => ticks(props.y, 4));

const paths = computed(() => props.series.map((s) => ({
  ...s,
  d: s.pts.filter((p) => Number.isFinite(p[1])).map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(''),
})));

// the values under the pointer
const hover = ref<number | null>(null);
const svg = ref<SVGSVGElement | null>(null);
function onMove(e: PointerEvent): void {
  const r = svg.value?.getBoundingClientRect();
  if (!r) return;
  const px = ((e.clientX - r.left) / r.width) * W.value;
  hover.value = px < M.l || px > W.value - M.r ? null : props.x[0] + ((px - M.l) / (W.value - M.l - M.r)) * (props.x[1] - props.x[0]);
}
function at(pts: [number, number][], x: number): number | null {
  if (!pts.length || x < pts[0][0] || x > pts[pts.length - 1][0]) return null;
  const i = pts.findIndex((p) => p[0] >= x);
  if (i <= 0) return pts[0][1];
  const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
}
const zoneRects = computed(() => (props.zones ?? [])
  .map((z) => ({ ...z, x0: X(Math.max(props.x[0], z.from)), x1: X(Math.min(props.x[1], z.to)) }))
  .filter((z) => z.x1 - z.x0 > 0.5));
// the key: the series when several, the zones drawn, the marks that have a line in it
const keyMarks = computed(() => [...(props.hlines ?? []), ...(props.vlines ?? [])].filter((m) => m.key));
const tip = computed(() => {
  const x = hover.value;
  if (x == null) return null;
  const rows = props.series.map((s) => ({ ...s, v: at(s.pts, x) })).filter((s) => s.v != null);
  return { x, left: (X(x) / W.value) * 100, rows };
});
</script>

<template>
  <figure class="coil-chart">
    <figcaption class="coil-chart__title">{{ title }}</figcaption>
    <div ref="plot" class="coil-chart__plot">
      <svg ref="svg" :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="title" @pointermove="onMove" @pointerleave="hover = null">
        <defs>
          <pattern :id="`${uid}-hatch`" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect class="coil-chart__hatch-bg" width="6" height="6"></rect>
            <line class="coil-chart__hatch-line" x1="0" y1="0" x2="0" y2="6"></line>
          </pattern>
        </defs>
        <rect v-for="z in zoneRects" :key="z.kind" class="coil-chart__zone" :class="`is-${z.kind}`" :x="z.x0" :y="M.t"
          :width="z.x1 - z.x0" :height="H - M.t - M.b" :fill="z.kind === 'past' ? `url(#${uid}-hatch)` : undefined"><title>{{ z.label }}</title></rect>
        <g class="coil-chart__grid">
          <line v-for="t in yTicks" :key="`y${t}`" :x1="M.l" :x2="W - M.r" :y1="Y(t)" :y2="Y(t)" />
        </g>
        <text v-for="t in yTicks" :key="`yl${t}`" class="coil-chart__tick" :x="M.l - 6" :y="Y(t) + 4" text-anchor="end">{{ num(t, 2) }}</text>
        <text v-for="t in xTicks" :key="`xl${t}`" class="coil-chart__tick" :x="X(t)" :y="H - M.b + 15" text-anchor="middle">{{ num(t, 2) }}</text>
        <line class="coil-chart__axis" :x1="M.l" :x2="W - M.r" :y1="H - M.b" :y2="H - M.b" />
        <text class="coil-chart__label" :x="W - M.r" :y="H - 4" text-anchor="end">{{ xLabel }}</text>
        <text class="coil-chart__label" :x="4" :y="12">{{ yLabel }}</text>
        <template v-for="h in hlines ?? []" :key="`h${h.label}`">
          <g v-if="h.at >= y[0] && h.at <= y[1]" class="coil-chart__mark" :style="{ '--c': h.color }">
            <line :x1="M.l" :x2="W - M.r" :y1="Y(h.at)" :y2="Y(h.at)" :stroke-dasharray="h.dash ?? '5 4'" />
            <text :x="W - M.r - 4" :y="Y(h.at) - 5" text-anchor="end"><tspan v-if="h.lock" class="coil-chart__lock">&#xf023; </tspan>{{ h.label }}</text>
          </g>
        </template>
        <template v-for="v in vlines ?? []" :key="`v${v.label}`">
          <g v-if="v.at >= x[0] && v.at <= x[1]" class="coil-chart__mark" :style="{ '--c': v.color }">
            <line :x1="X(v.at)" :x2="X(v.at)" :y1="M.t" :y2="H - M.b" :stroke-dasharray="v.dash ?? '3 3'" />
            <!-- at the foot: the thresholds' labels hold the top -->
            <text :x="X(v.at) + (X(v.at) > W * 0.6 ? -5 : 5)" :y="H - M.b - 6" :text-anchor="X(v.at) > W * 0.6 ? 'end' : 'start'"><tspan
                v-if="v.lock" class="coil-chart__lock">&#xf023; </tspan>{{ v.label }}</text>
          </g>
        </template>
        <path v-for="p in paths" :key="p.id" class="coil-chart__line" :class="{ 'is-main': p.main }" :d="p.d"
          :style="{ '--c': p.color }" :stroke-dasharray="p.dash" />
        <g v-if="tip" class="coil-chart__cursor">
          <line :x1="X(tip.x)" :x2="X(tip.x)" :y1="M.t" :y2="H - M.b" />
          <circle v-for="r in tip.rows" :key="r.id" :cx="X(tip.x)" :cy="Y(r.v!)" r="4" :style="{ '--c': r.color }" />
        </g>
      </svg>
      <div v-if="tip" class="coil-chart__tip" :class="{ 'is-left': tip.left > 60 }" :style="{ '--x': `${tip.left}%` }">
        <b>{{ num(tip.x, 1) }} {{ xUnit }}</b>
        <span v-for="r in tip.rows" :key="r.id"><i :style="{ '--c': r.color }"></i>{{ r.label }}<b>{{ num(r.v!, 1) }} {{ yUnit }}</b></span>
      </div>
    </div>
    <div v-if="series.length > 1 || zoneRects.length || keyMarks.length" class="coil-chart__legend">
      <template v-if="series.length > 1">
        <span v-for="s in series" :key="s.id"><svg viewBox="0 0 22 6" aria-hidden="true"><line x1="1" x2="21" y1="3" y2="3"
              :style="{ '--c': s.color }" :stroke-dasharray="s.dash" :class="{ 'is-main': s.main }" /></svg>{{ s.label }}</span>
      </template>
      <span v-for="z in zoneRects" :key="`z${z.kind}`"><i class="coil-chart__sw" :class="`is-${z.kind}`"></i>{{ z.label }}</span>
      <span v-for="m in keyMarks" :key="`m${m.key}`"><svg viewBox="0 0 22 6" aria-hidden="true"><line x1="1" x2="21" y1="3" y2="3"
            :style="{ '--c': m.color }" :stroke-dasharray="m.dash ?? '5 4'" /></svg><i v-if="m.lock" class="fas fa-lock coil-chart__key-lock"></i>{{
          m.key }}</span>
    </div>
  </figure>
</template>
