import type { EdNote } from '@/model/midi/edit/doc';
import type { MidEditor } from '@/model/midi/edit/editor';
import { RollGeometry } from './geometry';
import type { RollBand } from './painter';

const { KEY_H, KB_W, RULER_H } = RollGeometry;
// a note's right edge grabs its length within this, when the note is wide enough to keep a middle
const EDGE_PX = 7;
// the look's own arrow, hand and beam where it draws them (ui/styles/themes/_cursors.scss)
const LOOK_CURSORS: Record<string, string> = {
  default: 'var(--cursor-default, default)',
  pointer: 'var(--cursor-pointer, pointer)',
  text: 'var(--cursor-text, text)',
};

/** What the gestures act on and through: the roll's component. */
export interface RollHost {
  ed(): MidEditor;
  tool(): 'select' | 'pencil';
  pencilChannel(): number;
  scroller(): HTMLElement | null;
  velCanvas(): HTMLCanvasElement | null;
  /** Draw again on the next frame. */
  draw(): void;
  /** Sound a note (the keys, a note picked or moved). */
  preview(channel: number, note: number): void;
  /** The playhead moved (a click on the ruler). */
  seek(): void;
  /** The pencil wrote on a channel the file did not list: it is created. */
  created(channel: number): void;
}

type Drag =
  | { kind: 'ruler'; t0: number; x0: number; moved: boolean }
  | { kind: 'band'; t0: number; p0: number; t1: number | null; p1: number | null; base: Set<number> }
  | { kind: 'move' | 'resize'; anchor: EdNote; orig: Map<number, { tick: number; note: number; dur: number }>; x0: number; y0: number; moved: boolean; pending: number | null; lastDp: number; minDur?: number };

/**
 * The piano roll's pointer: on the ruler a click places the playhead and a drag
 * marks a passage; on the notes a click picks, a drag moves or stretches them,
 * the pencil writes; elsewhere a band selects. The velocity lane paints the
 * bars under the pointer (only the selected ones when there is a selection).
 * Its handlers are bound: the template passes them as they are.
 */
export class RollGestures {
  /** The key row under the pointer (-1: none), lit by the painter. */
  hoverPitch = -1;
  private drag: Drag | null = null;
  // a touch long-press fires contextmenu too: only a secondary button (mouse, pen barrel) deletes
  private secondaryPress = false;
  private velDrag: { saved: boolean } | null = null;

  constructor(private readonly g: RollGeometry, private readonly h: RollHost) {}

  /** The band being drawn to select, for the painter. */
  get band(): RollBand | null {
    const d = this.drag;
    return d?.kind === 'band' && d.t1 != null && d.p1 != null ? { t0: d.t0, p0: d.p0, t1: d.t1, p1: d.p1 } : null;
  }

  private get ed(): MidEditor {
    return this.h.ed();
  }

