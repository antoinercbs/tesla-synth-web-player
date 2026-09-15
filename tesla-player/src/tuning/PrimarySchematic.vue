<script setup lang="ts">
import { computed, ref } from 'vue';
import { formatTurns } from './api';
import { snap } from './suggest';

/**
 * The primary seen from above: a flat copper spiral, the secondary in the middle,
 * and the tap clip you drag along the winding. Turn 0 is the inner end.
 *
 * Reading aids, kept deliberately sparse so the coil stays legible:
 *  - the turns inside the explored range are bright copper, the others dimmed;
 *  - one graduated "caliper" line crosses the spires and carries the turn
 *    numbers (offset by 1/16 turn from the start so no tap position ever lands
 *    on it), plus small beads at every tap step inside the range;
 *  - best / suggested / previous positions sit on the spire as rings.
 */
const props = withDefaults(defineProps<{
  turns: number;
  step: number;
  min: number;
  max: number;
  best?: number | null;
  previous?: number | null;
  suggested?: number | null;
  disabled?: boolean;
  /** Draw (and let the user move) the tap clip. Off where the drawing is only a preview of the range. */
  showTap?: boolean;
  labels: { tap: string; best: string; previous: string; suggested: string; secondary: string };
}>(), { best: null, previous: null, suggested: null, disabled: false, showTap: true });

/** Pointer / keyboard only make sense when the clip is shown. */
const interactive = computed(() => !props.disabled && props.showTap);

const tap = defineModel<number>({ required: true });

const S = 440; // viewBox
const CX = S / 2, CY = S / 2;
const R_IN = 46; // inner end of the primary (secondary radius + gap)
const R_OUT = 178; // outer end
const pitch = computed(() => (R_OUT - R_IN) / Math.max(1, props.turns));
const CALIPER_TURN = 0.0625; // angle of the reading line, in turns from the start (never a tap step)

function angle(turn: number): number { return 2 * Math.PI * turn - Math.PI / 2; }
function radius(turn: number): number { return R_IN + pitch.value * turn; }
function pt(turn: number, rOff = 0): { x: number; y: number } {
  const a = angle(turn), r = radius(turn) + rOff;
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
}
function arcPath(from: number, to: number, per = 40): string {
  if (to <= from) return '';
  const n = Math.max(2, Math.ceil((to - from) * per));
  const pts: string[] = [];
  for (let i = 0; i <= n; i++) {
    const p = pt(from + ((to - from) * i) / n);
    pts.push(`${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`);
  }
  return pts.join('');
}
const lo = computed(() => Math.max(0, Math.min(props.min, props.turns)));
const hi = computed(() => Math.max(lo.value, Math.min(props.max, props.turns)));
const pathBefore = computed(() => arcPath(0, lo.value));
const pathRange = computed(() => arcPath(lo.value, hi.value));
const pathAfter = computed(() => arcPath(hi.value, props.turns));

// beads at every tap step inside the range (half turns a little bigger)
const beads = computed(() => {
  const out: { x: number; y: number; r: number }[] = [];
  const n = Math.round((hi.value - lo.value) / props.step);
  if (n <= 0 || n > 200) return out;
  for (let i = 0; i <= n; i++) {
    const t = lo.value + i * props.step;
    const whole = Math.abs(t - Math.round(t)) < 1e-6;
    const half = Math.abs(t * 2 - Math.round(t * 2)) < 1e-6;
    if (whole) continue; // the caliper marks whole turns
    const p = pt(t);
    out.push({ x: p.x, y: p.y, r: half ? 2.2 : 1.3 });
  }
  return out;
});

// the caliper: a thin line from the secondary out past the last turn, a tick + number at each turn
const caliper = computed(() => {
  const a = angle(CALIPER_TURN);
  const inner = R_IN - 10, outer = R_OUT + 16;
  const ticks: { x1: number; y1: number; x2: number; y2: number; lx: number; ly: number; n: number; inRange: boolean }[] = [];
  const ux = Math.cos(a), uy = Math.sin(a);
  const nx = -uy, ny = ux; // normal to the line, for the labels
  for (let n = 1; n <= props.turns; n++) {
    const r = radius(n + CALIPER_TURN); // where turn n's spire crosses the line
    const x = CX + r * ux, y = CY + r * uy;
    ticks.push({ x1: x + nx * 6, y1: y + ny * 6, x2: x - nx * 6, y2: y - ny * 6, lx: x + nx * 15, ly: y + ny * 15, n, inRange: n >= lo.value - 1e-6 && n <= hi.value + 1e-6 });
  }
  return { x1: CX + inner * ux, y1: CY + inner * uy, x2: CX + outer * ux, y2: CY + outer * uy, ticks };
});

