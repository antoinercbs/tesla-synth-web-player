<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { notify } from '@/ui/helpers/toast';
import type { MidEditor } from '@/model/midi/edit/editor';
import { RollGeometry } from './roll/geometry';
import { RollPainter } from './roll/painter';
import { RollGestures } from './roll/gestures';

/**
 * The editor's piano roll: the notes on a canvas (a file can hold tens of
 * thousands), with the keyboard, the bar ruler and the velocity lane. Times are
 * the file's ticks; `grid` is the snapping step in ticks, 0 for none.
 */
const props = defineProps<{
  ed: MidEditor;
  rev: number;
  tool: 'select' | 'pencil';
  grid: number;
  pencilChannel: number;
  /** While it plays the playhead moves over the roll, which is not redrawn for it. */
  playing?: boolean;
}>();
/** px per beat */
const zoom = defineModel<number>('zoom', { required: true });
const emit = defineEmits<{ (e: 'preview', channel: number, note: number): void; (e: 'seek'): void }>();
const { t, locale } = useI18n();

const { KEY_H, KB_W, RULER_H } = RollGeometry;
const MIN_ZOOM = 8;
const MAX_ZOOM = 220;

const area = ref<HTMLElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
const rollCv = ref<HTMLCanvasElement | null>(null);
const velWrap = ref<HTMLElement | null>(null);
const velCv = ref<HTMLCanvasElement | null>(null);
const rangeBar = ref<HTMLElement | null>(null);
const chip = ref<HTMLElement | null>(null);
const head = ref<HTMLElement | null>(null);
const velHead = ref<HTMLElement | null>(null);
// the scroller's visible size, kept here: read every frame while it plays, it would force a layout
let viewW = 0, viewH = 0;

const geo = new RollGeometry({
  scrollX: () => scroller.value?.scrollLeft ?? 0,
  scrollY: () => scroller.value?.scrollTop ?? 0,
  zoom: () => zoom.value,
  ticksPerBeat: () => props.ed.doc.ticksPerBeat,
  beatsPerBar: () => props.ed.doc.beatsPerBar(),
  grid: () => props.grid,
});
const painter = new RollPainter(geo);
const gestures = new RollGestures(geo, {
  ed: () => props.ed,
  tool: () => props.tool,
  pencilChannel: () => props.pencilChannel,
  scroller: () => scroller.value,
  velCanvas: () => velCv.value,
  draw: () => draw(),
  preview: (ch, note) => emit('preview', ch, note),
  seek: () => emit('seek'),
  created: (ch) => notify(t('midiEditor.channelCreated', { ch, program: props.ed.programOf(ch) }), 'info'),
});

const spacer = computed(() => {
  void props.rev;
  const bar = geo.bar;
  const ticks = Math.max(16 * bar, (Math.ceil(props.ed.endTick() / bar) + 2) * bar);
  return { width: `${KB_W + ticks * geo.pxPerTick}px`, height: `${RULER_H + 128 * KEY_H}px` };
});
const silence = computed(() => {
  void props.rev;
  return props.ed.leadingSilence();
});
const silenceLabel = computed(() =>
  `${(props.ed.map.toMs(silence.value) / 1000).toLocaleString(locale.value, { maximumFractionDigits: 1 })} s`);
const range = computed(() => {
  void props.rev;
  return props.ed.range;
});

/* --------------------------------- drawing --------------------------------- */
// the floating pieces hang from what they act on, kept inside the view
function placeOverlays(): void {
  const sc = scroller.value;
  if (!sc) return;
  const top = RULER_H + 8;
  if (chip.value) { chip.value.style.left = `${KB_W + 10}px`; chip.value.style.top = `${top}px`; }
  const bar = rangeBar.value, r = props.ed.range;
  if (bar && r) {
    const max = sc.clientWidth - bar.offsetWidth - 8;
    bar.style.left = `${Math.max(KB_W + 8, Math.min(max, geo.xOf(r.a) + 8))}px`;
    bar.style.top = `${top + (chip.value ? 34 : 0)}px`;
  }
}

let frame = 0;
function draw(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    drawNow();
  });
}
function drawNow(): void {
  const el = area.value, sc = scroller.value;
  if (!el) return;
  const th = RollPainter.theme(el), still = !props.playing;
  if (sc && rollCv.value) painter.roll(rollCv.value, { w: el.clientWidth, h: el.clientHeight }, { w: sc.clientWidth, h: sc.clientHeight }, props.ed, gestures.hoverPitch, gestures.band, th, still);
  if (sc && velCv.value && velWrap.value) {
    painter.vel(velCv.value, { w: velWrap.value.clientWidth, h: velWrap.value.clientHeight }, sc.clientWidth, props.ed, t('midiEditor.velShort'), th, still);
  }
  placeOverlays();
  if (head.value) Object.assign(head.value.style, { top: `${RULER_H}px`, height: `${Math.max(0, viewH - RULER_H)}px` });
  placeHead();
}
watch(() => [props.rev, props.grid, zoom.value, props.playing], () => draw(), { flush: 'post' });

/** The playhead over the roll while it plays, where the canvas's own would be. */
function placeHead(): void {
  const x = Math.round(geo.xOf(props.ed.playhead));
  const shown = !!props.playing && x >= KB_W && x <= viewW;
  for (const el of [head.value, velHead.value]) {
    if (!el) continue;
    el.style.visibility = shown ? 'visible' : 'hidden';
    el.style.transform = `translateX(${x}px)`;
  }
}

