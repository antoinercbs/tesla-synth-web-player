import type { MidiAnalysis, MidiNote } from '@/midi/analyze';
import { curveAt, curvePoints } from '@/midi/automation';
import { noteCoilVolumes } from '@/midi/stereo';
import { envelopeAmplitude, envelopeReleaseMs } from '@/sysex/envelopes';
import { SONG_WIDE, type CoilConfig, type CoilEvent, type SongStereo } from '@/types/domain';
import { noteFrequency } from '@/ui/piano-layout';
import { BoardCore, type BoardCoil, type BoardNote } from '@/devices/board-core';
import type { CoilLimits } from '@/devices/coil-limits';

/**
 * A song played through the board, step by step: which notes each coil keeps
 * (the firmware's voices, devices/board-core.ts), what each asks for (velocity ×
 * the file's volume × its envelope × the coil's pan, under the automation and the
 * live power) and what the coil's limits let through (devices/ontime-model.ts).
 * Feeds the editor's and the player's views of the coils.
 *
 * The program of a channel is taken as the file's first; pitch bend and the
 * board's LFO are left out.
 */
export interface SimInput {
  analysis: MidiAnalysis;
  coils: readonly CoilConfig[];
  stereo?: SongStereo | null;
  events?: readonly CoilEvent[];
  /** Each coil's limits, by coil index; absent: unknown, nothing limits it here. */
  limits: readonly (CoilLimits | null | undefined)[];
  /** The player's live power for a coil, percent (100: as configured). */
  power?: (coilIndex: number) => number;
  stepMs?: number;
}

/** A coil along the song, one entry per step. */
export interface CoilTrack {
  coilIndex: number;
  /** The duty its notes ask for together, and the duty it fires (fractions). */
  dutyAsked: Float32Array;
  duty: Float32Array;
  /** What the max duty scaled every note by (1: untouched). */
  factor: Float32Array;
  /** The longest pulse fired, and the longest asked for (µs). */
  pulseUs: Float32Array;
  askedUs: Float32Array;
  /** Its notes silenced for lack of a voice. */
  skipped: Uint8Array;
  /** When each of its notes was first silenced (ms), in order: "so far" counts. */
  firstCuts: number[];
}

/** What became of one of a coil's notes between its note-on and its note-off. */
export interface NoteFate {
  /** Its index in analysis.notes. */
  index: number;
  note: MidiNote;
  /** The smallest factor the max duty scaled it by (1: never). */
  minFactor: number;
  /** When it was silenced for lack of a voice (ms). */
  cuts: [number, number][];
}

export interface Simulation {
  stepMs: number;
  durationMs: number;
  /** In the order of the input's coils. */
  tracks: CoilTrack[];
  fates: NoteFate[][];
}

const STEP_MS = 25;
/** Under this, a coil does not play the note at all (out of the pan's reach). */
const SILENT_PAN = 0.01;

