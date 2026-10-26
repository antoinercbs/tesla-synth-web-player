import type { CoilDrive } from '@/model/devices/output';
import { PhyResponse } from '@/model/coils/response';
import type { CoilSpec } from '@/model/coils/spec';
import type { MidiAnalysis } from '@/model/midi/analyze';
import { MidNote } from '@/model/midi/note';
import { SndEnvelope } from '@/model/envelopes/envelope';
import { CalCoil } from './coil';
import { CalNotes } from './notes';
import { CalScratch } from './scratch';
import type { AssistSummary, CalibNote, CalibSongData, HwLimits, Limits, PadMeasures } from './types';

/** A coil's place in a song: the channels it plays and its setting. */
export interface CalPlace { channelMask: number; ontimeUs: number; duty: number }

/**
 * A song as the Assistant's searches take it: its notes over BIN_MS bins (each
 * note adds the duty it asks for to every bin it sounds in, its envelope's
 * release included), its coils' limits and sheets. The board limits the notes
 * sounding together at each instant; bins keep the searches fast, and the real
 * simulation (DevSimulation) judges the result.
 */
export class CalSong {
  protected readonly s: CalScratch;
  private readonly notesCache = new Map<number, CalNotes | null>();

  constructor(readonly data: CalibSongData) {
    this.s = new CalScratch(data.durationMs);
  }

  static toCalibNotes(
    notes: readonly { channel: number; note: number; startMs: number; endMs: number; velocity: number; volume: number }[],
    hzOf: (note: number) => number,
    releaseMs: (ch: number) => number,
  ): CalibNote[] {
    return notes.map((n) => ({
      ch: n.channel, hz: hzOf(n.note), lvl: (n.velocity / 127) * n.volume,
      startMs: n.startMs, endMs: n.endMs + releaseMs(n.channel), durMs: n.endMs - n.startMs,
    }));
  }

  /** An analysed song's notes: their pitch, level, and their channel's envelope release. */
  static notesOfAnalysis(a: MidiAnalysis): CalibNote[] {
    return CalSong.toCalibNotes(a.notes, MidNote.hz, (ch) => SndEnvelope.of(a.programByChannel[ch] ?? 0).releaseMs);
  }

  /** An analysed song on coils with these limits and sheets. */
  static fromAnalysis(a: MidiAnalysis, limits: Limits[], specs: (CoilSpec | null)[]): CalSong {
    return new CalSong({ durationMs: a.durationMs, notes: CalSong.notesOfAnalysis(a), limits, specs });
  }

  /** The loudness of coils heard together (dB), from each one's level. */
  static combinedLevel(levels: readonly number[]): number {
    const sum = levels.reduce((t, l) => t + 10 ** (l / 10), 0);
    return sum > 0 ? 10 * Math.log10(sum) : -60;
  }

  /** The notes of the channels in `mask`; null: none. Worked out once per mask. */
  notesOf(mask: number): CalNotes | null {
    if (!this.notesCache.has(mask)) this.notesCache.set(mask, CalNotes.of(this.data.notes, mask, this.s.bins));
    return this.notesCache.get(mask)!;
  }

  /** A coil playing the channels of `mask` under `lim`; null when they have no note. */
  coil(mask: number, lim: Limits, hw: HwLimits | null, spec: CoilSpec | null | undefined): CalCoil | null {
    const cn = this.notesOf(mask);
    return cn ? new CalCoil(cn, lim, hw, spec ? PhyResponse.of(spec) : null, this.s) : null;
  }

  /** How a setting treats each coil's notes, by the same measures as the pads (a coil with no channel: null). */
  assessSetting(places: readonly CalPlace[]): (PadMeasures | null)[] {
    return places.map((c, k) => {
      const coil = c.channelMask ? this.coil(c.channelMask, this.data.limits[k], null, this.data.specs?.[k]) : null;
      return coil ? coil.assess({ ontimeUs: c.ontimeUs, duty: c.duty }) : null;
    });
  }

  /** A setting summed up over its coils, by the pads' measures; null when no coil plays. */
  summary(places: readonly CalPlace[]): AssistSummary | null {
    const per = this.assessSetting(places).filter((x): x is PadMeasures => x != null);
    if (!per.length) return null;
    const mean = (k: 'capped' | 'busy'): number => per.reduce((t, x) => t + x[k], 0) / per.length;
    return { capped: mean('capped'), reduced: mean('busy'), level: CalSong.combinedLevel(per.map((x) => x.level)) };
  }

  /**
   * A setting carried to other coils ("Décliner pour…"): each place keeps its
   * channels and its crossover (its duty over its ontime: where the bass leaves
   * the ontime for the duty), and gets the ontime whose level on its new coil is
   * the one it had on the old coil, as far as the new coil allows it cleanly:
   * under its max ontime and max duty, the notes' demand under its max duty and
   * its bangs off the OCD as often as the clean intention keeps them, or as the
   * old setting did on the old coil (never worse than it was).
   */
  carrySetting(to: { limits: Limits[]; specs: (CoilSpec | null)[]; hw: HwLimits | null }, places: readonly CalPlace[]): CoilDrive[] {
    const Q = 0.97;
    return places.map((c, k) => {
      const lim = to.limits[k];
      const from = c.channelMask && lim && c.ontimeUs > 0 ? this.coil(c.channelMask, this.data.limits[k], null, this.data.specs?.[k]) : null;
      if (!from) return { ontimeUs: c.ontimeUs, duty: c.duty };
      const aim = from.assess(c).level;
      // how far the old setting went past its own coil's clean bounds
      const overDuty = Math.max(1, from.demandAt(c, Q) / from.lim.duty);
      const overOcd = Math.max(1 - Q, from.ocdShare(c));
      const coil = this.coil(c.channelMask, lim, to.hw, to.specs[k])!;
      const crossover = (c.duty * 1e6) / c.ontimeUs;
      const driveOf = (o: number): CoilDrive => ({ ontimeUs: o, duty: Math.min(coil.maxDuty, (o * crossover) / 1e6) });
      const clean = (o: number): boolean =>
        coil.demandAt(driveOf(o), Q) <= lim.duty * overDuty + 1e-9 && coil.ocdShare(driveOf(o)) <= overOcd + 1e-9;
      // the loudest ontime not past the old level, then down to a clean one
      let lo = 1, hi = Math.max(1, coil.maxOntime);
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        if (coil.assess(driveOf(mid)).level <= aim) lo = mid;
        else hi = mid;
      }
      if (!clean(lo)) {
        let ok = 1, bad = lo;
        for (let i = 0; i < 18; i++) {
          const mid = (ok + bad) / 2;
          if (clean(mid)) ok = mid;
          else bad = mid;
        }
        lo = ok;
      }
      return CalCoil.round(driveOf(lo));
    });
  }
}