/* ------------------------------- interactions ------------------------------ */
function onWheel(e: WheelEvent): void {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, gestures.local(e).x);
}
function zoomBy(f: number, anchorX?: number): void {
  const sc = scroller.value;
  if (!sc) return;
  const ax = anchorX ?? (KB_W + sc.clientWidth) / 2;
  const tk = geo.tickAt(ax);
  zoom.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom.value * f));
  // the spacer grows on the next render: scroll once it has
  nextTick(() => {
    sc.scrollLeft = KB_W + tk * geo.pxPerTick - ax;
    draw();
  });
}

function onVelWheel(e: WheelEvent): void {
  const sc = scroller.value;
  if (!sc) return;
  e.preventDefault();
  sc.scrollLeft += e.deltaY + e.deltaX;
}

/* ------------------------------ passage & trim ----------------------------- */
function trim(): void {
  const cut = props.ed.trimLeading();
  if (scroller.value) scroller.value.scrollLeft = 0;
  if (cut) notify(t('midiEditor.trimmed', { s: silenceText(cut) }), 'info');
}
function silenceText(ticks: number): string {
  return `${(props.ed.map.toMs(ticks) / 1000).toLocaleString(locale.value, { maximumFractionDigits: 1 })} s`;
}
function selectPassage(): void {
  const r = props.ed.range;
  if (r) props.ed.select(props.ed.visibleNotes().filter((n) => n.tick >= r.a && n.tick < r.b));
}
function cutPassage(): void {
  const n = props.ed.cutPassage();
  notify(t('midiEditor.passageCut', n), 'info');
}
function keepPassage(): void {
  props.ed.keepPassage();
  if (scroller.value) scroller.value.scrollLeft = 0;
  notify('midiEditor.passageKept', 'info');
}
function clearRange(): void {
  props.ed.setRange(null);
}

/* --------------------------------- follow ---------------------------------- */
/** Keeps the playhead in view while playing: a page turned redraws the roll (its scroll does), the rest moves the playhead only. */
function follow(): void {
  const sc = scroller.value;
  if (!sc) return;
  const x = geo.xOf(props.ed.playhead);
  if (x > viewW - 40 || x < KB_W) sc.scrollLeft += x - KB_W - 40;
  placeHead();
}
function centerOnNotes(): void {
  const sc = scroller.value, notes = props.ed.notes;
  if (!sc) return;
  const lo = notes.length ? Math.min(...notes.map((n) => n.note)) : 48;
  const hi = notes.length ? Math.max(...notes.map((n) => n.note)) : 72;
  const mid = (lo + hi) / 2;
  sc.scrollTop = Math.max(0, RULER_H + (127 - mid) * KEY_H - sc.clientHeight / 2);
}
defineExpose({ zoomBy, follow, redraw: drawNow });

let resize: ResizeObserver | null = null;
onMounted(() => {
  resize = new ResizeObserver(() => {
    viewW = scroller.value?.clientWidth ?? 0;
    viewH = scroller.value?.clientHeight ?? 0;
    draw();
  });
  if (area.value) resize.observe(area.value);
  if (velWrap.value) resize.observe(velWrap.value);
  centerOnNotes();
  draw();
});
onBeforeUnmount(() => {
  resize?.disconnect();
  if (frame) cancelAnimationFrame(frame);
});
</script>

<template>
  <div class="roll">
    <div ref="area" class="roll__area">
      <canvas ref="rollCv" class="roll__canvas"></canvas>
      <div ref="head" class="roll__head" aria-hidden="true"></div>
      <div ref="scroller" class="roll__scroller" tabindex="0" @pointerdown="gestures.pointerDown" @pointermove="gestures.pointerMove"
        @pointerup="gestures.pointerUp" @pointercancel="gestures.pointerUp" @pointerleave="gestures.leave" @dblclick="gestures.dblClick"
        @contextmenu="gestures.contextMenu" @scroll="draw" @wheel="onWheel">
        <div class="roll__spacer" :style="spacer"></div>
      </div>
      <button v-if="silence > 0" ref="chip" class="roll-chip" type="button" @click="trim">
        <i class="fas fa-backward-step"></i>{{ $t('midiEditor.silence', { s: silenceLabel }) }}<b>{{ $t('midiEditor.trim') }}</b>
      </button>
      <div v-if="range" ref="rangeBar" class="roll-range">
        <i class="fas fa-left-right"></i><b>{{ geo.barLabel(range.a) }} → {{ geo.barLabel(range.b) }}</b>
        <button class="btn" type="button" @click="selectPassage">
          <span class="icon"><i class="fas fa-object-group"></i></span>{{ $t('midiEditor.passageNotes') }}
        </button>
        <button class="btn" type="button" :title="$t('midiEditor.passageCutHint')" @click="cutPassage">
          <span class="icon"><i class="fas fa-scissors"></i></span>{{ $t('midiEditor.passageCutAction') }}
        </button>
        <button class="btn" type="button" @click="keepPassage">
          <span class="icon"><i class="fas fa-crop-simple"></i></span>{{ $t('midiEditor.passageKeep') }}
        </button>
        <button class="roll-range__x" type="button" :title="$t('midiEditor.passageForget')" :aria-label="$t('midiEditor.passageForget')"
          @click="clearRange"><i class="fas fa-xmark"></i></button>
      </div>
    </div>
    <div ref="velWrap" class="roll__vel" :title="$t('midiEditor.velocityLaneHint')">
      <canvas ref="velCv" @pointerdown="gestures.velDown" @pointermove="gestures.velMove" @pointerup="gestures.velUp"
        @pointercancel="gestures.velUp" @wheel="onVelWheel"></canvas>
      <div ref="velHead" class="roll__head roll__head--vel" aria-hidden="true"></div>
    </div>
  </div>
</template>
