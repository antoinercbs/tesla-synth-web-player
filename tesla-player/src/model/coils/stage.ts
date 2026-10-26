import type { TeslaCoil } from './inventory';
import { SONG_WIDE, type CoilConfig, type Song, type SongVariant } from '@/model/domain';

export interface OnStage {
  /** The song as the board plays it: each place on its coil's output. */
  song: Song;
  /** The places whose coil is on no output (or unknown), nor a twin of it: they don't play. */
  missing: { place: number; coil: TeslaCoil | null }[];
  /** The places a twin plays: their coil is off stage, its twin on it. */
  twins: { place: number; coil: TeslaCoil; twin: TeslaCoil }[];
}

export interface Chosen {
  /** The song as that way plays it. */
  song: Song;
  /** The variant played; null: the song's own coils. */
  variant: SongVariant | null;
  /** Every place of it is on stage (or a twin of its coil). */
  fits: boolean;
}

/**
 * Songs and the stage, on the club's coils (the inventory). A song keeps its
 * places 0…n−1 (its stereo, dynamics and the Assistant work by place) and the
 * real coil at each (CoilConfig.coilUuid; absent, the inventory's coil at that
 * place, as before the coils were picked). The board's outputs are wired to
 * coils (`outputOf` gives where a coil is, -1: off stage): a place plays on the
 * output its coil is wired to, or a twin's (same twinGroup) when the coil is off
 * stage. A song may have other ways to be played (its variants): the stage picks
 * the one that fits it. Without an inventory (an older server), every song
 * plays, place k on output k, as before.
 */
export class PhyStage {
  constructor(readonly inventory: readonly TeslaCoil[]) {}

  /** A song played one of its ways: that way's coils, settings, automation and spatialisation. */
  static asWay(song: Song, variant: SongVariant | null): Song {
    if (!variant) return song;
    return { ...song, coilCount: variant.coilCount, coils: variant.coils, events: variant.events ?? [], stereo: variant.stereo ?? null };
  }

  /** The coil at place k of a song: its own, else the inventory's coil k. */
  placeCoil(coils: readonly CoilConfig[], k: number): TeslaCoil | null {
    const uuid = coils.find((c) => c.coilIndex === k)?.coilUuid;
    if (uuid) return this.inventory.find((c) => c.uuid === uuid) ?? null;
    return this.inventory[k] ?? null;
  }

  /**
   * The song as the board plays it: its places moved to the outputs their coils
   * (or their twins) are wired to (channels, levels, automation, stereo places).
   */
  onStage(song: Song, outputOf: (uuid: string) => number): OnStage {
    const coils = song.coils.slice(0, song.coilCount);
    if (!this.inventory.length) return { song, missing: [], twins: [] };
    const { out, missing, twins } = this.placement(coils, outputOf);
    const placed = coils.filter((c) => out.has(c.coilIndex)).map((c) => ({ ...c, coilIndex: out.get(c.coilIndex)! }));
    const events = (song.events ?? [])
      .filter((e) => e.coilIndex === SONG_WIDE || out.has(e.coilIndex))
      .map((e) => (e.coilIndex === SONG_WIDE ? e : { ...e, coilIndex: out.get(e.coilIndex)! }));
    let stereo = song.stereo ?? null;
    if (stereo) {
      const places: typeof stereo.coils = [];
      for (const [k, o] of out) if (stereo.coils[k]) places[o] = stereo.coils[k];
      stereo = { ...stereo, coils: places };
    }
    const coilCount = placed.reduce((n, c) => Math.max(n, c.coilIndex + 1), 0);
    return { song: { ...song, coils: placed, events, stereo, coilCount }, missing, twins };
  }

  /**
   * The way of a song the stage plays: one whose coils are all on stage (or
   * twins of them), the most coils first; else the one with the most of its
   * coils on stage. On a tie, the first: the song's own coils, then its
   * variants in order.
   */
  chooseWay(song: Song, outputOf: (uuid: string) => number): Chosen {
    const ways: (SongVariant | null)[] = [null, ...(song.variants ?? [])];
    if (!this.inventory.length) return { song, variant: null, fits: true };
    let best: Chosen | null = null;
    let bestScore = -1;
    for (const v of ways) {
      const s = PhyStage.asWay(song, v);
      const coils = s.coils.slice(0, s.coilCount);
      const { out } = this.placement(coils, outputOf);
      const fits = out.size === coils.length;
      // fitting ways above all the others, then the most coils playing
      const score = (fits ? 1000 : 0) + out.size;
      if (score > bestScore) {
        best = { song: s, variant: v, fits };
        bestScore = score;
      }
    }
    return best!;
  }

  /** Can a song play whole on a stage (coil uuids)? One of its ways fits it. */
  fits(song: Song, stage: readonly string[]): boolean {
    return this.chooseWay(song, (u) => stage.indexOf(u)).fits;
  }

  /** Does a song play on the stage wired now (`outputOf`)? */
  playsHere(song: Song, outputOf: (uuid: string) => number): boolean {
    return !this.inventory.length || this.chooseWay(song, outputOf).fits;
  }

  /** What a song lacks to play on the stage: the coils of its way closest to it that are on no output. */
  missingHere(song: Song, outputOf: (uuid: string) => number): string[] {
    const way = this.chooseWay(song, outputOf);
    if (way.fits) return [];
    return this.onStage(way.song, outputOf).missing.map((m) => m.coil?.name ?? `#${m.place}`);
  }

  /** A way's name: its own, else its coils' names. */
  wayName(coils: readonly CoilConfig[], name: string | undefined): string {
    if (name?.trim()) return name.trim();
    return coils.map((c) => this.placeCoil(coils, c.coilIndex)?.name ?? `#${c.coilIndex}`).join(' + ');
  }

  /**
   * Where each place of a song plays: its coil's output first, then, for a coil
   * off stage, the output of a twin of it (same twinGroup) that no place took.
   */
  private placement(coils: readonly CoilConfig[], outputOf: (uuid: string) => number):
    { out: Map<number, number>; missing: OnStage['missing']; twins: OnStage['twins'] } {
    const out = new Map<number, number>();
    const taken = new Set<number>();
    const off: { place: number; coil: TeslaCoil | null }[] = [];
    for (const c of coils) {
      const coil = this.placeCoil(coils, c.coilIndex);
      const o = coil ? outputOf(coil.uuid) : -1;
      if (o >= 0 && !taken.has(o)) {
        out.set(c.coilIndex, o);
        taken.add(o);
      } else {
        off.push({ place: c.coilIndex, coil });
      }
    }
    const missing: OnStage['missing'] = [];
    const twins: OnStage['twins'] = [];
    for (const m of off) {
      const group = m.coil?.twinGroup;
      const twin = group
        ? this.inventory.find((x) => x.uuid !== m.coil!.uuid && x.twinGroup === group && outputOf(x.uuid) >= 0 && !taken.has(outputOf(x.uuid)))
        : undefined;
      if (!twin) { missing.push(m); continue; }
      const o = outputOf(twin.uuid);
      out.set(m.place, o);
      taken.add(o);
      twins.push({ place: m.place, coil: m.coil!, twin });
    }
    return { out, missing, twins };
  }
}
