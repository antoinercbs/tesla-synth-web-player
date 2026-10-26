import { PhyResponse, type CoilResponse } from '@/model/coils/response';
import { CalCoil, type CalFit } from './coil';
import { CalRouting, type CalSetup } from './routing';
import { CalSong } from './song';
import { CLEAN_POWER, CLEAN_TILT, LOUD_LOAD, LOUD_SHARE, type CalibRequest, type CalibResult, type IntentionPlan } from './types';

/**
 * The Assistant's numbers: which channels each coil plays, and each coil's
 * ontime and duty, from the song's notes and the coils' limits. Pure and
 * plain-data in and out, so it runs in a worker (engine/calib/calib.worker.ts).
 *
 * Two intentions. Clean: every note in its place, none stuck at the max ontime
 * (where velocity and nuance stop counting) and few shrunk by the max duty the
 * notes share; the coil's colour is where its crossover sits among its notes.
 * Loud: the longest arcs, the max ontime on every note, the board holding the
 * duty at its max when it saturates. What it finds is only numbers: the song
 * stores them like any setting made by hand.
 *
 * A coil with a sheet is heard through its physics (model/coils/sound.ts), and the
 * clean intention keeps its bangs off the OCD and its arcs off the ground mat.
 */
export class CalCalibration extends CalSong {
  /** The coils' physics, worked out once per sheet. */
  private readonly physics: (CoilResponse | null)[];
  // coils with the same limits and sheet share their fits
  private readonly cleanFits = new Map<string, CalFit | null>();
  private readonly loudFits = new Map<string, CalSetup | null>();

  constructor(readonly req: CalibRequest) {
    super(req);
    this.physics = Array.from({ length: req.coilCount }, (_, k) => {
      const spec = req.specs?.[k];
      return spec ? PhyResponse.of(spec) : null;
    });
  }

  run(): CalibResult {
    const req = this.req;
    const cleanMasks = req.masks ?? new CalRouting(req, (k, m) => this.cleanFit(k, m)?.cell ?? null).masks();
    const loudMasks = req.masks ?? new CalRouting(req, (k, m) => this.loudFit(k, m)).masks();

    const clean: IntentionPlan = { masks: cleanMasks, pads: [], pick: [] };
    cleanMasks.forEach((mask, k) => {
      const coil = mask ? this.coilAt(k, mask) : null;
      if (!coil) { clean.pads.push(null); clean.pick.push({ y: CLEAN_POWER.indexOf(CalCoil.DEFAULT_POWER), x: 2 }); return; }
      const q = this.qOf(mask);
      clean.pads.push(CLEAN_POWER.map((p) => CLEAN_TILT.map((t) => {
        const drive = coil.cleanDrive(p, t, q);
        return { o: drive.ontimeUs, d: drive.duty, ...coil.assess(drive) };
      })));
      clean.pick.push({ y: CLEAN_POWER.indexOf(CalCoil.DEFAULT_POWER), x: CLEAN_TILT.indexOf(this.cleanFit(k, mask)!.tilt) });
    });

    const loud: IntentionPlan = { masks: loudMasks, pads: [], pick: [] };
    loudMasks.forEach((mask, k) => {
      const coil = mask ? this.coilAt(k, mask) : null;
      loud.pick.push({ y: LOUD_SHARE.length - 1, x: LOUD_LOAD.length - 1 });
      if (!coil) { loud.pads.push(null); return; }
      loud.pads.push(LOUD_SHARE.map((share) => LOUD_LOAD.map((load) => {
        const drive = coil.loudDrive(share, load);
        return { o: drive.ontimeUs, d: drive.duty, ...coil.assess(drive) };
      })));
    });
    return { clean, loud };
  }

  /** The melody's coil may only rarely be shrunk. */
  private qOf(mask: number): number {
    const melody = this.req.profiles.find((c) => c.role === 'melody')?.ch ?? -1;
    return mask & (1 << melody) ? 0.99 : 0.97;
  }

  /** Coil k playing the channels of `mask`, with its physics; null when they have no note. */
  private coilAt(k: number, mask: number): CalCoil | null {
    const cn = this.notesOf(mask);
    return cn ? new CalCoil(cn, this.req.limits[k], this.req.hw, this.physics[k], this.s) : null;
  }

  private limKey(k: number, mask: number): string {
    return `${JSON.stringify([this.req.limits[k], this.req.specs?.[k] ?? null])}|${mask}`;
  }

  private cleanFit(k: number, mask: number): CalFit | null {
    const key = this.limKey(k, mask);
    if (!this.cleanFits.has(key)) this.cleanFits.set(key, this.coilAt(k, mask)?.bestClean(this.qOf(mask)) ?? null);
    return this.cleanFits.get(key)!;
  }

  private loudFit(k: number, mask: number): CalSetup | null {
    const key = this.limKey(k, mask);
    if (!this.loudFits.has(key)) {
      const coil = this.coilAt(k, mask);
      this.loudFits.set(key, coil ? coil.assess(coil.loudDrive(1, 1)) : null);
    }
    return this.loudFits.get(key)!;
  }
}
