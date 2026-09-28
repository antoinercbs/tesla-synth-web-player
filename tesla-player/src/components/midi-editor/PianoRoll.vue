<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { notify } from '@/utils/toast';
import { noteName } from '@/ui/piano-layout';
import { docBeatsPerBar, type EdNote } from '@/midi/edit/doc';
import type { MidiEditor } from '@/midi/edit/editor';
import { channelColors } from '@/midi/edit/colors';

/**
 * The editor's piano roll: the notes on a canvas (a file can hold tens of
 * thousands), with the keyboard, the bar ruler and the velocity lane. Times are
 * the file's ticks; `grid` is the snapping step in ticks, 0 for none.
 */
const props = defineProps<{
  ed: MidiEditor;
  rev: number;
  tool: 'select' | 'pencil';
  grid: number;
  pencilChannel: number;
}>();
/** px per beat */
const zoom = defineModel<number>('zoom', { required: true });
const emit = defineEmits<{ (e: 'preview', channel: number, note: number): void; (e: 'seek'): void }>();
const { t, locale } = useI18n();

const KEY_H = 11;
const KB_W = 46;
const RULER_H = 24;
const MIN_ZOOM = 8;
const MAX_ZOOM = 220;
// a note's right edge grabs its length within this, when the note is wide enough to keep a middle
const EDGE_PX = 7;

const area = ref<HTMLElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
const rollCv = ref<HTMLCanvasElement | null>(null);
const velWrap = ref<HTMLElement | null>(null);
const velCv = ref<HTMLCanvasElement | null>(null);
const rangeBar = ref<HTMLElement | null>(null);
const chip = ref<HTMLElement | null>(null);

const tpb = (): number => props.ed.doc.ticksPerBeat;
const barTicks = (): number => docBeatsPerBar(props.ed.doc) * tpb();
const pxPerTick = (): number => zoom.value / tpb();
const scrollX = (): number => scroller.value?.scrollLeft ?? 0;
const scrollY = (): number => scroller.value?.scrollTop ?? 0;
const xOf = (tick: number): number => KB_W + tick * pxPerTick() - scrollX();
const tickAt = (x: number): number => (x - KB_W + scrollX()) / pxPerTick();
const yOf = (p: number): number => RULER_H + (127 - p) * KEY_H - scrollY();
const pitchAt = (y: number): number => Math.min(127, Math.max(0, 127 - Math.floor((y - RULER_H + scrollY()) / KEY_H)));
const isBlack = (p: number): boolean => [1, 3, 6, 8, 10].includes(p % 12);
function snap(tick: number, free: boolean): number {
  const g = props.grid;
  return Math.max(0, free || !g ? Math.round(tick) : Math.round(tick / g) * g);
}

