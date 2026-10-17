<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import type { MidiAnalysis } from '@/midi/analyze';
import type { CoilConfig } from '@/types/domain';
import type { CoilLimits } from '@/devices/coil-limits';
import type { LoadMark, Simulation } from '@/devices/coil-sim';
import type { ChannelProfile, ChannelRole } from '@/calib/roles';
import { ROLES } from '@/calib/roles';
import { coilColor } from '@/ui/coil-colors';
import { noteName } from '@/ui/piano-layout';
import { loadLane, loadLimit, loadMode, type LoadMode } from '@/ui/load-lane';
import { envelope, programSteps, stepsAmplitude } from '@/sysex/envelopes';
import { pctLabel } from '@/utils/format';
import DropMenu from '@/components/ui/DropMenu.vue';

/**
 * The song on one time axis: its notes (coloured by the coils that play them,
 * striped when several do), their velocities, and each coil's load as the board
 * plays it. Beside it, the channels with their role and envelope. A click on the
 * score moves the playhead; the bar on top holds what acts on the song (slot
 * `actions`) and the transport (slot `bar`). Its
 * score is as tall as the user drags it, on this device.
 */
const props = withDefaults(defineProps<{
  analysis: MidiAnalysis | null;
  coils: CoilConfig[];
  output2Mask?: number;
  profiles: ChannelProfile[];
  /** Each channel's envelope (program), the file's unless changed here. */
  programs: Record<number, number>;
  sim: Simulation | null;
  /** In the simulation's order. */
  loadCoils: { coilIndex: number; name: string; limits: CoilLimits | null; ontimeUs: number; duty: number }[];
  /** Moments a coil card points at (a note's passages), on its lane. */
  marks?: { coilIndex: number; list: LoadMark[] } | null;
  playheadMs?: number;
  playing?: boolean;
  /** Where the song is heard now, read every frame while it plays: `playheadMs` comes a few times a second only. */
  clock?: (() => number) | null;
  /** Channels and coils silenced while listening (bit masks); the setting keeps them. */
  mutedChannels?: number;
  mutedCoils?: number;
}>(), { output2Mask: 0, marks: null, playheadMs: 0, playing: false, clock: null, mutedChannels: 0, mutedCoils: 0 });
const emit = defineEmits<{
  (e: 'seek', ms: number): void;
  (e: 'role', ch: number, role: ChannelRole): void;
  (e: 'muteChannel', ch: number): void;
  (e: 'muteCoil', coilIndex: number): void;
}>();
const hoverCh = defineModel<number | null>('hoverCh', { default: null });
const uid = useId();

const RULER_H = 20;
const VEL_H = 40;
const LANE_HEAD_H = 24;
const LANE_H = 50;
const SPEAKER = 'var(--plasma)';

const scrollEl = ref<HTMLElement | null>(null);
const viewW = ref(800);
let ro: ResizeObserver | null = null;
onMounted(() => {
  const el = scrollEl.value;
  if (!el) return;
  viewW.value = el.clientWidth;
  if ('ResizeObserver' in window) {
    ro = new ResizeObserver((entries) => { viewW.value = entries[0].contentRect.width; });
    ro.observe(el);
  }
});
onBeforeUnmount(() => ro?.disconnect());

/* ------------------------------------------------------------- the scale */
const durationMs = computed(() => props.analysis?.durationMs ?? 0);
// null: the whole song in view
const zoom = ref<number | null>(null);
const fitPx = computed(() => (durationMs.value ? Math.max(2, (viewW.value - 8) / (durationMs.value / 1000)) : 40));
const pxPerSec = computed(() => zoom.value ?? fitPx.value);
function zoomBy(f: number): void {
  zoom.value = Math.max(fitPx.value, Math.min(400, pxPerSec.value * f));
  if (zoom.value <= fitPx.value * 1.001) zoom.value = null;
}
const widthPx = computed(() => Math.max(viewW.value, (durationMs.value / 1000) * pxPerSec.value));
const xOf = (ms: number): number => (ms / 1000) * pxPerSec.value;

const channels = computed(() => props.profiles);

