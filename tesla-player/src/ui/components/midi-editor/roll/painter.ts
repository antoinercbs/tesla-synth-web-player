import { MidNote } from '@/model/midi/note';
import type { EdNote } from '@/model/midi/edit/doc';
import type { MidEditor } from '@/model/midi/edit/editor';
import { channelColors } from '@/ui/helpers/channel-colors';
import { RollGeometry } from './geometry';

const { KEY_H, KB_W, RULER_H } = RollGeometry;

type Tint = (a: number) => string;
export interface RollTheme { bg: string; side: string; text: string; mute: string; bright: string; mono: string; line: Tint; volt: Tint; hi: Tint; lo: Tint; chan: string[] }
export interface Size { w: number; h: number }
/** The band being drawn to select: from a tick and pitch to another. */
export interface RollBand { t0: number; p0: number; t1: number; p1: number }

/** The piano roll's canvases, drawn from the editor's state through the geometry. */
export class RollPainter {
  constructor(private readonly g: RollGeometry) {}

  // the tokens, read once per frame: a canvas can't take a var()
  static theme(el: Element): RollTheme {
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

  private static fit(cv: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D {
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

  /**
   * The roll: the keys' rows, the grid, the passage, the notes (the selected ones on top), the band
   * being drawn, the playhead, the keyboard and the bar ruler. `area`: the canvas's box; `view`:
   * the scroller's, what is seen of it. `head`: false while it plays, the playhead drawn over it.
   */
  roll(cv: HTMLCanvasElement, area: Size, view: Size, ed: MidEditor, hoverPitch: number, band: RollBand | null, th: RollTheme, head = true): void {
    const g = this.g;
    const c = RollPainter.fit(cv, area.w, area.h);
    const W = view.w, H = view.h;
    c.clearRect(0, 0, area.w, area.h);
    c.fillStyle = th.bg;
    c.fillRect(0, 0, W, H);

    const pHi = g.pitchAt(RULER_H), pLo = g.pitchAt(H);
    for (let p = pLo; p <= pHi; p++) {
      const y = g.yOf(p);
      if (MidNote.isBlack(p)) { c.fillStyle = th.lo(0.22); c.fillRect(KB_W, y, W - KB_W, KEY_H); }
      if (p === hoverPitch) { c.fillStyle = th.volt(0.06); c.fillRect(KB_W, y, W - KB_W, KEY_H); }
      if (p % 12 === 0) { c.fillStyle = th.line(0.16); c.fillRect(KB_W, y + KEY_H - 1, W - KB_W, 1); }
    }

    const beat = g.beat, bar = g.bar;
    const t0 = Math.max(0, Math.floor(g.tickAt(KB_W) / beat) * beat), t1 = g.tickAt(W);
    const sub = g.grid > 0 && g.grid < beat && g.grid * g.pxPerTick >= 9 ? g.grid : beat;
    for (let tk = t0; tk <= t1; tk += sub) {
      const x = Math.round(g.xOf(tk)) + 0.5;
      if (x < KB_W) continue;
      const isBar = tk % bar === 0, isBeat = tk % beat === 0;
      if (!isBar && g.zoom < 20) continue;
      c.strokeStyle = isBar ? th.line(0.3) : isBeat ? th.line(0.12) : th.line(0.05);
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, RULER_H); c.lineTo(x, H); c.stroke();
    }

    c.save();
    c.beginPath(); c.rect(KB_W, RULER_H, W - KB_W, H - RULER_H); c.clip();
    const r = ed.range;
    if (r) {
      const xa = g.xOf(r.a), xb = g.xOf(r.b);
      c.fillStyle = th.volt(0.07);
      c.fillRect(xa, RULER_H, xb - xa, H - RULER_H);
      c.strokeStyle = th.volt(0.45);
      c.setLineDash([4, 4]);
      for (const x of [xa, xb]) { c.beginPath(); c.moveTo(Math.round(x) + 0.5, RULER_H); c.lineTo(Math.round(x) + 0.5, H); c.stroke(); }
      c.setLineDash([]);
    }
    const drawNote = (n: EdNote, isSel: boolean): void => {
      const x = g.xOf(n.tick), w = Math.max(3, n.dur * g.pxPerTick);
      if (x + w < KB_W || x > W) return;
      const y = g.yOf(n.note);
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
    if (band) {
      const xa = g.xOf(Math.min(band.t0, band.t1)), xb = g.xOf(Math.max(band.t0, band.t1));
      const ya = g.yOf(Math.max(band.p0, band.p1)), yb = g.yOf(Math.min(band.p0, band.p1)) + KEY_H;
      c.fillStyle = th.volt(0.12);
      c.fillRect(xa, ya, xb - xa, yb - ya);
      c.strokeStyle = th.volt(0.8);
      c.lineWidth = 1;
      c.strokeRect(xa + 0.5, ya + 0.5, xb - xa, yb - ya);
    }
    const xp = Math.round(g.xOf(ed.playhead)) + 0.5;
    if (head) {
      c.strokeStyle = th.hi(0.75);
      c.beginPath(); c.moveTo(xp, RULER_H); c.lineTo(xp, H); c.stroke();
    }
    c.restore();

    // keyboard
    c.fillStyle = th.side;
    c.fillRect(0, RULER_H, KB_W, H - RULER_H);
    c.font = `9px ${th.mono}`;
    c.textAlign = 'right';
    c.textBaseline = 'middle';
    for (let p = pLo; p <= pHi; p++) {
      const y = g.yOf(p);
      c.fillStyle = p === hoverPitch ? th.volt(0.35) : MidNote.isBlack(p) ? th.bg : th.line(0.16);
      c.fillRect(0, y, MidNote.isBlack(p) ? KB_W * 0.62 : KB_W - 1, KEY_H - 1);
      if (p % 12 === 0) { c.fillStyle = th.text; c.fillText(MidNote.name(p), KB_W - 5, y + KEY_H / 2); }
    }
    c.fillStyle = th.line(0.12);
    c.fillRect(KB_W - 1, RULER_H, 1, H - RULER_H);

    // ruler
    c.fillStyle = th.side;
    c.fillRect(0, 0, W, RULER_H);
    c.save();
    c.beginPath(); c.rect(KB_W, 0, W - KB_W, RULER_H); c.clip();
    if (r) { c.fillStyle = th.volt(0.28); c.fillRect(g.xOf(r.a), 3, g.xOf(r.b) - g.xOf(r.a), RULER_H - 6); }
    const barPx = bar * g.pxPerTick;
    const every = barPx < 34 ? 4 : barPx < 60 ? 2 : 1;
    c.font = `10px ${th.mono}`;
    c.textAlign = 'left';
    for (let b = Math.floor(t0 / bar); b * bar <= t1; b++) {
      const x = Math.round(g.xOf(b * bar)) + 0.5;
      c.strokeStyle = th.line(0.35);
      c.beginPath(); c.moveTo(x, RULER_H - 8); c.lineTo(x, RULER_H); c.stroke();
      if (b % every === 0) { c.fillStyle = th.text; c.fillText(String(b + 1), x + 4, RULER_H / 2); }
    }
    if (head) {
      c.fillStyle = th.bright;
      c.beginPath(); c.moveTo(xp - 5, RULER_H - 7); c.lineTo(xp + 5, RULER_H - 7); c.lineTo(xp, RULER_H); c.fill();
    }
    c.restore();
    c.fillStyle = th.line(0.16);
    c.fillRect(0, RULER_H - 1, W, 1);
    c.fillStyle = th.side;
    c.fillRect(0, 0, KB_W, RULER_H - 1);
  }

  /** The velocity lane: a bar per note (the selected ones bright), its label in the keyboard's column. */
  vel(cv: HTMLCanvasElement, area: Size, viewW: number, ed: MidEditor, label: string, th: RollTheme, head = true): void {
    const g = this.g;
    const h = area.h, W = viewW;
    const c = RollPainter.fit(cv, area.w, h);
    c.clearRect(0, 0, area.w, h);
    c.fillStyle = th.bg;
    c.fillRect(0, 0, W, h);
    c.fillStyle = th.side;
    c.fillRect(0, 0, KB_W, h);
    c.fillStyle = th.mute;
    c.font = `9px ${th.mono}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(label, KB_W / 2, h / 2);
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
        const x = g.xOf(n.tick);
        if (x < KB_W - 4 || x > W) continue;
        const bh = ((h - 8) * n.velocity) / 127;
        c.globalAlpha = pass ? 1 : any ? 0.25 : 0.6;
        c.fillStyle = th.chan[n.channel];
        c.fillRect(x, h - 4 - bh, 3, bh);
        if (pass) { c.fillStyle = th.bright; c.fillRect(x - 1, h - 5 - bh, 5, 2); }
      }
    }
    c.globalAlpha = 1;
    if (head) {
      const xp = Math.round(g.xOf(ed.playhead)) + 0.5;
      c.strokeStyle = th.hi(0.5);
      c.beginPath(); c.moveTo(xp, 0); c.lineTo(xp, h); c.stroke();
    }
    c.restore();
  }
}
