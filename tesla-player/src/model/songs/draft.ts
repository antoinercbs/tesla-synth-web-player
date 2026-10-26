import { MAX_COILS, SONG_WIDE, type AppTag, type CoilConfig, type CoilEvent, type MidiFile, type Song, type SongStereo } from '@/model/domain';

/** A way to play the song: its own coils (OWN_WAY), or a variant on others. */
export interface Way { id: string; name: string; coilCount: number; coils: CoilConfig[]; events: CoilEvent[]; stereo: SongStereo | null }
export const OWN_WAY = 'own';

/** What undo / redo takes back: the draft as the user shapes it. */
export interface DraftState {
  name: string;
  coilCount: number;
  output2Mask: number;
  coils: CoilConfig[];
  events: CoilEvent[];
  tags: AppTag[];
  stereo: SongStereo | null;
  programs: Record<number, number>;
  ways: Way[];
  active: number;
}

/** What `toggleCoil` did to the places. */
export type PlaceChange = { added: number } | { removed: number } | null;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * A song as the atelier edits it, before it is saved: its settings, its tags,
 * the envelopes changed here and every way to play it. The way being edited
 * (`active`) lives in the fields; its entry in `ways` is stale until another
 * one is opened (allWays). The song's file is not in it: it changes on the
 * server at once (replaceSongMidi), except its channels' envelopes, written
 * into it on save. Wrapped in reactive() by the editor.
 */
export class SongDraft {
  // A song is always driven in the firmware's MIDI mode (the "fixed" / Simple mode
  // is a separate live feature, not a stored song).
  static readonly MODE = 'midi' as const;

  id: number | null = null;
  name = '';
  coilCount = 3;
  output2Mask = 0;
  coils: CoilConfig[] = [SongDraft.newCoil(0), SongDraft.newCoil(1), SongDraft.newCoil(2)];
  events: CoilEvent[] = [];
  tags: AppTag[] = [];
  stereo: SongStereo | null = null;
  /** Envelopes changed here, by channel: the file's own until saved. */
  programs: Record<number, number> = {};
  /** Every way of the song (its own coils first, then its variants). */
  ways: Way[] = [];
  active = 0;

  /** A coil a new song starts with: no channel yet (the server's own, see SongsService). */
  static newCoil(coilIndex: number): CoilConfig {
    return { coilIndex, channelMask: 0, ontimeUs: 40, duty: 0.05 };
  }

  /** A song whose coils play nothing yet: just made from its file. */
  static fresh(song: Song): boolean {
    return (song.coils ?? []).every((c) => !c.channelMask) && !song.output2Mask;
  }

  /** The fields from a saved song, its variants as its other ways. */
  fill(song: Song): void {
    this.name = song.name ?? '';
    this.output2Mask = song.output2Mask ?? 0;
    this.events = (song.events ?? []).map((e) => ({ ...e }));
    this.coils = (song.coils ?? []).map((c) => ({ ...c }));
    this.coilCount = song.coilCount ?? (this.coils.length || 1);
    this.tags = (song.tags ?? []).map((t) => ({ ...t }));
    this.stereo = song.stereo ? clone(song.stereo) : null;
    this.programs = {};
    while (this.coils.length < this.coilCount) this.coils.push(SongDraft.newCoil(this.coils.length));
    if (this.coils.length > this.coilCount) this.coils.length = this.coilCount;
    this.active = 0;
    this.ways = [
      { id: OWN_WAY, name: '', coilCount: this.coilCount, coils: this.coilsPayload(), events: this.eventsPayload(), stereo: clone(this.stereo) },
      ...(song.variants ?? []).map((v) => ({
        id: v.id, name: v.name ?? '', coilCount: v.coilCount, coils: clone(v.coils), events: clone(v.events ?? []), stereo: clone(v.stereo ?? null),
      })),
    ];
  }

  /** A new song: `count` places, the coils of `pick` on the first ones. */
  reset(count: number, pick: readonly string[]): void {
    this.id = null;
    this.name = '';
    this.output2Mask = 0;
    this.coilCount = pick.length ? pick.length : count;
    this.coils = Array.from({ length: this.coilCount }, (_, i) => ({ ...SongDraft.newCoil(i), coilUuid: pick[i] ?? null }));
    this.events = [];
    this.tags = [];
    this.stereo = null;
    this.programs = {};
    this.ways = [];
    this.active = 0;
  }