// marks on the spire
const markAt = (t: number | null): { x: number; y: number } | null => (t == null ? null : pt(Math.min(props.turns, Math.max(0, t))));
const bestPt = computed(() => markAt(props.best));
const prevPt = computed(() => markAt(props.previous));
const sugPt = computed(() => markAt(props.suggested));

// the tap clip: a small rounded rectangle tangent to the spire, plus a lead to its label pill
const tapPt = computed(() => pt(tap.value));
const tapDeg = computed(() => ((angle(tap.value) * 180) / Math.PI) + 90);
const tapLabel = computed(() => {
  const p = pt(tap.value, 26);
  // keep the pill inside the drawing
  const w = 64;
  const x = Math.min(S - w / 2 - 4, Math.max(w / 2 + 4, p.x));
  const y = Math.min(S - 14, Math.max(14, p.y));
  return { x, y, lx: pt(tap.value, 12), w };
});

/* ---------------------------------------------------------------- dragging */
const svg = ref<SVGSVGElement | null>(null);
const dragging = ref(false);
function turnsAt(clientX: number, clientY: number): number {
  const el = svg.value;
  if (!el) return tap.value;
  const rect = el.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * S - CX;
  const y = ((clientY - rect.top) / rect.height) * S - CY;
  const r = Math.hypot(x, y);
  let frac = (Math.atan2(y, x) + Math.PI / 2) / (2 * Math.PI);
  if (frac < 0) frac += 1;
  // radius → which spire; angle → fraction of turn; pick the spire whose radius is closest
  const approx = (r - R_IN) / pitch.value;
  const base = Math.floor(approx - frac + 0.5);
  const cand = [base + frac, base - 1 + frac, base + 1 + frac].filter((t) => t >= 0 && t <= props.turns);
  let t = cand[0] ?? tap.value;
  let bd = Infinity;
  for (const c of cand) { const d = Math.abs(radius(c) - r); if (d < bd) { bd = d; t = c; } }
  return snap(t, props.step, props.min, props.max);
}
function onPointerDown(e: PointerEvent): void {
  if (!interactive.value) return;
  dragging.value = true;
  (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  tap.value = turnsAt(e.clientX, e.clientY);
}
function onPointerMove(e: PointerEvent): void { if (dragging.value) tap.value = turnsAt(e.clientX, e.clientY); }
function onPointerUp(): void { dragging.value = false; }
function onKey(e: KeyboardEvent): void {
  if (!interactive.value) return;
  const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
  if (!d) return;
  e.preventDefault();
  tap.value = snap(tap.value + d * props.step * (e.shiftKey ? 4 : 1), props.step, props.min, props.max);
}
</script>

<template>
  <svg ref="svg" class="coil" :viewBox="`0 0 ${S} ${S}`" :role="showTap ? 'slider' : 'img'" :tabindex="interactive ? 0 : -1"
    :aria-valuemin="showTap ? min : undefined" :aria-valuemax="showTap ? max : undefined" :aria-valuenow="showTap ? tap : undefined"
    :aria-valuetext="showTap ? formatTurns(tap, step) : undefined" :aria-label="labels.tap"
    :class="{ 'is-disabled': disabled, 'is-dragging': dragging, 'is-static': !showTap }"
    @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp" @keydown="onKey">
    <defs>
      <linearGradient id="coil-copper" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f2b784" />
        <stop offset="0.5" stop-color="#c9773a" />
        <stop offset="1" stop-color="#8d4a1f" />
      </linearGradient>
      <radialGradient id="coil-secondary" cx="0.4" cy="0.35" r="0.75">
        <stop offset="0" stop-color="#2a3240" />
        <stop offset="1" stop-color="#0b1018" />
      </radialGradient>
      <radialGradient id="coil-ground" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0.6" stop-color="rgba(70,224,255,0.05)" />
        <stop offset="1" stop-color="rgba(70,224,255,0)" />
      </radialGradient>
    </defs>

    <!-- ground glow + secondary -->
    <circle :cx="CX" :cy="CY" :r="R_OUT + 24" fill="url(#coil-ground)" />
    <circle :cx="CX" :cy="CY" :r="R_IN - 12" fill="url(#coil-secondary)" class="secondary" />
    <circle :cx="CX" :cy="CY" :r="R_IN - 22" class="secondary-core" />
    <text :x="CX" :y="CY + 3.5" text-anchor="middle" class="secondary-label">{{ labels.secondary }}</text>

    <!-- primary: three copper segments, the explored range bright -->
    <g class="spire" stroke-linecap="round" fill="none">
      <path :d="pathBefore" class="spire-out" />
      <path :d="pathAfter" class="spire-out" />
      <path :d="pathRange" class="spire-in" />
      <path :d="pathRange" class="spire-in-light" />
    </g>
    <circle v-for="(b, i) in beads" :key="i" :cx="b.x" :cy="b.y" :r="b.r" class="bead" />

    <!-- caliper line with the turn numbers -->
    <line :x1="caliper.x1" :y1="caliper.y1" :x2="caliper.x2" :y2="caliper.y2" class="caliper" />
    <g v-for="t in caliper.ticks" :key="t.n">
      <line :x1="t.x1" :y1="t.y1" :x2="t.x2" :y2="t.y2" class="caliper-tick" :class="{ 'in-range': t.inRange }" />
      <text :x="t.lx" :y="t.ly + 3.5" text-anchor="middle" class="caliper-num" :class="{ 'in-range': t.inRange }">{{ t.n }}</text>
    </g>

    <!-- marks on the spire -->
    <g v-if="prevPt" class="mark mark--previous"><circle :cx="prevPt.x" :cy="prevPt.y" r="8" /><title>{{ labels.previous }} · {{ formatTurns(previous!, step) }}</title></g>
    <g v-if="sugPt" class="mark mark--suggested"><circle :cx="sugPt.x" :cy="sugPt.y" r="11" /><title>{{ labels.suggested }} · {{ formatTurns(suggested!, step) }}</title></g>
    <g v-if="bestPt" class="mark mark--best"><circle :cx="bestPt.x" :cy="bestPt.y" r="6" /><title>{{ labels.best }} · {{ formatTurns(best!, step) }}</title></g>

    <!-- the tap clip -->
    <template v-if="showTap">
    <g class="clip" :transform="`rotate(${tapDeg.toFixed(2)} ${tapPt.x.toFixed(2)} ${tapPt.y.toFixed(2)})`">
      <circle :cx="tapPt.x" :cy="tapPt.y" r="17" class="clip-halo" />
      <rect :x="tapPt.x - 7" :y="tapPt.y - 12" width="14" height="24" rx="4" class="clip-body" />
      <rect :x="tapPt.x - 2.5" :y="tapPt.y - 6" width="5" height="12" rx="2" class="clip-slot" />
    </g>
    <line :x1="tapLabel.lx.x" :y1="tapLabel.lx.y" :x2="tapLabel.x" :y2="tapLabel.y" class="clip-lead" />
    <g class="pill">
      <rect :x="tapLabel.x - tapLabel.w / 2" :y="tapLabel.y - 11" :width="tapLabel.w" height="22" rx="11" />
      <text :x="tapLabel.x" :y="tapLabel.y + 4" text-anchor="middle">{{ formatTurns(tap, step) }} tr</text>
    </g>
    </template>
  </svg>
</template>

<style scoped>
.coil { width: 100%; height: auto; display: block; touch-action: none; user-select: none; cursor: grab; outline: none; border-radius: var(--radius); font-family: var(--font-mono); }
.coil:focus-visible { box-shadow: 0 0 0 2px var(--volt-30); }
.coil.is-dragging { cursor: grabbing; }
.coil.is-disabled { cursor: not-allowed; opacity: 0.75; }
.coil.is-static { cursor: default; }
.secondary { stroke: rgba(120, 160, 205, 0.35); stroke-width: 1; }
.secondary-core { fill: none; stroke: rgba(120, 160, 205, 0.18); stroke-width: 1; }
.secondary-label { font-size: 8.5px; letter-spacing: 0.08em; text-transform: uppercase; fill: var(--text-mute); }
.spire-out { stroke: #8d4a1f; stroke-width: 5.5; opacity: 0.32; }
.spire-in { stroke: url(#coil-copper); stroke-width: 6; }
.spire-in-light { stroke: #ffd9b8; stroke-width: 1.4; opacity: 0.55; }
.bead { fill: #08111a; stroke: #f2b784; stroke-width: 0.9; opacity: 0.9; }
.caliper { stroke: rgba(205, 217, 230, 0.35); stroke-width: 1; stroke-dasharray: 2 3; }
.caliper-tick { stroke: var(--text-mute); stroke-width: 1.2; }
.caliper-tick.in-range { stroke: var(--text); }
.caliper-num { font-size: 11px; fill: var(--text-mute); font-weight: 500; }
.caliper-num.in-range { fill: var(--text); font-weight: 700; }
.mark--previous circle { fill: none; stroke: var(--amber); stroke-width: 1.8; stroke-dasharray: 3 2; }
.mark--suggested circle { fill: none; stroke: var(--volt); stroke-width: 1.5; stroke-dasharray: 3 3; }
.mark--best circle { fill: var(--ok); stroke: var(--bg); stroke-width: 1.5; }
.clip-halo { fill: var(--volt); opacity: 0.14; }
.clip-body { fill: var(--volt); stroke: #06090f; stroke-width: 1.2; }
.clip-slot { fill: #06090f; opacity: 0.55; }
.clip-lead { stroke: var(--volt); stroke-width: 1; opacity: 0.7; }
.pill rect { fill: var(--panel-2); stroke: var(--volt-30); stroke-width: 1; }
.pill text { font-size: 12px; font-weight: 600; fill: var(--text); }
</style>
