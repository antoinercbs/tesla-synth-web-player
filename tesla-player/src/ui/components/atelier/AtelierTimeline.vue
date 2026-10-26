<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from 'vue';
import type { MidiAnalysis } from '@/model/midi/analyze';
import type { CoilConfig } from '@/model/domain';
import type { CoilLimits } from '@/model/devices/coil-limits';
import type { DevSimulation, LoadMark } from '@/model/devices/simulation';
import { CalRoles, type ChannelProfile, type ChannelRole } from '@/model/calib/roles';
import { useCoilColor } from '@/ui/helpers/coil-colors';
import { MidNote } from '@/model/midi/note';
import { loadLane, loadLimit, loadMode, type LoadMode } from '@/ui/helpers/load-lane';
import { SndEnvelope } from '@/model/envelopes/envelope';
import { SndEnvPrograms } from '@/model/sysex/envelopes';
import { pctLabel } from '@/utils/format';
import DropMenu from '@/ui/components/ui/DropMenu.vue';
import LoadKey from '@/ui/components/player/LoadKey.vue';

/**
 * The song on one time axis: its notes (coloured by the coils that play them,
 * striped when several do), their velocities, and each coil's load as the board
 * plays it. Beside it, the channels with their role and envelope. A click on the
 * score moves the playhead; the bar on top holds what acts on the song (slot
 * `actions`) and the transport (slot `bar`). Each part (the score, the
 * velocities, the coils' lanes) is as tall as the user drags its lower edge, on
 * this device; a key under the lanes tells what they draw.
 */
const props = withDefaults(defineProps<{
  analysis: MidiAnalysis | null;
  coils: CoilConfig[];
  output2Mask?: number;
  profiles: ChannelProfile[];
  /** Each channel's envelope (program), the file's unless changed here. */
  programs: Record<number, number>;
  sim: DevSimulation | null;
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
  /** Débutant (ui/helpers/ui-mode.ts): the score and the channels' heads, no velocities, no load, no envelopes. */
  simple?: boolean;
}>(), { output2Mask: 0, marks: null, playheadMs: 0, playing: false, clock: null, mutedChannels: 0, mutedCoils: 0, simple: false });
const emit = defineEmits<{
  (e: 'seek', ms: number): void;
  (e: 'role', ch: number, role: ChannelRole): void;
  (e: 'muteChannel', ch: number): void;
  (e: 'muteCoil', coilIndex: number): void;
}>();
const hoverCh = defineModel<number | null>('hoverCh', { default: null });
const coilColor = useCoilColor();
const uid = useId();

const RULER_H = 20;
const LANE_HEAD_H = 24;
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

/* ------------------------------------------- the parts' heights, dragged */
// each part as tall as its lower edge was dragged; a lane's height is every lane's
const PARTS = {
  roll: { key: 'atelierRollH', min: 140, max: 1000, step: 24, def: () => Math.max(260, Math.min(520, window.innerHeight * 0.42)) },
  vel: { key: 'atelierVelH', min: 20, max: 200, step: 8, def: () => 40 },
  lane: { key: 'atelierLaneH', min: 30, max: 200, step: 8, def: () => 50 },
} as const;
type Part = keyof typeof PARTS;
const clampPart = (p: Part, h: number): number => Math.max(PARTS[p].min, Math.min(PARTS[p].max, Math.round(h)));
function storedPart(p: Part): number | null {
  try {
    const v = Number(localStorage.getItem(PARTS[p].key));
    return v > 0 ? clampPart(p, v) : null;
  } catch {
    return null;
  }
}
const userH = reactive<Record<Part, number | null>>({ roll: storedPart('roll'), vel: storedPart('vel'), lane: storedPart('lane') });
const sizeOf = (p: Part): number => userH[p] ?? clampPart(p, PARTS[p].def());
const rollH = computed(() => sizeOf('roll'));
const velH = computed(() => (props.simple ? 0 : sizeOf('vel')));
const laneHeadH = computed(() => (props.simple ? 0 : LANE_HEAD_H));
const laneH = computed(() => sizeOf('lane'));
function keepPart(p: Part): void {
  try {
    if (userH[p] != null) localStorage.setItem(PARTS[p].key, String(userH[p]));
  } catch {
    /* private window: the height just isn't kept */
  }
}
// the lanes' edge moves under them all: its pixels shared out between the lanes
let grip: { part: Part; y: number; h: number; per: number } | null = null;
function onEdgeDown(part: Part, e: PointerEvent): void {
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  grip = { part, y: e.clientY, h: sizeOf(part), per: part === 'lane' ? Math.max(1, props.loadCoils.length) : 1 };
  e.preventDefault();
}
function onEdgeMove(e: PointerEvent): void {
  if (grip) userH[grip.part] = clampPart(grip.part, grip.h + (e.clientY - grip.y) / grip.per);
}
function onEdgeUp(): void {
  if (!grip) return;
  keepPart(grip.part);
  grip = null;
}
function onEdgeKey(part: Part, e: KeyboardEvent): void {
  const d = e.key === 'ArrowDown' ? PARTS[part].step : e.key === 'ArrowUp' ? -PARTS[part].step : 0;
  if (!d) return;
  e.preventDefault();
  userH[part] = clampPart(part, sizeOf(part) + d);
  keepPart(part);
}
// the grip at the bottom: the lanes' edge, the score's while there are none
const gripPart = computed<Part>(() => (props.loadCoils.length ? 'lane' : 'roll'));
const pitch = computed(() => {
  const r = props.analysis?.pitchRange ?? { min: 48, max: 72 };
  return { min: r.min - 1, max: r.max + 1 };
});
const rowH = computed(() => rollH.value / Math.max(1, pitch.value.max - pitch.value.min + 1));
const velTop = computed(() => RULER_H + rollH.value);
const lanesTop = computed(() => velTop.value + velH.value + laneHeadH.value);
const heightPx = computed(() => lanesTop.value + props.loadCoils.length * laneH.value);

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
    vh: Math.max(1, (velH.value - 6) * (n.velocity / 127) * n.volume),
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
  // a coil just added has no track until the simulation catches up
  return props.loadCoils.slice(0, sim.tracks.length).map((c, i) => {
    const limit = loadLimit(mode.value, c.limits);
    const top = lanesTop.value + i * laneH.value;
    const lane = loadLane(sim.tracks[i], mode.value, limit, { width: W, top, height: laneH.value, cols: Math.max(40, Math.floor(W / 3)) });
    return { ...lane, ...c, top, color: coilColor(c.coilIndex) };
  });
});