  /** As many places as the coil count: the new ones unset. */
  fitCoils(): void {
    const n = this.coilCount;
    if (this.coils.length === n) return;
    const next: CoilConfig[] = [];
    for (let i = 0; i < n; i++) next.push(this.coils[i] ?? SongDraft.newCoil(i));
    this.coils = next;
  }

  coilsPayload(): CoilConfig[] {
    return this.coils.slice(0, this.coilCount).map((c, i) => ({
      coilIndex: i,
      coilUuid: c.coilUuid ?? null,
      channelMask: c.channelMask,
      ontimeUs: c.ontimeUs,
      duty: c.duty,
    }));
  }

  eventsPayload(): CoilEvent[] {
    return this.events
      .filter((e) => e.coilIndex < this.coilCount)
      .map((e) => ({ coilIndex: e.coilIndex, atMs: Math.round(e.atMs), param: e.param, value: e.value, ...(e.ramp ? { ramp: true } : {}) }));
  }

  /** The way being edited, as the fields hold it. */
  activeWay(): Way {
    const meta = this.ways[this.active] ?? { id: OWN_WAY, name: '' };
    return { id: meta.id, name: meta.name, coilCount: this.coilCount, coils: this.coilsPayload(), events: this.eventsPayload(), stereo: this.stereo };
  }

  allWays(): Way[] {
    const ways = this.ways.length ? [...this.ways] : [this.activeWay()];
    ways[this.active] = this.activeWay();
    return ways;
  }

  /** A way's coils, settings, automation and stage into the fields. */
  load(w: Way): void {
    this.coils = clone(w.coils);
    this.coilCount = w.coilCount;
    this.events = clone(w.events);
    this.stereo = clone(w.stereo);
  }

  /** Opens way `i`; false when it is the one open, or none. */
  switchTo(i: number): boolean {
    if (i === this.active) return false;
    const ways = this.allWays();
    if (!ways[i]) return false;
    this.ways = ways;
    this.active = i;
    this.load(ways[i]);
    return true;
  }

  /** Drops the variant being edited, back to the song's own coils; false on the song's own. */
  removeActive(): boolean {
    if (this.active === 0) return false;
    const ways = this.allWays();
    ways.splice(this.active, 1);
    this.ways = ways;
    this.active = 0;
    this.load(ways[0]);
    return true;
  }

  renameActive(name: string): void {
    if (this.ways[this.active]) this.ways[this.active] = { ...this.ways[this.active], name: name.trim() };
  }

  /** The ways listed apart from the fields, before a dialog works on them. */
  keepWays(): void {
    if (!this.ways.length) this.ways = this.allWays();
  }

  /**
   * "Décliner pour…": the way on other coils, opened. `targets`: the coil each
   * place goes to (null: left out); `added`: coils after them. Kept as they were,
   * its places' settings are carried to their coils by `carry` (their drives, in
   * order); with a place gone or added, the routing is the Assistant's to redo
   * (`dropped`). Null: nothing to make.
   */
  decline(
    targets: readonly (string | null)[],
    added: readonly string[],
    id: string,
    carry: ((src: CoilConfig[], coils: string[]) => { ontimeUs: number; duty: number }[]) | null,
  ): { dropped: boolean } | null {
    const src = this.activeWay();
    const keep = targets.map((u, k) => ({ k, u })).filter((x): x is { k: number; u: string } => !!x.u);
    if (!keep.length && !added.length) return null;
    const at = new Map(keep.map((x, i) => [x.k, i]));
    const dropped = keep.length < src.coilCount || added.length > 0;
    let coils: CoilConfig[] = [
      ...keep.map((x, i) => ({ ...src.coils[x.k], coilIndex: i, coilUuid: x.u })),
      ...added.map((u, j) => ({ ...SongDraft.newCoil(keep.length + j), coilUuid: u })),
    ];
    const events = src.events
      .filter((e) => e.coilIndex === SONG_WIDE || at.has(e.coilIndex))
      .map((e) => (e.coilIndex === SONG_WIDE ? e : { ...e, coilIndex: at.get(e.coilIndex)! }));
    const stereo = src.stereo && !added.length ? { ...src.stereo, coils: keep.map((x) => src.stereo!.coils[x.k]).filter((c) => !!c) } : null;
    const drives = !dropped && carry ? carry(src.coils.slice(0, src.coilCount), keep.map((x) => x.u)) : null;
    if (drives) coils = coils.map((c, i) => ({ ...c, ontimeUs: drives[i].ontimeUs, duty: drives[i].duty }));
    const way: Way = { id, name: '', coilCount: coils.length, coils, events, stereo };
    const ways = this.allWays();
    ways.push(way);
    this.ways = ways;
    this.active = ways.length - 1;
    this.load(way);
    return { dropped };
  }