/* ------------------------------------------- the score's height, dragged */
const ROLL_KEY = 'atelierRollH';
const clampRoll = (h: number): number => Math.max(140, Math.min(1000, Math.round(h)));
function storedRoll(): number | null {
  try {
    const v = Number(localStorage.getItem(ROLL_KEY));
    return v > 0 ? clampRoll(v) : null;
  } catch {
    return null;
  }
}
const userRoll = ref<number | null>(storedRoll());
const rollH = computed(() => userRoll.value ?? clampRoll(Math.max(260, Math.min(520, window.innerHeight * 0.42))));
function keepRoll(): void {
  try {
    if (userRoll.value != null) localStorage.setItem(ROLL_KEY, String(userRoll.value));
  } catch {
    /* private window: the height just isn't kept */
  }
}
let grip: { y: number; h: number } | null = null;
function onGripDown(e: PointerEvent): void {
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  grip = { y: e.clientY, h: rollH.value };
  e.preventDefault();
}
function onGripMove(e: PointerEvent): void {
  if (grip) userRoll.value = clampRoll(grip.h + e.clientY - grip.y);
}
function onGripUp(): void {
  if (!grip) return;
  grip = null;
  keepRoll();
}
function onGripKey(e: KeyboardEvent): void {
  const d = e.key === 'ArrowDown' ? 24 : e.key === 'ArrowUp' ? -24 : 0;
  if (!d) return;
  e.preventDefault();
  userRoll.value = clampRoll(rollH.value + d);
  keepRoll();
}
const pitch = computed(() => {
  const r = props.analysis?.pitchRange ?? { min: 48, max: 72 };
  return { min: r.min - 1, max: r.max + 1 };
});
const rowH = computed(() => rollH.value / Math.max(1, pitch.value.max - pitch.value.min + 1));
const velTop = computed(() => RULER_H + rollH.value);
const lanesTop = computed(() => velTop.value + VEL_H + LANE_HEAD_H);
const heightPx = computed(() => lanesTop.value + props.loadCoils.length * LANE_H);

/* -------------------------------------------------------------- the ruler */
const bars = computed(() => {
  const a = props.analysis;
  if (!a?.beats.length) return [];
  const per = a.beatsPerBar || 4;
  const starts = a.beats.filter((_, i) => i % per === 0);
  // a number every so many bars, never closer than 36 px
  const barPx = starts.length > 1 ? xOf(starts[1] - starts[0]) : 100;
  const every = Math.max(1, Math.ceil(36 / Math.max(1, barPx)));
  return starts.map((ms, i) => ({ x: xOf(ms), label: i % every === 0 ? String(i + 1) : '' }));
});

/* -------------------------------------------------------------- the notes */
function destColors(ch: number): string[] {
  const cols = props.coils.filter((c) => c.channelMask & (1 << ch)).map((c) => coilColor(c.coilIndex));
  if (props.output2Mask & (1 << ch)) cols.push(SPEAKER);
  return cols;
}
const destKey = (ch: number): string => props.coils.filter((c) => c.channelMask & (1 << ch)).map((c) => c.coilIndex).join('-')
  + (props.output2Mask & (1 << ch) ? '-s' : '');
const patterns = computed(() => {
  const seen = new Map<string, string[]>();
  for (const p of channels.value) {
    const cols = destColors(p.ch);
    if (cols.length > 1) seen.set(destKey(p.ch), cols);
  }
  return [...seen].map(([key, colors]) => ({ id: `${uid}-n${key}`, colors }));
});
function fillOf(ch: number): string {
  const cols = destColors(ch);
  if (!cols.length) return 'var(--text-mute)';
  return cols.length === 1 ? cols[0] : `url(#${uid}-n${destKey(ch)})`;
}
const notes = computed(() => {
  const a = props.analysis;
  if (!a) return [];
  const rh = rowH.value;
  const fills = new Map(channels.value.map((p) => [p.ch, fillOf(p.ch)]));
  return a.notes.map((n) => ({
    ch: n.channel,
    x: xOf(n.startMs),
    w: Math.max(1.5, xOf(n.endMs - n.startMs)),
    y: RULER_H + (pitch.value.max - n.note) * rh,
    h: Math.max(1.5, rh - 0.6),
    fill: fills.get(n.channel) ?? 'var(--text-mute)',
    op: 0.45 + 0.55 * (n.velocity / 127) * n.volume,
    vh: Math.max(1, (VEL_H - 6) * (n.velocity / 127) * n.volume),
    routed: destColors(n.channel).length > 0,
  }));
});
const chMuted = (ch: number): boolean => (props.mutedChannels & (1 << ch)) !== 0;
const coilMuted = (k: number): boolean => (props.mutedCoils & (1 << k)) !== 0;
// a note no coil left unmuted plays is out of the listening
const silent = (ch: number): boolean => chMuted(ch)
  || (props.coils.some((c) => c.channelMask & (1 << ch)) && props.coils.every((c) => !(c.channelMask & (1 << ch)) || coilMuted(c.coilIndex))
    && !(props.output2Mask & (1 << ch)));