const spacer = computed(() => {
  void props.rev;
  const bar = barTicks();
  const ticks = Math.max(16 * bar, (Math.ceil(props.ed.endTick() / bar) + 2) * bar);
  return { width: `${KB_W + ticks * pxPerTick()}px`, height: `${RULER_H + 128 * KEY_H}px` };
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
function barLabel(tick: number): string {
  const bar = barTicks();
  return `${Math.floor(tick / bar) + 1}.${Math.floor((tick % bar) / tpb()) + 1}`;
}

/* --------------------------------- drawing --------------------------------- */
type Tint = (a: number) => string;
interface Theme { bg: string; side: string; text: string; mute: string; bright: string; mono: string; line: Tint; volt: Tint; hi: Tint; lo: Tint; chan: string[] }
// the tokens, read once per frame: a canvas can't take a var()
function theme(): Theme {
  const el = area.value as Element;
  const s = getComputedStyle(el);
  const v = (name: string): string => s.getPropertyValue(name).trim();
  const tint = (name: string): Tint => { const rgb = v(name); return (a) => `rgb(${rgb} / ${a})`; };
  return {
    bg: v('--bg-2'),
    side: v('--panel'),
    text: v('--text-dim'),
    mute: v('--text-mute'),
    bright: v('--text-bright'),
    mono: v('--font-mono'),
    line: tint('--line-rgb'),
    volt: tint('--volt-rgb'),
    hi: tint('--hi-rgb'),
    lo: tint('--lo-rgb'),
    chan: channelColors(el),
  };
}
function fit(cv: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D {
  const d = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) {
    cv.width = Math.round(w * d);
    cv.height = Math.round(h * d);
  }
  cv.style.width = `${w}px`;
  cv.style.height = `${h}px`;
  const c = cv.getContext('2d') as CanvasRenderingContext2D;
  c.setTransform(d, 0, 0, d, 0, 0);
  return c;
}

let hoverPitch = -1;
function drawRoll(th: Theme): void {
  const el = area.value, sc = scroller.value, cv = rollCv.value;
  if (!el || !sc || !cv) return;
  const c = fit(cv, el.clientWidth, el.clientHeight);
  const W = sc.clientWidth, H = sc.clientHeight, ed = props.ed;
  c.clearRect(0, 0, el.clientWidth, el.clientHeight);
  c.fillStyle = th.bg;
  c.fillRect(0, 0, W, H);

  const pHi = pitchAt(RULER_H), pLo = pitchAt(H);
  for (let p = pLo; p <= pHi; p++) {
    const y = yOf(p);
    if (isBlack(p)) { c.fillStyle = th.lo(0.22); c.fillRect(KB_W, y, W - KB_W, KEY_H); }
    if (p === hoverPitch) { c.fillStyle = th.volt(0.06); c.fillRect(KB_W, y, W - KB_W, KEY_H); }
    if (p % 12 === 0) { c.fillStyle = th.line(0.16); c.fillRect(KB_W, y + KEY_H - 1, W - KB_W, 1); }
  }

  const beat = tpb(), bar = barTicks();
  const t0 = Math.max(0, Math.floor(tickAt(KB_W) / beat) * beat), t1 = tickAt(W);
  const sub = props.grid > 0 && props.grid < beat && props.grid * pxPerTick() >= 9 ? props.grid : beat;
  for (let tk = t0; tk <= t1; tk += sub) {
    const x = Math.round(xOf(tk)) + 0.5;
    if (x < KB_W) continue;
    const isBar = tk % bar === 0, isBeat = tk % beat === 0;
    if (!isBar && zoom.value < 20) continue;
    c.strokeStyle = isBar ? th.line(0.3) : isBeat ? th.line(0.12) : th.line(0.05);
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, RULER_H); c.lineTo(x, H); c.stroke();
  }

  c.save();
  c.beginPath(); c.rect(KB_W, RULER_H, W - KB_W, H - RULER_H); c.clip();
  const r = ed.range;
  if (r) {
    const xa = xOf(r.a), xb = xOf(r.b);
    c.fillStyle = th.volt(0.07);
    c.fillRect(xa, RULER_H, xb - xa, H - RULER_H);
    c.strokeStyle = th.volt(0.45);
    c.setLineDash([4, 4]);
    for (const x of [xa, xb]) { c.beginPath(); c.moveTo(Math.round(x) + 0.5, RULER_H); c.lineTo(Math.round(x) + 0.5, H); c.stroke(); }
    c.setLineDash([]);
  }
  const drawNote = (n: EdNote, isSel: boolean): void => {
    const x = xOf(n.tick), w = Math.max(3, n.dur * pxPerTick());
    if (x + w < KB_W || x > W) return;
    const y = yOf(n.note);
    if (y + KEY_H < RULER_H || y > H) return;
    // the fill says how loud: on the Syntherrupter the velocity is the note's power
    c.globalAlpha = (ed.muted.has(n.channel) ? 0.3 : 1) * (0.42 + (0.58 * n.velocity) / 127);
    c.fillStyle = th.chan[n.channel];
    c.beginPath(); c.roundRect(x + 0.5, y + 1, Math.max(1, w - 1), KEY_H - 2, 2); c.fill();
    c.globalAlpha = 1;
    if (isSel) {
      c.strokeStyle = th.bright;
      c.lineWidth = 1.5;
      c.beginPath(); c.roundRect(x + 0.5, y + 1, Math.max(1, w - 1), KEY_H - 2, 2); c.stroke();
    }
  };
  const vis = ed.visibleNotes();
  for (const n of vis) if (!ed.sel.has(n.id)) drawNote(n, false);
  for (const n of vis) if (ed.sel.has(n.id)) drawNote(n, true);
  if (drag?.kind === 'band' && drag.t1 != null && drag.p1 != null) {
    const xa = xOf(Math.min(drag.t0, drag.t1)), xb = xOf(Math.max(drag.t0, drag.t1));
    const ya = yOf(Math.max(drag.p0, drag.p1)), yb = yOf(Math.min(drag.p0, drag.p1)) + KEY_H;
    c.fillStyle = th.volt(0.12);
    c.fillRect(xa, ya, xb - xa, yb - ya);
    c.strokeStyle = th.volt(0.8);
    c.lineWidth = 1;
    c.strokeRect(xa + 0.5, ya + 0.5, xb - xa, yb - ya);
  }
  const xp = Math.round(xOf(ed.playhead)) + 0.5;
  c.strokeStyle = th.hi(0.75);
  c.beginPath(); c.moveTo(xp, RULER_H); c.lineTo(xp, H); c.stroke();
  c.restore();

  // keyboard
  c.fillStyle = th.side;
  c.fillRect(0, RULER_H, KB_W, H - RULER_H);
  c.font = `9px ${th.mono}`;
  c.textAlign = 'right';
  c.textBaseline = 'middle';
  for (let p = pLo; p <= pHi; p++) {
    const y = yOf(p);
    c.fillStyle = p === hoverPitch ? th.volt(0.35) : isBlack(p) ? th.bg : th.line(0.16);
    c.fillRect(0, y, isBlack(p) ? KB_W * 0.62 : KB_W - 1, KEY_H - 1);
    if (p % 12 === 0) { c.fillStyle = th.text; c.fillText(noteName(p), KB_W - 5, y + KEY_H / 2); }
  }
  c.fillStyle = th.line(0.12);
  c.fillRect(KB_W - 1, RULER_H, 1, H - RULER_H);

  // ruler
  c.fillStyle = th.side;
  c.fillRect(0, 0, W, RULER_H);
  c.save();
  c.beginPath(); c.rect(KB_W, 0, W - KB_W, RULER_H); c.clip();
  if (r) { c.fillStyle = th.volt(0.28); c.fillRect(xOf(r.a), 3, xOf(r.b) - xOf(r.a), RULER_H - 6); }
  const barPx = bar * pxPerTick();
  const every = barPx < 34 ? 4 : barPx < 60 ? 2 : 1;
  c.font = `10px ${th.mono}`;
  c.textAlign = 'left';
  for (let b = Math.floor(t0 / bar); b * bar <= t1; b++) {
    const x = Math.round(xOf(b * bar)) + 0.5;
    c.strokeStyle = th.line(0.35);
    c.beginPath(); c.moveTo(x, RULER_H - 8); c.lineTo(x, RULER_H); c.stroke();
    if (b % every === 0) { c.fillStyle = th.text; c.fillText(String(b + 1), x + 4, RULER_H / 2); }
  }
  c.fillStyle = th.bright;
  c.beginPath(); c.moveTo(xp - 5, RULER_H - 7); c.lineTo(xp + 5, RULER_H - 7); c.lineTo(xp, RULER_H); c.fill();
  c.restore();
  c.fillStyle = th.line(0.16);
  c.fillRect(0, RULER_H - 1, W, 1);
  c.fillStyle = th.side;
  c.fillRect(0, 0, KB_W, RULER_H - 1);
}

function drawVel(th: Theme): void {
  const el = velWrap.value, cv = velCv.value, sc = scroller.value;
  if (!el || !cv || !sc) return;
  const h = el.clientHeight, W = sc.clientWidth, ed = props.ed;
  const c = fit(cv, el.clientWidth, h);
  c.clearRect(0, 0, el.clientWidth, h);
  c.fillStyle = th.bg;
  c.fillRect(0, 0, W, h);
  c.fillStyle = th.side;
  c.fillRect(0, 0, KB_W, h);
  c.fillStyle = th.mute;
  c.font = `9px ${th.mono}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(t('midiEditor.velShort'), KB_W / 2, h / 2);
  c.save();
  c.beginPath(); c.rect(KB_W, 0, W - KB_W, h); c.clip();
  for (const f of [0.25, 0.5, 0.75, 1]) {
    const y = Math.round(h - 4 - (h - 8) * f) + 0.5;
    c.strokeStyle = th.line(0.08);
    c.beginPath(); c.moveTo(KB_W, y); c.lineTo(W, y); c.stroke();
  }
  const vis = ed.visibleNotes(), any = ed.sel.size > 0;
  for (const pass of [false, true]) {
    for (const n of vis) {
      if (ed.sel.has(n.id) !== pass) continue;
      const x = xOf(n.tick);
      if (x < KB_W - 4 || x > W) continue;
      const bh = ((h - 8) * n.velocity) / 127;
      c.globalAlpha = pass ? 1 : any ? 0.25 : 0.6;
      c.fillStyle = th.chan[n.channel];
      c.fillRect(x, h - 4 - bh, 3, bh);
      if (pass) { c.fillStyle = th.bright; c.fillRect(x - 1, h - 5 - bh, 5, 2); }
    }
  }
  c.globalAlpha = 1;
  const xp = Math.round(xOf(ed.playhead)) + 0.5;
  c.strokeStyle = th.hi(0.5);
  c.beginPath(); c.moveTo(xp, 0); c.lineTo(xp, h); c.stroke();
  c.restore();
}

// the floating pieces hang from what they act on, kept inside the view
function placeOverlays(): void {
  const sc = scroller.value;
  if (!sc) return;
  const top = RULER_H + 8;
  if (chip.value) { chip.value.style.left = `${KB_W + 10}px`; chip.value.style.top = `${top}px`; }
  const bar = rangeBar.value, r = props.ed.range;
  if (bar && r) {
    const max = sc.clientWidth - bar.offsetWidth - 8;
    bar.style.left = `${Math.max(KB_W + 8, Math.min(max, xOf(r.a) + 8))}px`;
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
  if (!area.value) return;
  const th = theme();
  drawRoll(th);
  drawVel(th);
  placeOverlays();
}
watch(() => [props.rev, props.grid, zoom.value], () => draw(), { flush: 'post' });

/* ------------------------------- interactions ------------------------------ */
type Drag =
  | { kind: 'ruler'; t0: number; x0: number; moved: boolean }
  | { kind: 'band'; t0: number; p0: number; t1: number | null; p1: number | null; base: Set<number> }
  | { kind: 'move' | 'resize'; anchor: EdNote; orig: Map<number, { tick: number; note: number; dur: number }>; x0: number; y0: number; moved: boolean; pending: number | null; lastDp: number; minDur?: number };
let drag: Drag | null = null;

function local(e: MouseEvent): { x: number; y: number } {
  const r = (scroller.value as HTMLElement).getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function hitNote(x: number, y: number): EdNote | null {
  if (x < KB_W || y < RULER_H) return null;
  const tk = tickAt(x), p = pitchAt(y), slack = 2 / pxPerTick();
  let hit: EdNote | null = null;
  for (const n of props.ed.visibleNotes()) {
    if (n.note !== p || tk < n.tick || tk > n.tick + n.dur + slack) continue;
    if (props.ed.sel.has(n.id)) return n;
    hit = n;
  }
  return hit;
}
const nearEnd = (n: EdNote, x: number): boolean => xOf(n.tick + n.dur) - x < EDGE_PX && n.dur * pxPerTick() > 12;

function adopted(created: boolean, ch: number): void {
  if (created) notify(t('midiEditor.channelCreated', { ch, program: props.ed.programOf(ch) }), 'info');
}
function createAt(x: number, y: number, free: boolean): EdNote {
  const tk = tickAt(x), g = props.grid;
  const start = Math.max(0, free || !g ? Math.round(tk) : Math.floor(tk / g) * g);
  const ch = props.pencilChannel;
  props.ed.hidden.delete(ch);
  const { note, created } = props.ed.addNote(ch, pitchAt(y), start, g && g <= tpb() ? g : tpb() / 2);
  adopted(created, ch);
  emit('preview', ch, note.note);
  return note;
}

function onPointerDown(e: PointerEvent): void {
  const sc = scroller.value;
  if (e.button !== 0 || !sc) return;
  const { x, y } = local(e);
  if (x > sc.clientWidth || y > sc.clientHeight) return; // on a scrollbar
  sc.focus({ preventScroll: true });
  const ed = props.ed;
  if (y < RULER_H) {
    if (x < KB_W) return;
    drag = { kind: 'ruler', t0: snap(tickAt(x), e.altKey), x0: x, moved: false };
  } else if (x < KB_W) {
    emit('preview', props.pencilChannel, pitchAt(y));
    return;
  } else {
    const hit = hitNote(x, y);
    if (!hit && props.tool === 'pencil') {
      const n = createAt(x, y, e.altKey);
      // the new note ends under the pointer while it is dragged, never shorter than one grid step
      drag = { kind: 'resize', anchor: n, orig: new Map([[n.id, { tick: n.tick, note: n.note, dur: tickAt(x) - n.tick }]]), x0: x, y0: y, moved: true, pending: null, lastDp: 0, minDur: n.dur };
    } else if (hit) {
      let pending: number | null = null;
      if (e.ctrlKey || e.metaKey) {
        if (ed.sel.has(hit.id)) ed.sel.delete(hit.id);
        else ed.sel.add(hit.id);
      } else if (e.shiftKey) ed.sel.add(hit.id);
      else if (!ed.sel.has(hit.id)) { ed.sel.clear(); ed.sel.add(hit.id); }
      // already in the selection: a drag moves the group, a plain click keeps only it
      else pending = hit.id;
      if (!ed.sel.has(hit.id)) { ed.changed(); return; }
      const orig = new Map(ed.selected().map((n) => [n.id, { tick: n.tick, note: n.note, dur: n.dur }]));
      drag = { kind: nearEnd(hit, x) ? 'resize' : 'move', anchor: hit, orig, x0: x, y0: y, moved: false, pending, lastDp: 0 };
      emit('preview', hit.channel, hit.note);
    } else {
      const keep = e.shiftKey || e.ctrlKey || e.metaKey;
      drag = { kind: 'band', t0: tickAt(x), p0: pitchAt(y), t1: null, p1: null, base: keep ? new Set(ed.sel) : new Set() };
      if (!keep) ed.sel.clear();
    }
  }
  sc.setPointerCapture(e.pointerId);
  ed.changed();
}

function onPointerMove(e: PointerEvent): void {
  const sc = scroller.value;
  if (!sc) return;
  const { x, y } = local(e);
  const ed = props.ed;
  if (!drag) {
    let cur = 'default';
    if (y < RULER_H) cur = x < KB_W ? 'default' : 'text';
    else if (x < KB_W) cur = 'pointer';
    else {
      const h = hitNote(x, y);
      cur = h ? (nearEnd(h, x) ? 'ew-resize' : 'grab') : props.tool === 'pencil' ? 'crosshair' : 'default';
    }
    sc.style.cursor = cur;
    const hp = y >= RULER_H && y < sc.clientHeight ? pitchAt(y) : -1;
    if (hp !== hoverPitch) { hoverPitch = hp; draw(); }
    return;
  }
  if (drag.kind === 'ruler') {
    if (Math.abs(x - drag.x0) > 4) drag.moved = true;
    if (drag.moved) {
      const tk = snap(tickAt(x), e.altKey);
      ed.range = tk === drag.t0 ? null : { a: Math.min(drag.t0, tk), b: Math.max(drag.t0, tk) };
      ed.changed();
    }
    return;
  }
  if (drag.kind === 'band') {
    drag.t1 = tickAt(x);
    drag.p1 = pitchAt(y);
    const tl = Math.min(drag.t0, drag.t1), th = Math.max(drag.t0, drag.t1);
    const pl = Math.min(drag.p0, drag.p1), ph = Math.max(drag.p0, drag.p1);
    ed.sel.clear();
    for (const id of drag.base) ed.sel.add(id);
    for (const n of ed.visibleNotes()) if (n.note >= pl && n.note <= ph && n.tick < th && n.tick + n.dur > tl) ed.sel.add(n.id);
    ed.changed();
    return;
  }
  if (!drag.moved && Math.hypot(x - drag.x0, y - drag.y0) < 3) return;
  if (!drag.moved) { ed.checkpoint(); drag.moved = true; }
  sc.style.cursor = drag.kind === 'resize' ? 'ew-resize' : 'grabbing';
  const a = drag.orig.get(drag.anchor.id);
  if (!a) return;
  const origs = [...drag.orig.values()];
  if (drag.kind === 'move') {
    let dt = snap(a.tick + (x - drag.x0) / pxPerTick(), e.altKey) - a.tick;
    dt = Math.max(dt, -Math.min(...origs.map((o) => o.tick)));
    const lo = Math.min(...origs.map((o) => o.note)), hi = Math.max(...origs.map((o) => o.note));
    const dp = Math.min(127 - hi, Math.max(-lo, Math.round(-(y - drag.y0) / KEY_H)));
    for (const n of ed.notes) {
      const o = drag.orig.get(n.id);
      if (o) { n.tick = o.tick + dt; n.note = o.note + dp; }
    }
    if (dp !== drag.lastDp) { drag.lastDp = dp; emit('preview', drag.anchor.channel, a.note + dp); }
  } else {
    const dd = snap(a.tick + a.dur + (x - drag.x0) / pxPerTick(), e.altKey) - (a.tick + a.dur);
    const minDur = drag.minDur ?? (props.grid && !e.altKey ? Math.min(props.grid, tpb() / 4) : 1);
    for (const n of ed.notes) {
      const o = drag.orig.get(n.id);
      if (o) n.dur = Math.max(minDur, Math.round(o.dur + dd));
    }
  }
  draw();
}

function onPointerUp(): void {
  const d = drag;
  if (!d) return;
  drag = null;
  const ed = props.ed;
  if (d.kind === 'ruler' && !d.moved) {
    ed.playhead = Math.max(0, Math.round(tickAt(d.x0)));
    ed.range = null;
    emit('seek');
  }
  if ((d.kind === 'move' || d.kind === 'resize') && !d.moved && d.pending != null) {
    ed.sel.clear();
    ed.sel.add(d.pending);
  }
  ed.changed();
}
function onLeave(): void {
  if (!drag && hoverPitch !== -1) { hoverPitch = -1; draw(); }
}
function onDblClick(e: MouseEvent): void {
  const { x, y } = local(e);
  if (props.tool !== 'select' || x < KB_W || y < RULER_H || hitNote(x, y)) return;
  createAt(x, y, e.altKey);
}
function onContextMenu(e: MouseEvent): void {
  e.preventDefault();
  const { x, y } = local(e);
  const hit = hitNote(x, y);
  if (hit) props.ed.deleteNote(hit);
}
function onWheel(e: WheelEvent): void {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, local(e).x);
}
function zoomBy(f: number, anchorX?: number): void {
  const sc = scroller.value;
  if (!sc) return;
  const ax = anchorX ?? (KB_W + sc.clientWidth) / 2;
  const tk = tickAt(ax);
  zoom.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom.value * f));
  // the spacer grows on the next render: scroll once it has
  nextTick(() => {
    sc.scrollLeft = KB_W + tk * pxPerTick() - ax;
    draw();
  });
}

// velocity lane: paints the bars under the pointer (only the selected ones when there is a selection)
let velDrag: { saved: boolean } | null = null;
function paintVel(e: PointerEvent): void {
  const cv = velCv.value;
  if (!cv || !velDrag) return;
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, h = r.height;
  const v = Math.min(127, Math.max(1, Math.round((1 - (y - 4) / (h - 8)) * 127)));
  const ed = props.ed;
  const pool = ed.sel.size ? ed.selected() : ed.visibleNotes();
  for (const n of pool) {
    if (Math.abs(xOf(n.tick) + 1.5 - x) > 4 || n.velocity === v) continue;
    if (!velDrag.saved) { ed.checkpoint(); velDrag.saved = true; }
    n.velocity = v;
  }
  draw();
}
function onVelDown(e: PointerEvent): void {
  const cv = velCv.value, sc = scroller.value;
  if (!cv || !sc) return;
  const x = e.clientX - cv.getBoundingClientRect().left;
  if (x < KB_W || x > sc.clientWidth) return;
  velDrag = { saved: false };
  cv.setPointerCapture(e.pointerId);
  paintVel(e);
}
function onVelMove(e: PointerEvent): void { if (velDrag) paintVel(e); }
function onVelUp(): void {
  if (velDrag?.saved) props.ed.changed();
  velDrag = null;
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
/** Keeps the playhead in view while playing. */
function follow(): void {
  const sc = scroller.value;
  if (!sc) return;
  const x = xOf(props.ed.playhead);
  if (x > sc.clientWidth - 40 || x < KB_W) sc.scrollLeft += x - KB_W - 40;
  drawNow();
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
  resize = new ResizeObserver(() => draw());
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
      <div ref="scroller" class="roll__scroller" tabindex="0" @pointerdown="onPointerDown" @pointermove="onPointerMove"
        @pointerup="onPointerUp" @pointercancel="onPointerUp" @pointerleave="onLeave" @dblclick="onDblClick"
        @contextmenu="onContextMenu" @scroll="draw" @wheel="onWheel">
        <div class="roll__spacer" :style="spacer"></div>
      </div>
      <button v-if="silence > 0" ref="chip" class="roll-chip" type="button" @click="trim">
        <i class="fas fa-backward-step"></i>{{ $t('midiEditor.silence', { s: silenceLabel }) }}<b>{{ $t('midiEditor.trim') }}</b>
      </button>
      <div v-if="range" ref="rangeBar" class="roll-range">
        <i class="fas fa-left-right"></i><b>{{ barLabel(range.a) }} → {{ barLabel(range.b) }}</b>
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
      <canvas ref="velCv" @pointerdown="onVelDown" @pointermove="onVelMove" @pointerup="onVelUp"
        @pointercancel="onVelUp" @wheel="onVelWheel"></canvas>
    </div>
  </div>
</template>