  /**
   * A coil ticked or unticked: its place added at the end, or taken out with
   * what is set for it (its automation, its spot on the stage), the places after
   * it moving up one. `placed`: the coil at each place now; they are written
   * down: the song no longer follows the inventory's order.
   */
  toggleCoil(uuid: string, placed: readonly (string | null)[]): PlaceChange {
    const k = placed.findIndex((u) => u === uuid);
    this.coils.forEach((c, i) => { if (i < this.coilCount) c.coilUuid = placed[i] ?? c.coilUuid ?? null; });
    if (k < 0) {
      if (this.coilCount >= MAX_COILS) return null;
      const at = this.coilCount;
      this.coils = [...this.coils.slice(0, at), { ...SongDraft.newCoil(at), coilUuid: uuid }];
      this.coilCount = at + 1;
      return { added: at };
    }
    if (this.coilCount <= 1) return null;
    this.coils = this.coils.slice(0, this.coilCount).filter((_, i) => i !== k).map((c, i) => ({ ...c, coilIndex: i }));
    this.events = this.events.filter((e) => e.coilIndex !== k).map((e) => (e.coilIndex > k ? { ...e, coilIndex: e.coilIndex - 1 } : e));
    if (this.stereo) this.stereo = { ...this.stereo, coils: this.stereo.coils.filter((_, i) => i !== k) };
    this.coilCount -= 1;
    return { removed: k };
  }

  /** What POST / PUT /api/songs takes. */
  payload() {
    const [own, ...variants] = this.allWays();
    return {
      name: this.name,
      coilCount: own.coilCount,
      mode: SongDraft.MODE,
      output2Mask: this.output2Mask,
      coils: own.coils,
      events: own.events,
      tagIds: this.tags.filter((t) => t.id != null).map((t) => t.id),
      stereo: own.stereo,
      variants: variants.map((w) => ({ id: w.id, name: w.name, coilCount: w.coilCount, coils: w.coils, events: w.events, stereo: w.stereo })),
    };
  }

  /** What tells unsaved changes: the draft as a save would send it, its envelopes too. */
  snapshot(): string {
    const p = this.payload();
    return JSON.stringify({ ...p, tagIds: [...p.tagIds].sort(), programs: this.programs });
  }

  state(): DraftState {
    return {
      name: this.name, coilCount: this.coilCount, output2Mask: this.output2Mask,
      coils: this.coils, events: this.events, tags: this.tags, stereo: this.stereo, programs: this.programs,
      ways: this.ways, active: this.active,
    };
  }

  restore(s: DraftState): void {
    this.name = s.name;
    this.output2Mask = s.output2Mask;
    this.coils = s.coils;
    this.coilCount = s.coilCount;
    this.events = s.events;
    this.tags = s.tags;
    this.stereo = s.stereo;
    this.programs = s.programs;
    this.ways = s.ways;
    this.active = s.active;
  }

  /**
   * The song the player is handed: `file` heard from `previewUrl` when the
   * envelopes changed, without what is muted (bit masks of channels, of places).
   */
  forPlayer(file: MidiFile | null, previewUrl: string | null, mutedChannels: number, mutedCoils: number): Song {
    return {
      id: this.id ?? 0,
      name: this.name,
      midiFile: file && previewUrl ? { ...file, path: previewUrl, hash: null } : file,
      coilCount: this.coilCount,
      mode: SongDraft.MODE,
      output2Mask: this.output2Mask & ~mutedChannels,
      coils: this.coilsPayload().map((c) => ({
        ...c, channelMask: mutedCoils & (1 << c.coilIndex) ? 0 : c.channelMask & ~mutedChannels,
      })),
      events: this.events.filter((e) => e.coilIndex < this.coilCount),
      tags: this.tags.map((t) => ({ ...t })),
      stereo: this.stereo,
    };
  }
}