const dim = (ch: number): boolean => (hoverCh.value != null && hoverCh.value !== ch) || silent(ch);

/* ---------------------------------------------------------- the coils' lanes */
const mode = computed(() => loadMode.value);
function setMode(m: LoadMode): void { loadMode.value = m; }
const lanes = computed(() => {
  const sim = props.sim;
  if (!sim?.tracks.length) return [];
  const W = widthPx.value;
  return props.loadCoils.map((c, i) => {
    const limit = loadLimit(mode.value, c.limits);
    const top = lanesTop.value + i * LANE_H;
    const lane = loadLane(sim.tracks[i], mode.value, limit, { width: W, top, height: LANE_H, cols: Math.max(40, Math.floor(W / 3)) });
    return { ...lane, ...c, top, color: coilColor(c.coilIndex) };
  });
});

/* ------------------------------------------------------------- the channels */
function envPath(program: number, w = 34, h = 12): string {
  const steps = programSteps(program);
  let d = '';
  for (let i = 0; i < 40; i++) {
    const amp = Math.min(1.4, stepsAmplitude(steps, i * 30, null));
    d += `${i ? 'L' : 'M'}${((i / 39) * w).toFixed(1)} ${(h - 1 - (amp / 1.4) * (h - 2)).toFixed(1)}`;
  }
  return d;
}
const rows = computed(() => channels.value.map((p) => {
  const program = props.programs[p.ch] ?? p.program;
  return {
    ...p, program, envName: envelope(program).name, env: envPath(program), colors: destColors(p.ch),
    range: `${noteName(p.lo)}–${noteName(p.hi)}`,
  };
}));

/* ------------------------------------------------------- playhead and seeking */
// moved every frame on its own: redrawing the score 60 times a second would not keep up
const headEl = ref<HTMLElement | null>(null);
let headRaf = 0;
function paintHead(ms: number): void {
  const x = xOf(ms);
  if (headEl.value) headEl.value.style.transform = `translateX(${x}px)`;
  // while playing, the playhead stays in view
  const el = scrollEl.value;
  if (!el || !props.playing || zoom.value == null) return;
  if (x < el.scrollLeft + 40 || x > el.scrollLeft + el.clientWidth - 60) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.25);
}
function followClock(): void {
  paintHead(props.clock?.() ?? props.playheadMs ?? 0);
  headRaf = requestAnimationFrame(followClock);
}
watch(() => props.playing, (playing) => {
  cancelAnimationFrame(headRaf);
  if (playing) followClock();
  else paintHead(props.playheadMs ?? 0);
}, { immediate: true });
watch([() => props.playheadMs, pxPerSec], () => { if (!props.playing) paintHead(props.playheadMs ?? 0); });
onMounted(() => paintHead(props.playheadMs ?? 0));
onBeforeUnmount(() => cancelAnimationFrame(headRaf));
function onSeek(e: PointerEvent): void {
  const svg = e.currentTarget as SVGElement;
  const r = svg.getBoundingClientRect();
  const y = e.clientY - r.top;
  if (y > velTop.value + VEL_H) return; // the lanes are for reading
  emit('seek', Math.max(0, Math.min(durationMs.value, ((e.clientX - r.left) / pxPerSec.value) * 1000)));
}
// a zoom keeps the playhead where it was on screen
watch(pxPerSec, (_, before) => {
  const el = scrollEl.value;
  if (!el || !before) return;
  const at = ((props.playheadMs ?? 0) / 1000) * before - el.scrollLeft;
  nextTick(() => { el.scrollLeft = Math.max(0, xOf(props.playheadMs ?? 0) - at); });
});
function onWheel(e: WheelEvent): void {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  zoomBy(e.deltaY < 0 ? 1.25 : 0.8);
}
</script>