  /** A pointer's place in the scroller's box. */
  local(e: MouseEvent): { x: number; y: number } {
    const r = (this.h.scroller() as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  readonly pointerDown = (e: PointerEvent): void => {
    const sc = this.h.scroller();
    this.secondaryPress = e.button === 2;
    if (e.button !== 0 || !sc) return;
    const { x, y } = this.local(e);
    if (x > sc.clientWidth || y > sc.clientHeight) return; // on a scrollbar
    sc.focus({ preventScroll: true });
    const ed = this.ed, g = this.g;
    if (y < RULER_H) {
      if (x < KB_W) return;
      this.drag = { kind: 'ruler', t0: g.snap(g.tickAt(x), e.altKey), x0: x, moved: false };
    } else if (x < KB_W) {
      this.h.preview(this.h.pencilChannel(), g.pitchAt(y));
      return;
    } else {
      const hit = this.hitNote(x, y);
      if (!hit && this.h.tool() === 'pencil') {
        const n = this.createAt(x, y, e.altKey);
        // the new note ends under the pointer while it is dragged, never shorter than one grid step
        this.drag = { kind: 'resize', anchor: n, orig: new Map([[n.id, { tick: n.tick, note: n.note, dur: g.tickAt(x) - n.tick }]]), x0: x, y0: y, moved: true, pending: null, lastDp: 0, minDur: n.dur };
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
        this.drag = { kind: this.nearEnd(hit, x) ? 'resize' : 'move', anchor: hit, orig, x0: x, y0: y, moved: false, pending, lastDp: 0 };
        this.h.preview(hit.channel, hit.note);
      } else {
        const keep = e.shiftKey || e.ctrlKey || e.metaKey;
        this.drag = { kind: 'band', t0: g.tickAt(x), p0: g.pitchAt(y), t1: null, p1: null, base: keep ? new Set(ed.sel) : new Set() };
        if (!keep) ed.sel.clear();
      }
    }
    sc.setPointerCapture(e.pointerId);
    ed.changed();
  };

  readonly pointerMove = (e: PointerEvent): void => {
    const sc = this.h.scroller();
    if (!sc) return;
    const { x, y } = this.local(e);
    const ed = this.ed, g = this.g, drag = this.drag;
    if (!drag) {
      let cur = 'default';
      if (y < RULER_H) cur = x < KB_W ? 'default' : 'text';
      else if (x < KB_W) cur = 'pointer';
      else {
        const h = this.hitNote(x, y);
        cur = h ? (this.nearEnd(h, x) ? 'ew-resize' : 'grab') : this.h.tool() === 'pencil' ? 'crosshair' : 'default';
      }
      sc.style.cursor = LOOK_CURSORS[cur] ?? cur;
      const hp = y >= RULER_H && y < sc.clientHeight ? g.pitchAt(y) : -1;
      if (hp !== this.hoverPitch) { this.hoverPitch = hp; this.h.draw(); }
      return;
    }
    if (drag.kind === 'ruler') {
      if (Math.abs(x - drag.x0) > 4) drag.moved = true;
      if (drag.moved) {
        const tk = g.snap(g.tickAt(x), e.altKey);
        ed.range = tk === drag.t0 ? null : { a: Math.min(drag.t0, tk), b: Math.max(drag.t0, tk) };
        ed.changed();
      }
      return;
    }
    if (drag.kind === 'band') {
      drag.t1 = g.tickAt(x);
      drag.p1 = g.pitchAt(y);
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
      let dt = g.snap(a.tick + (x - drag.x0) / g.pxPerTick, e.altKey) - a.tick;
      dt = Math.max(dt, -Math.min(...origs.map((o) => o.tick)));
      const lo = Math.min(...origs.map((o) => o.note)), hi = Math.max(...origs.map((o) => o.note));
      const dp = Math.min(127 - hi, Math.max(-lo, Math.round(-(y - drag.y0) / KEY_H)));
      for (const n of ed.notes) {
        const o = drag.orig.get(n.id);
        if (o) { n.tick = o.tick + dt; n.note = o.note + dp; }
      }
      if (dp !== drag.lastDp) { drag.lastDp = dp; this.h.preview(drag.anchor.channel, a.note + dp); }
    } else {
      const dd = g.snap(a.tick + a.dur + (x - drag.x0) / g.pxPerTick, e.altKey) - (a.tick + a.dur);
      const minDur = drag.minDur ?? (g.grid && !e.altKey ? Math.min(g.grid, g.beat / 4) : 1);
      for (const n of ed.notes) {
        const o = drag.orig.get(n.id);
        if (o) n.dur = Math.max(minDur, Math.round(o.dur + dd));
      }
    }
    this.h.draw();
  };

  readonly pointerUp = (): void => {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const ed = this.ed;
    if (d.kind === 'ruler' && !d.moved) {
      ed.playhead = Math.max(0, Math.round(this.g.tickAt(d.x0)));
      ed.range = null;
      this.h.seek();
    }
    if ((d.kind === 'move' || d.kind === 'resize') && !d.moved && d.pending != null) {
      ed.sel.clear();
      ed.sel.add(d.pending);
    }
    ed.changed();
  };

  readonly leave = (): void => {
    if (!this.drag && this.hoverPitch !== -1) { this.hoverPitch = -1; this.h.draw(); }
  };

  readonly dblClick = (e: MouseEvent): void => {
    const { x, y } = this.local(e);
    if (this.h.tool() !== 'select' || x < KB_W || y < RULER_H || this.hitNote(x, y)) return;
    this.createAt(x, y, e.altKey);
  };

  readonly contextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    if (!this.secondaryPress) return;
    this.secondaryPress = false;
    const { x, y } = this.local(e);
    const hit = this.hitNote(x, y);
    if (hit) this.ed.deleteNote(hit);
  };

  readonly velDown = (e: PointerEvent): void => {
    const cv = this.h.velCanvas(), sc = this.h.scroller();
    if (!cv || !sc) return;
    const x = e.clientX - cv.getBoundingClientRect().left;
    if (x < KB_W || x > sc.clientWidth) return;
    this.velDrag = { saved: false };
    cv.setPointerCapture(e.pointerId);
    this.paintVel(e);
  };

  readonly velMove = (e: PointerEvent): void => {
    if (this.velDrag) this.paintVel(e);
  };

  readonly velUp = (): void => {
    if (this.velDrag?.saved) this.ed.changed();
    this.velDrag = null;
  };

  private hitNote(x: number, y: number): EdNote | null {
    if (x < KB_W || y < RULER_H) return null;
    const g = this.g, ed = this.ed;
    const tk = g.tickAt(x), p = g.pitchAt(y), slack = 2 / g.pxPerTick;
    let hit: EdNote | null = null;
    for (const n of ed.visibleNotes()) {
      if (n.note !== p || tk < n.tick || tk > n.tick + n.dur + slack) continue;
      if (ed.sel.has(n.id)) return n;
      hit = n;
    }
    return hit;
  }

  private nearEnd(n: EdNote, x: number): boolean {
    return this.g.xOf(n.tick + n.dur) - x < EDGE_PX && n.dur * this.g.pxPerTick > 12;
  }

  private createAt(x: number, y: number, free: boolean): EdNote {
    const g = this.g;
    const tk = g.tickAt(x), grid = g.grid;
    const start = Math.max(0, free || !grid ? Math.round(tk) : Math.floor(tk / grid) * grid);
    const ch = this.h.pencilChannel();
    this.ed.hidden.delete(ch);
    const { note, created } = this.ed.addNote(ch, g.pitchAt(y), start, grid && grid <= g.beat ? grid : g.beat / 2);
    if (created) this.h.created(ch);
    this.h.preview(ch, note.note);
    return note;
  }

  private paintVel(e: PointerEvent): void {
    const cv = this.h.velCanvas();
    if (!cv || !this.velDrag) return;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, h = r.height;
    const v = Math.min(127, Math.max(1, Math.round((1 - (y - 4) / (h - 8)) * 127)));
    const ed = this.ed;
    const pool = ed.sel.size ? ed.selected() : ed.visibleNotes();
    for (const n of pool) {
      if (Math.abs(this.g.xOf(n.tick) + 1.5 - x) > 4 || n.velocity === v) continue;
      if (!this.velDrag.saved) { ed.checkpoint(); this.velDrag.saved = true; }
      n.velocity = v;
    }
    this.h.draw();
  }
}
