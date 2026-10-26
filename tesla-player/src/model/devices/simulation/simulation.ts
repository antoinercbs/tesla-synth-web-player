import type { MidiAnalysis } from '@/model/midi/analyze';
import { MidAutomation } from '@/model/midi/automation';
import { MidStereo } from '@/model/midi/stereo';
import { SndEnvelope } from '@/model/envelopes/envelope';
import { SONG_WIDE, type CoilConfig, type CoilEvent, type SongStereo } from '@/model/domain';
import { MidNote } from '@/model/midi/note';
import { DevBoard, type BoardCoil, type BoardNote } from '@/model/devices/board';
import type { CoilLimits } from '@/model/devices/coil-limits';
import { PhyResponse, type CoilResponse } from '@/model/coils/response';
import type { CoilSpec } from '@/model/coils/spec';
import { DevNoteFate } from './note-fate';
import { BANG_AIR, BANG_OCD, BANG_STRIKE, DevTrack } from './track';

export interface SimInput {
  analysis: MidiAnalysis;
  coils: readonly CoilConfig[];
  stereo?: SongStereo | null;
  events?: readonly CoilEvent[];
  /** Each coil's limits, by coil index; absent: unknown, nothing limits it here. */
  limits: readonly (CoilLimits | null | undefined)[];
  /** Each coil's physics, by coil index; absent: a coil without a sheet, its bangs unknown. */
  responses?: readonly (CoilResponse | null | undefined)[];
  /** The player's live power for a coil, percent (100: as configured). */
  power?: (coilIndex: number) => number;
  stepMs?: number;
}

/**
 * The same as plain data, to cross to a worker: the coils' sheets in place of
 * their physics (worked out there), the live power by coil index.
 */
export interface SimWire {
  analysis: MidiAnalysis;
  coils: readonly CoilConfig[];
  stereo?: SongStereo | null;
  events?: readonly CoilEvent[];
  limits: readonly (CoilLimits | null | undefined)[];
  /** Each coil's sheet, by coil index. */
  specs?: readonly (CoilSpec | null | undefined)[];
  /** The live power by coil index, percent (absent: 100). */
  power?: Readonly<Record<number, number>>;
}

const BANG_OF = { short: 0, air: BANG_AIR, ocd: BANG_OCD, strike: BANG_STRIKE } as const;
const STEP_MS = 25;
/** Under this, a coil does not play the note at all (out of the pan's reach). */
const SILENT_PAN = 0.01;

/**
 * A song played through the board, step by step: which notes each coil keeps
 * (the firmware's voices, DevBoard), what each asks for (velocity × the file's
 * volume × its envelope × the coil's pan, under the automation and the live
 * power) and what the coil's limits let through (DevOutput). Feeds the
 * editor's and the player's views of the coils. A coil with a sheet
 * (model/coils/response.ts) also tells what each bang does: the energy its arcs
 * take, and whether it ends in the air, on the OCD or as a strike on the ground mat.
 *
 * The program of a channel is taken as the file's first; pitch bend and the
 * board's LFO are left out.
 */
export class DevSimulation {
  readonly stepMs: number;
  readonly durationMs: number;
  /** In the order of the input's coils. */
  readonly tracks: DevTrack[];
  /** Each coil's notes, in the order they start. */
  readonly fates: DevNoteFate[][];