<template>
  <div class="tl" :style="{ '--ruler-h': RULER_H + 'px', '--roll-h': rollH + 'px', '--vel-h': VEL_H + 'px', '--lane-head-h': LANE_HEAD_H + 'px', '--lane-h': LANE_H + 'px' }">
    <div class="tl__top"><slot name="actions"></slot><span class="tl__spacer"></span><slot name="bar"></slot></div>
    <div class="tl__grid">
      <div class="tl__side">
        <div class="tl__corner">
          <span class="tl__title">{{ $t('atelier.channels') }}</span>
          <span class="tl__zoom">
            <button type="button" :title="$t('atelier.zoomOut')" :aria-label="$t('atelier.zoomOut')" :disabled="zoom == null"
              @click="zoomBy(0.66)"><i class="fas fa-magnifying-glass-minus"></i></button>
            <button type="button" :title="$t('atelier.zoomIn')" :aria-label="$t('atelier.zoomIn')" @click="zoomBy(1.5)">
              <i class="fas fa-magnifying-glass-plus"></i></button>
          </span>
        </div>
        <div class="tl__chans">
          <div v-for="r in rows" :key="r.ch" class="tl__chan" :class="{ 'is-hover': hoverCh === r.ch, 'is-dim': dim(r.ch) }"
            @mouseenter="hoverCh = r.ch" @mouseleave="hoverCh = null">
            <div class="tl__chan-top">
              <button type="button" class="tl__mute" :class="{ 'is-on': chMuted(r.ch) }" :aria-pressed="chMuted(r.ch)"
                :title="chMuted(r.ch) ? $t('atelier.unmute') : $t('atelier.mute')" :aria-label="chMuted(r.ch) ? $t('atelier.unmute') : $t('atelier.mute')"
                @click="emit('muteChannel', r.ch)"><i class="fas" :class="chMuted(r.ch) ? 'fa-volume-xmark' : 'fa-volume-high'"></i></button>
              <span class="tl__dests">
                <span v-for="(c, i) in r.colors" :key="i" class="tl__dest" :style="{ '--c': c }"></span>
                <span v-if="!r.colors.length" class="tl__dest is-none" :title="$t('atelier.unrouted')"></span>
              </span>
              <span class="tl__chan-name">{{ $t('label.channel') }} {{ r.ch }}</span>
              <drop-menu trigger-class="tl__role" :class="`is-${r.role}`" :label="$t('atelier.roleHint')" float>
                <template #trigger>{{ $t(`atelier.roles.${r.role}`) }}</template>
                <button v-for="role in ROLES" :key="role" class="dropdown__item" :class="{ 'is-active': role === r.role }"
                  type="button" @click="emit('role', r.ch, role)">{{ $t(`atelier.roles.${role}`) }}</button>
              </drop-menu>
            </div>
            <span class="tl__chan-meta">{{ r.range }} · {{ $t('atelier.notes', r.count) }}</span>
            <span class="tl__env" :title="`P${r.program} · ${r.envName}`">
              <svg viewBox="0 0 34 12" aria-hidden="true"><path :d="r.env"></path></svg>{{ r.envName }}
            </span>
          </div>
        </div>
        <div class="tl__vel-label">{{ $t('atelier.velocity') }}</div>
        <div class="tl__lane-head">
          <span class="tl__title">{{ $t('atelier.load') }}</span>
          <span class="tl__modes" role="group" :aria-label="$t('ontime.load.title')">
            <button type="button" :class="{ 'is-on': mode === 'duty' }" :aria-pressed="mode === 'duty'"
              :title="$t('ontime.load.keyDuty')" @click="setMode('duty')">{{ $t('ontime.load.duty') }}</button>
            <button type="button" :class="{ 'is-on': mode === 'ontime' }" :aria-pressed="mode === 'ontime'"
              :title="$t('ontime.load.keyPulse')" @click="setMode('ontime')">{{ $t('ontime.load.ontime') }}</button>
          </span>
        </div>
        <div v-for="c in loadCoils" :key="c.coilIndex" class="tl__lane-label" :class="{ 'is-muted': coilMuted(c.coilIndex) }"
          :style="{ '--c': coilColor(c.coilIndex) }">
          <span class="tl__lane-text">
            <b :title="c.name ? `${$t('label.coil')} ${c.coilIndex}` : undefined">{{ c.name || `${$t('label.coil')} ${c.coilIndex}` }}</b>
            <span>{{ c.ontimeUs }} µs · {{ pctLabel(c.duty) }} %</span>
          </span>
          <button type="button" class="tl__mute" :class="{ 'is-on': coilMuted(c.coilIndex) }" :aria-pressed="coilMuted(c.coilIndex)"
            :title="coilMuted(c.coilIndex) ? $t('atelier.unmute') : $t('atelier.mute')"
            :aria-label="coilMuted(c.coilIndex) ? $t('atelier.unmute') : $t('atelier.mute')"
            @click="emit('muteCoil', c.coilIndex)"><i class="fas" :class="coilMuted(c.coilIndex) ? 'fa-volume-xmark' : 'fa-volume-high'"></i></button>
        </div>
      </div>

      <div ref="scrollEl" class="tl__scroll" @wheel="onWheel">
        <svg class="tl__svg" :width="widthPx" :height="heightPx" @pointerdown="onSeek">
          <defs>
            <pattern v-for="p in patterns" :id="p.id" :key="p.id" :width="4 * p.colors.length" height="4"
              patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect v-for="(c, i) in p.colors" :key="i" :x="i * 4" y="0" width="4" height="4" :fill="c"></rect>
            </pattern>
            <pattern :id="`${uid}-hatch`" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect class="cload__hatch-bg" width="6" height="6"></rect>
              <line class="cload__hatch-line" x1="0" y1="0" x2="0" y2="6"></line>
            </pattern>
          </defs>
          <rect class="tl__ruler-bg" x="0" y="0" :width="widthPx" :height="RULER_H"></rect>
          <g v-for="(b, i) in bars" :key="i">
            <line class="tl__bar" :x1="b.x" :x2="b.x" :y1="b.label ? 0 : RULER_H * 0.5" :y2="velTop + VEL_H"></line>
            <text v-if="b.label" class="tl__bar-num" :x="b.x + 3" :y="RULER_H - 6">{{ b.label }}</text>
          </g>
          <g class="tl__notes">
            <rect v-for="(n, i) in notes" :key="i" :x="n.x" :y="n.y" :width="n.w" :height="n.h" rx="1" :fill="n.fill"
              :fill-opacity="dim(n.ch) ? 0.12 : n.op" :class="{ 'is-unrouted': !n.routed }"></rect>
          </g>
          <line class="tl__sep" x1="0" :x2="widthPx" :y1="velTop" :y2="velTop"></line>
          <g class="tl__vel">
            <line v-for="(n, i) in notes" :key="i" :x1="n.x + 0.5" :x2="n.x + 0.5" :y1="velTop + VEL_H - 2" :y2="velTop + VEL_H - 2 - n.vh"
              :stroke="n.routed ? n.fill.startsWith('url') ? 'var(--text-dim)' : n.fill : 'var(--text-mute)'" :stroke-opacity="dim(n.ch) ? 0.12 : 0.85"></line>
          </g>
          <rect class="tl__lane-head-bg" x="0" :y="velTop + VEL_H" :width="widthPx" :height="LANE_HEAD_H"></rect>
          <g v-for="l in lanes" :key="l.coilIndex" :style="{ '--c': l.color }" :class="{ 'is-muted': coilMuted(l.coilIndex) }">
            <line class="tl__sep" x1="0" :x2="widthPx" :y1="l.top" :y2="l.top"></line>
            <path class="cload__area" :d="l.area"></path>
            <path class="cload__line" :d="l.line"></path>
            <path v-if="l.over" :d="l.over" :fill="`url(#${uid}-hatch)`" class="cload__over"></path>
            <line v-if="l.capY != null" class="cload__cap" x1="0" :x2="widthPx" :y1="l.capY" :y2="l.capY"></line>
            <path v-if="l.lost" class="cload__lost" :d="l.lost"></path>
            <template v-if="marks && marks.coilIndex === l.coilIndex">
              <line v-for="(m, k) in marks.list" :key="k" class="tl__mark" :class="`is-${m[1]}`" :x1="xOf(m[0])" :x2="xOf(m[0])"
                :y1="l.top + 2" :y2="l.top + LANE_H - 2"></line>
            </template>
          </g>
        </svg>
        <span ref="headEl" class="tl__playhead" :style="{ height: heightPx + 'px' }"></span>
        <p v-if="!analysis" class="tl__empty"><span class="arc-loader" aria-hidden="true"></span>{{ $t('label.loading') }}…</p>
      </div>
    </div>
    <div class="tl__grip" role="separator" aria-orientation="horizontal" tabindex="0" :aria-label="$t('atelier.resizeTimeline')"
      :title="$t('atelier.resizeTimeline')" @pointerdown="onGripDown" @pointermove="onGripMove" @pointerup="onGripUp"
      @pointercancel="onGripUp" @keydown="onGripKey"><span></span></div>
  </div>
</template>