export function simulate({ analysis, coils, stereo = null, events = [], limits, power, stepMs = STEP_MS }: SimInput): Simulation {
  const notes = analysis.notes;
  const program = (ch: number): number => analysis.programByChannel[ch] ?? 0;
  // the player sends the board only the channels a coil plays; a note keeps its voice until its release ends
  const sent = coils.reduce((m, c) => m | c.channelMask, 0);
  const order = notes.map((_, i) => i)
    .filter((i) => sent & (1 << notes[i].channel))
    .sort((a, b) => notes[a].startMs - notes[b].startMs || a - b);
  const holdEnd = notes.map((n) => n.endMs + envelopeReleaseMs(program(n.channel)));
  // under the pan's reach a coil doesn't play the note at all
  const vols = noteCoilVolumes(analysis, coils, stereo).map((v) => v.map((x) => (x > SILENT_PAN ? x : 0)));
  const hz = notes.map((n) => noteFrequency(n.note));
  const songCurve = curvePoints(events, SONG_WIDE, 'power');
  const curves = coils.map((c) => ({ on: curvePoints(events, c.coilIndex, 'ontime'), duty: curvePoints(events, c.coilIndex, 'duty') }));

  const steps = Math.max(1, Math.ceil(analysis.durationMs / stepMs) + 1);
  const tracks: CoilTrack[] = coils.map((c) => ({
    coilIndex: c.coilIndex,
    dutyAsked: new Float32Array(steps),
    duty: new Float32Array(steps),
    factor: new Float32Array(steps).fill(1),
    pulseUs: new Float32Array(steps),
    askedUs: new Float32Array(steps),
    skipped: new Uint8Array(steps),
    firstCuts: [],
  }));
  const fates = coils.map((_, k) => {
    const byNote = new Map<number, NoteFate>();
    for (const i of order) if (vols[i][k]) byNote.set(i, { index: i, note: notes[i], minFactor: 1, cuts: [] });
    return byNote;
  });

  const core = new BoardCore();
  let next = 0;
  let active: number[] = []; // oldest first
  for (let s = 0; s < steps; s++) {
    const t = s * stepMs;
    while (next < order.length && notes[order[next]].startMs <= t) active.push(order[next++]);
    active = active.filter((i) => {
      if (holdEnd[i] > t) return true;
      core.forget(i);
      return false;
    });
    // velocity × the file's volume × the envelope: the same on every coil
    const held: BoardNote[] = active.map((i) => {
      const n = notes[i];
      const released = t >= n.endMs ? n.endMs - n.startMs : null;
      const level = (n.velocity / 127) * n.volume * envelopeAmplitude(program(n.channel), t - n.startMs, released);
      return { id: i, hz: hz[i], level, vols: vols[i] };
    });
    const song = curveAt(songCurve, t);
    // what the player sends each coil at this moment (MidiPlayer: coilLevelAt)
    const board: BoardCoil[] = coils.map((c, k) => {
      const p = (power?.(c.coilIndex) ?? 100) / 100;
      return {
        drive: {
          ontimeUs: Math.round(c.ontimeUs * song * curveAt(curves[k].on, t) * p),
          duty: Math.min(1, c.duty * song * curveAt(curves[k].duty, t) * p),
        },
        limits: limits[c.coilIndex] ?? null,
      };
    });
    core.step(held, board).forEach((step, k) => {
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
        if (t < notes[i].endMs) cut(fates[k].get(i)!, t, stepMs, tr);
      }
      step.fired.forEach((j, m) => {
        const i = active[j];
        if (t < notes[i].endMs && l.pulsesUs[m] > 0) {
          const f = fates[k].get(i)!;
          f.minFactor = Math.min(f.minFactor, l.factor);
        }
      });
    });
  }
  tracks.forEach((tr) => tr.firstCuts.sort((a, b) => a - b));
  return { stepMs, durationMs: analysis.durationMs, tracks, fates: fates.map((m) => [...m.values()]) };
}

function cut(f: NoteFate, t: number, stepMs: number, track: CoilTrack): void {
  const last = f.cuts[f.cuts.length - 1];
  if (last && Math.abs(last[1] - t) < 1e-6) last[1] = t + stepMs;
  else {
    if (!f.cuts.length) track.firstCuts.push(t);
    f.cuts.push([t, t + stepMs]);
  }
}

/** The step of a track at `ms`. */
export function stepAt(sim: Simulation, ms: number): number {
  const last = sim.tracks[0]?.duty.length ?? 1;
  return Math.max(0, Math.min(last - 1, Math.floor(ms / sim.stepMs)));
}

/** How many of a coil's notes were silenced for lack of a voice up to `ms`. */
export function cutsSoFar(track: CoilTrack, ms: number): number {
  let lo = 0;
  let hi = track.firstCuts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (track.firstCuts[mid] <= ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export type FateKind = 'cut' | 'reduced' | 'ok';
/** A moment of the song a view points at (a note's start), and how that note fared. */
export type LoadMark = [number, FateKind];

/** How a note fared: cut for lack of a voice, reduced by the max duty, or untouched. */
export function fateKind(f: NoteFate): FateKind {
  if (f.cuts.length) return 'cut';
  return f.minFactor < 0.995 ? 'reduced' : 'ok';
}

/** A key held in Live mode. */
export interface HeldKey {
  note: number;
  channel: number;
  velocity: number;
}

/**
 * Live mode: by how much a coil's limits reduce the keys held right now (0..1,
 * 0 when they don't), the oldest first in `held`. The voices count every key held,
 * as the board's do; the envelope and the controller's CC7 are left out.
 */
export function heldReduction(held: readonly HeldKey[], coil: CoilConfig, limits: CoilLimits | null): number {
  const notes = held.map((k, id) => ({
    id, hz: noteFrequency(k.note), level: k.velocity / 127, vols: [coil.channelMask & (1 << k.channel) ? 1 : 0],
  }));
  const [step] = new BoardCore().step(notes, [{ drive: { ontimeUs: coil.ontimeUs, duty: coil.duty }, limits }]);
  return 1 - step.limited.factor;
}
