import { DevOutput } from '@/model/devices/output';
import { MidNote } from '@/model/midi/note';
import type { ChannelProfile } from '@/model/calib/roles';
import { CLEAN_POWER, CLEAN_TILT, LOUD_LOAD, LOUD_SHARE, type CalibResult, type IntentionPlan, type PadCell } from './types';
import { CalSong } from './song';

export type Intention = 'clean' | 'loud';
export type CleanPreset = 'balanced' | 'strong' | 'safe' | 'bass' | 'bright';
export type LoudPreset = 'loud' | 'loudSoft' | 'loudShort';
export type Preset = CleanPreset | LoudPreset | 'custom';
export interface PadPos { y: number; x: number }
export type PadState = 'free' | 'reduced' | 'capped' | 'neverHeld' | 'held';

/** One coil as the Assistant sets it. */
export interface CoilProposal {
  coilIndex: number;
  channelMask: number;
  ontimeUs: number;
  duty: number;
  /** The pad's spot, null for a coil with no channel. */
  cell: PadCell | null;
  /** Lowered for the melody (dB, 0: not). */
  dropDb: number;
  /** It plays the melody. */
  melody: boolean;
  /** Where its crossover sits, as a note name. */
  crossover: string;
}

/**
 * What the Assistant's controls mean on a calibration's result (CalCalibration),
 * for the song: the intention, its presets as spots on each coil's pad, the
 * melody's priority. Pure, so the atelier only keeps the choices.
 */
export class CalAssistant {
  /** Clean presets: a power for every coil, and its crossover: the one the Assistant found best, or forced. */
  static readonly CLEAN_PRESETS: { key: CleanPreset; power: number; tilt: number | null }[] = [
    { key: 'balanced', power: 0.8, tilt: null },
    { key: 'strong', power: 1, tilt: null },
    { key: 'safe', power: 0.5, tilt: null },
    { key: 'bass', power: 0.8, tilt: 0 },
    { key: 'bright', power: 0.8, tilt: 1 },
  ];
  /** Loud presets: arc length × load, the same on every coil. */
  static readonly LOUD_PRESETS: { key: LoudPreset; share: number; load: number }[] = [
    { key: 'loud', share: 1, load: 1 },
    { key: 'loudSoft', share: 1, load: 0.55 },
    { key: 'loudShort', share: 0.7, load: 0.7 },
  ];
  /** The melody's lead over the other coils (dB): they come down to it, never the melody up. */
  private static readonly MELODY_LEAD_DB = 3;

  constructor(readonly result: CalibResult) {}

  /**
   * What a pad's spot does to the coil's notes, its colour (CoilPad) and its line
   * in the key. Clean: free, shrunk by the max duty, stuck at the max ontime.
   * Loud: never held back, or held at the max duty.
   */
  static padState(cell: PadCell, intention: Intention): PadState {
    if (intention === 'loud') return cell.busy > 0.02 ? 'held' : 'neverHeld';
    if (cell.capped > 0.02) return 'capped';
    return cell.busy > 0.001 ? 'reduced' : 'free';
  }

  /** The coils as the pads' spots set them, the melody led when `priority`. */
  static proposal(
    plan: IntentionPlan,
    pads: readonly PadPos[],
    profiles: readonly ChannelProfile[],
    { priority, intention }: { priority: boolean; intention: Intention },
  ): CoilProposal[] {
    const melodyCh = profiles.find((c) => c.role === 'melody')?.ch ?? -1;
    const out = plan.masks.map((mask, k): CoilProposal => {
      const pad = plan.pads[k];
      const cell = pad ? CalAssistant.cellAt(pad, pads[k] ?? plan.pick[k]) : null;
      return {
        coilIndex: k, channelMask: mask, ontimeUs: cell ? Math.max(1, Math.round(cell.o)) : 40,
        duty: cell ? Math.round(cell.d * 1e4) / 1e4 : 0.05, cell, dropDb: 0,
        melody: melodyCh >= 0 && (mask & (1 << melodyCh)) !== 0, crossover: '',
      };
    });
    // the loud intention wants every arc long: no coil comes down there
    if (priority && intention === 'clean' && out.some((c) => c.melody && c.cell)) {
      // the melody as heard: every coil playing it, together
      const top = CalSong.combinedLevel(out.filter((c) => c.melody && c.cell).map((c) => c.cell!.level)) - CalAssistant.MELODY_LEAD_DB;
      for (const c of out) {
        if (c.melody || !c.cell || c.cell.level <= top) continue;
        const f = 10 ** ((top - c.cell.level) / 20);
        c.dropDb = c.cell.level - top;
        c.ontimeUs = Math.max(1, Math.round(c.ontimeUs * f));
        c.duty = Math.round(c.duty * f * 1e4) / 1e4;
      }
    }
    for (const c of out) c.crossover = MidNote.name(Math.max(0, Math.min(127, MidNote.nearest(new DevOutput(c).crossoverHz))));
    return out;
  }