/* ------------------------------------------------------------- the channels */
function envPath(program: number, w = 34, h = 12): string {
  const steps = SndEnvPrograms.steps(program);
  let d = '';
  for (let i = 0; i < 40; i++) {
    const amp = Math.min(1.4, new SndEnvelope(steps).amplitude(i * 30, null));
    d += `${i ? 'L' : 'M'}${((i / 39) * w).toFixed(1)} ${(h - 1 - (amp / 1.4) * (h - 2)).toFixed(1)}`;
  }
  return d;
}
const rows = computed(() => channels.value.map((p) => {
  const program = props.programs[p.ch] ?? p.program;
  return {
    ...p, program, envName: SndEnvPrograms.info(program).name, env: envPath(program), colors: destColors(p.ch),
    range: `${MidNote.name(p.lo)}–${MidNote.name(p.hi)}`,
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
  if (x < el.scrollLeft + 40 || x > el.scrollLeft + viewW.value - 60) el.scrollLeft = Math.max(0, x - viewW.value * 0.25);
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
  if (y > velTop.value + velH.value) return; // the lanes are for reading
  emit('seek', Math.max(0, Math.min(durationMs.value, ((e.clientX - r.left) / pxPerSec.value) * 1000)));
}
// a zoom keeps the playhead where it was on screen
watch(pxPerSec, (_, before) => {
  const el = scrollEl.value;
  if (!el || !before) return;
  const ms = props.clock?.() ?? props.playheadMs ?? 0;
  const at = (ms / 1000) * before - el.scrollLeft;
  nextTick(() => { el.scrollLeft = Math.max(0, xOf(ms) - at); });
});
function onWheel(e: WheelEvent): void {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  zoomBy(e.deltaY < 0 ? 1.25 : 0.8);
}
</script>

<template>
  <div class="tl" :style="{ '--ruler-h': RULER_H + 'px', '--roll-h': rollH + 'px', '--vel-h': velH + 'px', '--lane-head-h': laneHeadH + 'px', '--lane-h': laneH + 'px' }">
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
              <drop-menu trigger-class="tl__role" :class="`is-${r.role}`" :label="$t('atelier.roleHint')">
                <template #trigger>{{ $t(`atelier.roles.${r.role}`) }}</template>
                <button v-for="role in CalRoles.ALL" :key="role" class="dropdown__item" :class="{ 'is-active': role === r.role }"
                  type="button" @click="emit('role', r.ch, role)">{{ $t(`atelier.roles.${role}`) }}</button>
              </drop-menu>
            </div>
            <span class="tl__chan-meta">{{ r.range }} · {{ $t('atelier.notes', r.count) }}</span>
            <span v-if="!simple" class="tl__env" :title="`P${r.program} · ${r.envName}`">
              <svg viewBox="0 0 34 12" aria-hidden="true"><path :d="r.env"></path></svg>{{ r.envName }}
            </span>
          </div>
        </div>
        <div v-if="!simple" class="tl__vel-label">{{ $t('atelier.velocity') }}</div>
        <div v-if="!simple" class="tl__lane-head">
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
            <b>{{ c.name || `${$t('label.coil')} ${c.coilIndex}` }}</b>
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
            <line class="tl__bar" :x1="b.x" :x2="b.x" :y1="b.label ? 0 : RULER_H * 0.5" :y2="velTop + velH"></line>
            <text v-if="b.label" class="tl__bar-num" :x="b.x + 3" :y="RULER_H - 6">{{ b.label }}</text>
          </g>
          <g class="tl__notes">
            <rect v-for="(n, i) in notes" :key="i" :x="n.x" :y="n.y" :width="n.w" :height="n.h" rx="1" :fill="n.fill"
              :fill-opacity="dim(n.ch) ? 0.12 : n.op" :class="{ 'is-unrouted': !n.routed }"></rect>
          </g>
          <line class="tl__sep" x1="0" :x2="widthPx" :y1="velTop" :y2="velTop"></line>
          <g v-if="!simple" class="tl__vel">
            <line v-for="(n, i) in notes" :key="i" :x1="n.x + 0.5" :x2="n.x + 0.5" :y1="velTop + velH - 2" :y2="velTop + velH - 2 - n.vh"
              :stroke="n.routed ? n.fill.startsWith('url') ? 'var(--text-dim)' : n.fill : 'var(--text-mute)'" :stroke-opacity="dim(n.ch) ? 0.12 : 0.85"></line>
          </g>
          <rect v-if="!simple" class="tl__lane-head-bg" x="0" :y="velTop + velH" :width="widthPx" :height="LANE_HEAD_H"></rect>
          <g v-for="l in lanes" :key="l.coilIndex" :style="{ '--c': l.color }" :class="{ 'is-muted': coilMuted(l.coilIndex) }">
            <line class="tl__sep" x1="0" :x2="widthPx" :y1="l.top" :y2="l.top"></line>
            <path class="cload__area" :d="l.area"></path>
            <path class="cload__line" :d="l.line"></path>
            <path v-if="l.over" :d="l.over" :fill="`url(#${uid}-hatch)`" class="cload__over"></path>
            <line v-if="l.capY != null" class="cload__cap" x1="0" :x2="widthPx" :y1="l.capY" :y2="l.capY"></line>
            <path v-if="l.lost" class="cload__lost" :d="l.lost"></path>
            <path v-if="l.ocdOver" class="cload__ocd-over" :d="l.ocdOver"></path>
            <path v-if="l.ocd" class="cload__ocd" :d="l.ocd"></path>
            <path v-if="l.strikes" class="cload__strike" :d="l.strikes"></path>
            <path v-if="l.silent" class="cload__silent" :d="l.silent"></path>
            <template v-if="marks && marks.coilIndex === l.coilIndex">
              <line v-for="(m, k) in marks.list" :key="k" class="tl__mark" :class="`is-${m[1]}`" :x1="xOf(m[0])" :x2="xOf(m[0])"
                :y1="l.top + 2" :y2="l.top + laneH - 2"></line>
            </template>
          </g>
        </svg>
        <span ref="headEl" class="tl__playhead" :style="{ height: heightPx + 'px' }"></span>
        <p v-if="!analysis" class="tl__empty"><span class="arc-loader" aria-hidden="true"></span>{{ $t('label.loading') }}…</p>
      </div>
      <!-- the score's and the velocities' lower edges: dragged, they size their part -->
      <div class="tl__edge" role="separator" aria-orientation="horizontal" tabindex="0" :style="{ top: velTop + 'px' }"
        :aria-label="$t('atelier.resizeScore')" :title="$t('atelier.resizeScore')" @pointerdown="onEdgeDown('roll', $event)"
        @pointermove="onEdgeMove" @pointerup="onEdgeUp" @pointercancel="onEdgeUp" @keydown="onEdgeKey('roll', $event)"></div>
      <div v-if="!simple" class="tl__edge" role="separator" aria-orientation="horizontal" tabindex="0" :style="{ top: velTop + velH + 'px' }"
        :aria-label="$t('atelier.resizeVelocity')" :title="$t('atelier.resizeVelocity')" @pointerdown="onEdgeDown('vel', $event)"
        @pointermove="onEdgeMove" @pointerup="onEdgeUp" @pointercancel="onEdgeUp" @keydown="onEdgeKey('vel', $event)"></div>
    </div>
    <load-key v-if="lanes.length" class="tl__key" :mode="mode" :lanes="lanes" />
    <div class="tl__grip" role="separator" aria-orientation="horizontal" tabindex="0"
      :aria-label="$t(gripPart === 'lane' ? 'atelier.resizeLanes' : 'atelier.resizeScore')"
      :title="$t(gripPart === 'lane' ? 'atelier.resizeLanes' : 'atelier.resizeScore')" @pointerdown="onEdgeDown(gripPart, $event)"
      @pointermove="onEdgeMove" @pointerup="onEdgeUp" @pointercancel="onEdgeUp" @keydown="onEdgeKey(gripPart, $event)"><span></span></div>
  </div>
</template>
