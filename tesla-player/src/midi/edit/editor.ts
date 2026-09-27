import type { TempoMap } from '@/midi/tempo';
import {
  cutRange,
  docTempo,
  eventChannel,
  hostTrack,
  keepRange,
  leadingSilence,
  newNoteId,
  writeDoc,
  type EdEvent,
  type EdNote,
  type MidiDoc,
  type Timeline,
} from './doc';

export const CHANNEL_COUNT = 16;
const UNDO_DEPTH = 100;

interface Snapshot {
  notes: EdNote[];
  events: EdEvent[];
  programs: Record<number, number>;
  trackCount: number;
  created: number[];
  rev: number;
}

export interface TickRange {
  a: number;
  b: number;
}

/**
 * Everything the MIDI editor does to a file, apart from drawing it. The notes are
 * edited in place (a drag moves thousands of them at 60 fps), so every change
 * goes through {@link checkpoint} first, and {@link changed} tells the page to
 * redraw. Kept out of Vue's reactivity for the same reason: the page follows
 * one counter bumped by onChange.
 */
export class MidiEditor {
  readonly sel = new Set<number>();
  /** display only: not part of the file */
  readonly hidden = new Set<number>();
  readonly muted = new Set<number>();
  range: TickRange | null = null;
  /** where playback and paste start, ticks */
  playhead = 0;
  clipboard: EdNote[] | null = null;
  map: TempoMap;
  onChange: (() => void) | null = null;

  // channels listed although they have no note yet: a destination or pencil channel picked here
  private created = new Set<number>();
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private rev = 0;
  private nextRev = 1;
  private savedRev = 0;
  private saved: { counts: Record<number, number>; programs: Record<number, number> };

  constructor(readonly doc: MidiDoc) {
    this.map = docTempo(doc);
    this.saved = { counts: this.counts(), programs: this.startPrograms() };
  }

  get dirty(): boolean { return this.rev !== this.savedRev; }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get notes(): EdNote[] { return this.doc.notes; }

  changed(): void { this.onChange?.(); }