  /**
   * A pad's setting anywhere on it, between its computed spots: each figure read
   * off the four spots around, so the point slides through a continuum.
   */
  private static cellAt(pad: readonly PadCell[][], pos: PadPos): PadCell {
    const ny = pad.length, nx = pad[0].length;
    const y = Math.max(0, Math.min(ny - 1, pos.y)), x = Math.max(0, Math.min(nx - 1, pos.x));
    const y0 = Math.floor(y), x0 = Math.floor(x);
    const y1 = Math.min(ny - 1, y0 + 1), x1 = Math.min(nx - 1, x0 + 1);
    const fy = y - y0, fx = x - x0;
    const mix = (k: keyof PadCell): number =>
      (1 - fy) * ((1 - fx) * pad[y0][x0][k] + fx * pad[y0][x1][k]) + fy * ((1 - fx) * pad[y1][x0][k] + fx * pad[y1][x1][k]);
    return { o: mix('o'), d: mix('d'), level: mix('level'), spread: mix('spread'), capped: mix('capped'), busy: mix('busy'), ocd: mix('ocd') };
  }

  /** Each coil's spot for a preset. */
  presetPads(intention: Intention, preset: Preset): PadPos[] {
    const plan = this.result[intention];
    if (intention === 'clean') {
      const p = CalAssistant.CLEAN_PRESETS.find((x) => x.key === preset) ?? CalAssistant.CLEAN_PRESETS[0];
      return plan.pick.map((pick) => ({ y: CLEAN_POWER.indexOf(p.power), x: p.tilt == null ? pick.x : CLEAN_TILT.indexOf(p.tilt) }));
    }
    const p = CalAssistant.LOUD_PRESETS.find((x) => x.key === preset) ?? CalAssistant.LOUD_PRESETS[0];
    return plan.pick.map(() => ({ y: LOUD_SHARE.indexOf(p.share), x: LOUD_LOAD.indexOf(p.load) }));
  }

  /**
   * Where a saved setting sits on the pads: for each coil the spot giving the
   * closest ontime and duty (by ratio), and the intention whose pads it fits best.
   */
  placeSetting(
    coils: readonly { ontimeUs: number; duty: number }[],
  ): { intention: Intention; pads: Record<Intention, PadPos[]> } {
    const fit = (plan: IntentionPlan): { pads: PadPos[]; err: number } => {
      let err = 0;
      const pads = plan.pads.map((pad, k) => {
        const c = coils[k];
        if (!pad || !c) return plan.pick[k];
        let best = plan.pick[k], bestErr = Infinity;
        pad.forEach((row, y) => row.forEach((cell, x) => {
          const e = Math.log(Math.max(1, cell.o) / Math.max(1, c.ontimeUs)) ** 2 + Math.log(Math.max(1e-4, cell.d) / Math.max(1e-4, c.duty)) ** 2;
          if (e < bestErr) { bestErr = e; best = { y, x }; }
        }));
        err += bestErr;
        return best;
      });
      return { pads, err };
    };
    const clean = fit(this.result.clean), loud = fit(this.result.loud);
    return { intention: loud.err < clean.err ? 'loud' : 'clean', pads: { clean: clean.pads, loud: loud.pads } };
  }

  /** The preset the pads stand on, or 'custom'. */
  presetOf(intention: Intention, pads: readonly PadPos[]): Preset {
    const keys = intention === 'clean' ? CalAssistant.CLEAN_PRESETS.map((p) => p.key) : CalAssistant.LOUD_PRESETS.map((p) => p.key);
    const near = (u: number, v: number | undefined): boolean => v != null && Math.abs(u - v) < 1e-6;
    const same = (a: readonly PadPos[], b: readonly PadPos[]): boolean =>
      a.every((p, k) => !this.result[intention].pads[k] || (near(p.y, b[k]?.y) && near(p.x, b[k]?.x)));
    return keys.find((key) => same(pads, this.presetPads(intention, key))) ?? 'custom';
  }
}