  constructor({ analysis, coils, stereo = null, events = [], limits, responses = [], power, stepMs = STEP_MS }: SimInput) {
    this.stepMs = stepMs;
    this.durationMs = analysis.durationMs;
    const notes = analysis.notes;
    const program = (ch: number): number => analysis.programByChannel[ch] ?? 0;
    // the player sends the board only the channels a coil plays; a note keeps its voice until its release ends
    const sent = coils.reduce((m, c) => m | c.channelMask, 0);
    const order = notes.map((_, i) => i)
      .filter((i) => sent & (1 << notes[i].channel))
      .sort((a, b) => notes[a].startMs - notes[b].startMs || a - b);
    const holdEnd = notes.map((n) => n.endMs + SndEnvelope.of(program(n.channel)).releaseMs);
    // under the pan's reach a coil doesn't play the note at all
    const vols = MidStereo.noteCoilVolumes(analysis, coils, stereo).map((v) => v.map((x) => (x > SILENT_PAN ? x : 0)));
    const hz = notes.map((n) => MidNote.hz(n.note));
    const songCurve = new MidAutomation(events).points(SONG_WIDE, 'power');
    const curves = coils.map((c) => ({ on: new MidAutomation(events).points(c.coilIndex, 'ontime'), duty: new MidAutomation(events).points(c.coilIndex, 'duty') }));

    const steps = Math.max(1, Math.ceil(analysis.durationMs / stepMs) + 1);
    const tracks = coils.map((c) => new DevTrack(c.coilIndex, steps));
    const fates = coils.map((_, k) => {
      const byNote = new Map<number, DevNoteFate>();
      for (const i of order) if (vols[i][k]) byNote.set(i, new DevNoteFate(i, notes[i]));
      return byNote;
    });
    // by coil, the notes it gave a voice while held, and those of them that made an arc (any pulse, without a sheet)
    const fired = coils.map(() => new Set<number>());
    const sparked = coils.map(() => new Set<number>());

    const board = new DevBoard();
    let next = 0;
    let active: number[] = []; // oldest first
    for (let s = 0; s < steps; s++) {
      const t = s * stepMs;
      while (next < order.length && notes[order[next]].startMs <= t) active.push(order[next++]);
      active = active.filter((i) => {
        if (holdEnd[i] > t) return true;
        board.forget(i);
        return false;
      });
      // velocity × the file's volume × the envelope: the same on every coil
      const held: BoardNote[] = active.map((i) => {
        const n = notes[i];
        const released = t >= n.endMs ? n.endMs - n.startMs : null;
        const level = (n.velocity / 127) * n.volume * SndEnvelope.of(program(n.channel)).amplitude(t - n.startMs, released);
        return { id: i, hz: hz[i], level, vols: vols[i] };
      });
      const song = MidAutomation.curveAt(songCurve, t);
      // what the player sends each coil at this moment (MidiPlayer: coilLevelAt)
      const sentNow: BoardCoil[] = coils.map((c, k) => {
        const p = (power?.(c.coilIndex) ?? 100) / 100;
        return {
          drive: {
            ontimeUs: Math.round(c.ontimeUs * song * MidAutomation.curveAt(curves[k].on, t) * p),
            duty: Math.min(1, c.duty * song * MidAutomation.curveAt(curves[k].duty, t) * p),
          },
          limits: limits[c.coilIndex] ?? null,
        };
      });
      board.step(held, sentNow).forEach((step, k) => {
        const l = step.limited;
        const tr = tracks[k];
        tr.dutyAsked[s] = l.dutyAsked;
        tr.duty[s] = l.duty;
        tr.factor[s] = l.factor;
        tr.pulseUs[s] = l.pulsesUs.reduce((m, us) => Math.max(m, us), 0);
        tr.askedUs[s] = step.askedUs;
        tr.skipped[s] = Math.min(255, step.cut.length);
        for (const j of step.cut) {
          const i = active[j];
          if (t < notes[i].endMs) fates[k].get(i)!.cutAt(t, stepMs, tr);
        }
        const physics = responses[coils[k].coilIndex];
        step.fired.forEach((j, m) => {
          const i = active[j];
          const us = l.pulsesUs[m];
          const playing = t < notes[i].endMs;
          if (playing) fired[k].add(i);
          if (!(us > 0)) return;
          if (playing && !physics) sparked[k].add(i);
          if (playing) {
            const f = fates[k].get(i)!;
            f.minFactor = Math.min(f.minFactor, l.factor);
            f.peakUs = Math.max(f.peakUs, us);
          }
          if (!physics) return;
          const b = physics.at(us, hz[i]);
          tr.powerW[s] += b.e * hz[i];
          tr.arcM[s] = Math.max(tr.arcM[s], b.l);
          tr.bang[s] = Math.max(tr.bang[s], BANG_OF[b.fate]);
          tr.ocdUs[s] = Math.min(tr.ocdUs[s], physics.ocdFrom(hz[i]));
          if (b.fate !== 'short') tr.bangHz[s] += hz[i];
          if (playing && b.fate !== 'short') sparked[k].add(i);
          if (playing && (b.fate === 'ocd' || b.fate === 'strike')) fates[k].get(i)!.bangAt(b.fate, t, stepMs);
        });
      });
    }
    tracks.forEach((tr) => tr.firstCuts.sort((a, b) => a - b));
    // the notes never heard: a mark where each starts
    tracks.forEach((tr, k) => {
      for (const i of fired[k]) {
        if (sparked[k].has(i)) continue;
        fates[k].get(i)!.silent = true;
        tr.silent[Math.min(steps - 1, Math.floor(notes[i].startMs / stepMs))] = 1;
      }
    });
    this.tracks = tracks;
    this.fates = fates.map((m) => [...m.values()]);
  }

  /** A simulation from its plain data (SimWire): where a worker runs it. */
  static fromWire(w: SimWire): DevSimulation {
    const power = w.power;
    return new DevSimulation({
      analysis: w.analysis, coils: w.coils, stereo: w.stereo, events: w.events, limits: w.limits,
      responses: (w.specs ?? []).map((s) => (s ? PhyResponse.of(s) : null)),
      power: power ? (i) => power[i] ?? 100 : undefined,
    });
  }

  /** A simulation that crossed a thread (a structured clone: its data without its classes), given them back. */
  static revive(sim: DevSimulation): DevSimulation {
    for (const tr of sim.tracks) Object.setPrototypeOf(tr, DevTrack.prototype);
    for (const coil of sim.fates) for (const f of coil) Object.setPrototypeOf(f, DevNoteFate.prototype);
    return Object.setPrototypeOf(sim, DevSimulation.prototype) as DevSimulation;
  }

  /** The step of the tracks at `ms`. */
  stepAt(ms: number): number {
    const last = this.tracks[0]?.duty.length ?? 1;
    return Math.max(0, Math.min(last - 1, Math.floor(ms / this.stepMs)));
  }
}