  /* ------------------------------- history ------------------------------- */
  private snap(): Snapshot {
    const d = this.doc;
    // events are never changed in place, only replaced: sharing the array is safe
    return { notes: d.notes.map((n) => ({ ...n })), events: d.events, programs: { ...d.programs }, trackCount: d.trackCount, created: [...this.created], rev: this.rev };
  }
  private restore(s: Snapshot): void {
    const eventsChanged = s.events !== this.doc.events;
    Object.assign(this.doc, { notes: s.notes, events: s.events, programs: s.programs, trackCount: s.trackCount });
    this.created = new Set(s.created);
    this.rev = s.rev;
    if (eventsChanged) this.map = docTempo(this.doc);
    const ids = new Set(s.notes.map((n) => n.id));
    for (const id of [...this.sel]) if (!ids.has(id)) this.sel.delete(id);
    this.changed();
  }
  /** Call before changing the file: what is kept here is what undo brings back. */
  checkpoint(): void {
    this.undoStack.push(this.snap());
    if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
    this.redoStack = [];
    this.rev = this.nextRev++;
  }
  undo(): void {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snap());
    this.restore(s);
  }
  redo(): void {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snap());
    this.restore(s);
  }

  /* ------------------------------- channels ------------------------------ */
  counts(): Record<number, number> {
    const c: Record<number, number> = {};
    for (const n of this.doc.notes) c[n.channel] = (c[n.channel] ?? 0) + 1;
    return c;
  }
  /** Channels with notes, and the ones picked here as a destination. */
  channels(): number[] {
    const set = new Set(this.doc.notes.map((n) => n.channel));
    for (const ch of this.created) set.add(ch);
    return [...set].sort((a, b) => a - b);
  }
  isListed(ch: number): boolean {
    return this.created.has(ch) || this.doc.notes.some((n) => n.channel === ch);
  }
  /** A channel without a program change plays program 0. */
  programOf(ch: number): number {
    return this.doc.programs[ch] ?? 0;
  }
  private startPrograms(): Record<number, number> {
    return Object.fromEntries(this.channels().map((ch) => [ch, this.programOf(ch)]));
  }
  setProgram(ch: number, program: number): void {
    if (this.programOf(ch) === program && ch in this.doc.programs) return;
    this.checkpoint();
    this.doc.programs = { ...this.doc.programs, [ch]: program };
    this.changed();
  }
  /** A channel shown for the first time starts on what the file gives it: its own program change, or 0. */
  private adopt(ch: number): boolean {
    if (this.isListed(ch)) return false;
    this.created.add(ch);
    if (!(ch in this.doc.programs)) this.doc.programs = { ...this.doc.programs, [ch]: 0 };
    return true;
  }
  /** Removes the channel's notes and its other channel events (controllers, program changes…). */
  deleteChannel(ch: number): number {
    const n = this.doc.notes.filter((x) => x.channel === ch).length;
    this.checkpoint();
    this.doc.notes = this.doc.notes.filter((x) => x.channel !== ch);
    this.doc.events = this.doc.events.filter((e) => eventChannel(e.ev) !== ch);
    const programs = { ...this.doc.programs };
    delete programs[ch];
    this.doc.programs = programs;
    this.created.delete(ch);
    this.pruneSelection();
    this.changed();
    return n;
  }

  /* ------------------------------- selection ----------------------------- */
  visibleNotes(): EdNote[] {
    return this.hidden.size ? this.doc.notes.filter((n) => !this.hidden.has(n.channel)) : this.doc.notes;
  }
  selected(): EdNote[] {
    return this.sel.size ? this.doc.notes.filter((n) => this.sel.has(n.id)) : [];
  }
  select(notes: EdNote[], add = false): void {
    if (!add) this.sel.clear();
    for (const n of notes) this.sel.add(n.id);
    this.changed();
  }
  clearSelection(): void {
    if (!this.sel.size) return;
    this.sel.clear();
    this.changed();
  }
  selectAll(): void { this.select(this.visibleNotes()); }
  invertSelection(): void { this.select(this.visibleNotes().filter((n) => !this.sel.has(n.id))); }
  private pruneSelection(): void {
    if (!this.sel.size) return;
    const ids = new Set(this.doc.notes.map((n) => n.id));
    for (const id of [...this.sel]) if (!ids.has(id)) this.sel.delete(id);
  }
  /** The notes a criterion looks at: visible, on `channel` (or all), and in the passage when there is one. */
  scope(channel: number | null): EdNote[] {
    const r = this.range;
    return this.visibleNotes().filter((n) => (channel == null || n.channel === channel) && (!r || (n.tick >= r.a && n.tick < r.b)));
  }

  /* ---------------------------- editing notes ---------------------------- */
  /** @returns whether the channel was a free one */
  moveTo(ch: number): boolean {
    const s = this.selected();
    if (!s.length) return false;
    this.checkpoint();
    const created = this.adopt(ch);
    for (const n of s) n.channel = ch;
    this.changed();
    return created;
  }
  transpose(semitones: number): void {
    const s = this.selected();
    if (!s.length) return;
    this.checkpoint();
    for (const n of s) n.note = Math.min(127, Math.max(0, n.note + semitones));
    this.changed();
  }
  shiftBy(ticks: number): void {
    const s = this.selected();
    if (!s.length) return;
    const dt = Math.max(ticks, -Math.min(...s.map((n) => n.tick)));
    if (!dt) return;
    this.checkpoint();
    for (const n of s) n.tick += dt;
    this.changed();
  }
  setVelocity(v: number): void {
    const s = this.selected();
    if (!s.length) return;
    this.checkpoint();
    const vel = clampVelocity(v);
    for (const n of s) n.velocity = vel;
    this.changed();
  }
  scaleVelocity(factor: number): void {
    const s = this.selected();
    if (!s.length) return;
    this.checkpoint();
    for (const n of s) n.velocity = clampVelocity(n.velocity * factor);
    this.changed();
  }
  deleteSelected(): number {
    const n = this.sel.size;
    if (!n) return 0;
    this.checkpoint();
    this.doc.notes = this.doc.notes.filter((x) => !this.sel.has(x.id));
    this.sel.clear();
    this.changed();
    return n;
  }
  deleteNote(note: EdNote): void {
    this.checkpoint();
    this.doc.notes = this.doc.notes.filter((x) => x !== note);
    this.sel.delete(note.id);
    this.changed();
  }
  /** @returns the note, and whether its channel was a free one */
  addNote(ch: number, note: number, tick: number, dur: number, velocity = 100): { note: EdNote; created: boolean } {
    this.checkpoint();
    const created = this.adopt(ch);
    let track = hostTrack(this.doc, ch);
    // a channel new to the file gets a track of its own (a format 0 file has only one)
    if (track < 0) track = this.doc.format === 0 ? 0 : this.doc.trackCount++;
    const n: EdNote = { id: newNoteId(), channel: ch, note, tick: Math.max(0, Math.round(tick)), dur: Math.max(1, Math.round(dur)), velocity: clampVelocity(velocity), track };
    this.doc.notes.push(n);
    this.sel.clear();
    this.sel.add(n.id);
    this.changed();
    return { note: n, created };
  }
  copy(): number {
    const s = this.selected();
    if (s.length) this.clipboard = s.map((n) => ({ ...n }));
    this.changed();
    return s.length;
  }
  /** Puts `notes` (the clipboard by default) so that the first one starts at `at`, and selects them. */
  paste(at: number, notes: EdNote[] | null = this.clipboard): void {
    if (!notes?.length) return;
    this.checkpoint();
    const t0 = Math.min(...notes.map((n) => n.tick));
    const added = notes.map((n) => ({ ...n, id: newNoteId(), tick: n.tick - t0 + Math.max(0, at) }));
    for (const n of added) this.adopt(n.channel);
    this.doc.notes.push(...added);
    this.select(added);
  }
  /** A copy right after the selection, its length rounded up to `step` ticks so it lands on the grid. */
  duplicate(step: number): void {
    const s = this.selected();
    if (!s.length) return;
    const t0 = Math.min(...s.map((n) => n.tick));
    const t1 = Math.max(...s.map((n) => n.tick + n.dur));
    const len = step > 0 ? Math.ceil((t1 - t0) / step) * step : t1 - t0;
    this.paste(t0 + len, s);
  }

  /* ------------------------------- time ---------------------------------- */
  setRange(range: TickRange | null): void {
    this.range = range;
    this.changed();
  }
  private applyTimeline(tl: Timeline): void {
    this.doc.notes = tl.notes;
    this.doc.events = tl.events;
    this.map = docTempo(this.doc);
    this.pruneSelection();
  }
  leadingSilence(): number { return leadingSilence(this.doc); }
  trimLeading(): number {
    const cut = leadingSilence(this.doc);
    if (cut <= 0) return 0;
    this.checkpoint();
    this.applyTimeline(cutRange(this.doc, 0, cut));
    this.playhead = Math.max(0, this.playhead - cut);
    this.range = null;
    this.changed();
    return cut;
  }
  /** @returns how many notes went */
  cutPassage(): number {
    const r = this.range;
    if (!r) return 0;
    const before = this.doc.notes.length;
    this.checkpoint();
    this.applyTimeline(cutRange(this.doc, r.a, r.b));
    this.sel.clear();
    this.range = null;
    if (this.playhead > r.a) this.playhead = r.a;
    this.changed();
    return before - this.doc.notes.length;
  }
  keepPassage(): void {
    const r = this.range;
    if (!r) return;
    this.checkpoint();
    this.applyTimeline(keepRange(this.doc, r.a, r.b));
    this.sel.clear();
    this.range = null;
    this.playhead = 0;
    this.changed();
  }
  endTick(): number {
    return this.doc.notes.reduce((m, n) => Math.max(m, n.tick + n.dur), 0);
  }

  /* ------------------------------- saving -------------------------------- */
  bytes(): Uint8Array<ArrayBuffer> { return writeDoc(this.doc); }
  /** What changed since the file was opened or last saved, for the save dialog. */
  changesSinceSave(): { before: Record<number, number>; after: Record<number, number>; programsBefore: Record<number, number>; programsAfter: Record<number, number> } {
    return { before: this.saved.counts, after: this.counts(), programsBefore: this.saved.programs, programsAfter: this.startPrograms() };
  }
  markSaved(): void {
    this.savedRev = this.rev;
    this.created.clear();
    this.saved = { counts: this.counts(), programs: this.startPrograms() };
    this.changed();
  }
}

export function clampVelocity(v: number): number {
  return Math.min(127, Math.max(1, Math.round(v)));
}
