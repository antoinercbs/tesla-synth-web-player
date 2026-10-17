import type { CoilLimits } from '@/devices/coil-limits';
import { capUs, effectiveOntimeUs, requestedOntimeUs, type CoilDrive } from '@/devices/ontime-model';
import { pulseLevel } from '@/audio/tesla-impulse';
import { ROLE_WEIGHT, weightedQuantile, type ChannelProfile, type ChannelRole } from './roles';

/**
 * The Assistant's numbers: which channels each coil plays, and each coil's
 * ontime and duty, from the song's notes and the coils' limits. Pure and
 * plain-data in and out, so it runs in a worker (calib.worker.ts).
 *
 * Two intentions. Clean: every note in its place, none stuck at the max ontime
 * (where velocity and nuance stop counting) and few shrunk by the max duty the
 * notes share; the coil's colour is where its crossover sits among its notes.
 * Loud: the longest arcs, the max ontime on every note, the board holding the
 * duty at its max when it saturates. What it finds is only numbers: the song
 * stores them like any setting made by hand.
 *
 * The demand of a coil along the song is counted in BIN_MS bins: each note adds
 * the duty it asks for to every bin it sounds in (its envelope's release
 * included). The board limits the notes sounding together at each instant;
 * bins keep the searches fast, and the real simulation (devices/coil-sim.ts)
 * judges the result.
 */

export const BIN_MS = 50;
export type Limits = Required<CoilLimits>;
/** Where the board's own protection trips (DeviceProfile.hardwareLimits). */
export interface HwLimits { ontimeUs: number; duty: number }

/** A note as the searches take it. `endMs` includes its envelope's release. */
export interface CalibNote { ch: number; hz: number; lvl: number; startMs: number; endMs: number; durMs: number }

export interface CalibRequest {
  durationMs: number;
  notes: CalibNote[];
  profiles: ChannelProfile[];
  coilCount: number;
  /** By coil index. */
  limits: Limits[];
  hw: HwLimits | null;
  /** The routing to keep (one mask per coil); absent: the Assistant routes. */
  masks?: number[];
  /**
   * A role per coil, by coil index (null: the Assistant's choice): such a coil
   * plays the channels of that role, and other lines only when they would
   * otherwise go unheard. A role no channel has leaves the coil to the Assistant.
   */
  coilRoles?: (ChannelRole | null)[];
}

// what a line costs on a coil given another role: less than leaving a line unheard
const FOREIGN_LINE = 8;

/** The channels each coil must play, by coil index (0: free), from the roles given to the coils. */
export function forcedMasks(profiles: readonly ChannelProfile[], coilRoles: readonly (ChannelRole | null)[] | undefined, coilCount: number): number[] {
  return Array.from({ length: coilCount }, (_, k) => {
    const role = coilRoles?.[k];
    return role ? profiles.filter((c) => c.role === role).reduce((m, c) => m | (1 << c.ch), 0) : 0;
  });
}

/** One spot of a coil's pad: the setting it gives, and what that does to the coil's notes. */
export interface PadCell {
  /** Ontime (µs) and duty (fraction) to store. */
  o: number;
  d: number;
  /** Duration-weighted mean level of its notes (dB, see coilLevel) and their spread. */
  level: number;
  spread: number;
  /** Share of its notes' time asking past the max ontime: stuck there, velocity lost. */
  capped: number;
  /** Share of its sounding time asking past the max duty: the board shrinks the notes. */
  busy: number;
}

export interface IntentionPlan {
  masks: number[];
  /** By coil: rows (y axis, bottom to top) of cells (x axis); null for a coil with no channel. */
  pads: (PadCell[][] | null)[];
  /** By coil: the spot the Assistant would pick. */
  pick: { y: number; x: number }[];
}

export interface CalibResult { clean: IntentionPlan; loud: IntentionPlan }

/** Clean pad: power (y) × crossover (x: 0 above the notes, the bass on the duty; 1 below them, all on the ontime). */
export const CLEAN_POWER = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
export const CLEAN_TILT = [0, 0.25, 0.5, 0.75, 1];
/** Loud pad: arc length, a share of the max ontime (y) × load, a share of the max duty (x). */
export const LOUD_SHARE = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
export const LOUD_LOAD = [0.4, 0.55, 0.7, 0.85, 1];
const DEFAULT_POWER = 0.8;

// the board's protection, kept at a distance
const HW_MARGIN = 0.9;

/* ----------------------------------------------------------- a coil's notes */

interface CoilNotes {
  n: number;
  hz: Float64Array;
  lvl: Float64Array;
  b0: Int32Array;
  b1: Int32Array;
  w: Float64Array;
  /** The register its crossover moves in (Hz). */
  fLo: number;
  fHi: number;
}

function binsOf(durationMs: number): number {
  return Math.ceil(durationMs / BIN_MS) + 2;
}

function coilNotes(notes: readonly CalibNote[], mask: number, bins: number): CoilNotes | null {
  const mine = notes.filter((n) => mask & (1 << n.ch));
  if (!mine.length) return null;
  const n = mine.length;
  const cn: CoilNotes = {
    n, hz: new Float64Array(n), lvl: new Float64Array(n), b0: new Int32Array(n), b1: new Int32Array(n), w: new Float64Array(n), fLo: 0, fHi: 0,
  };
  mine.forEach((x, i) => {
    cn.hz[i] = x.hz;
    cn.lvl[i] = x.lvl;
    cn.b0[i] = Math.min(bins - 2, Math.floor(x.startMs / BIN_MS));
    cn.b1[i] = Math.min(bins - 2, Math.floor(x.endMs / BIN_MS));
    cn.w[i] = Math.max(1, x.durMs);
  });
  const logs = mine.map((x) => Math.log(x.hz));
  const w = Array.from(cn.w);
  cn.fLo = Math.exp(weightedQuantile(logs, w, 0.02)) / 1.03;
  cn.fHi = Math.exp(weightedQuantile(logs, w, 0.98)) * 1.03;
  return cn;
}

/* ------------------------------------------------------------- the demand */

/** Scratch buffers, reused across a request's many demand curves. */
class Scratch {
  diff: Float64Array;
  vals: Float64Array;
  constructor(bins: number) {
    this.diff = new Float64Array(bins + 1);
    this.vals = new Float64Array(bins);
  }
}

/** The duty the coil's notes ask for together in each bin; returns how many bins sound. */
function demand(cn: CoilNotes, drive: CoilDrive, lim: Limits, s: Scratch): number {
  const diff = s.diff;
  diff.fill(0);
  const cap = capUs(lim) ?? Infinity;
  const minOn = lim.minOntimeUs ?? 0;
  for (let i = 0; i < cn.n; i++) {
    const us = Math.min(requestedOntimeUs(drive, cn.hz[i], cn.lvl[i]), cap);
    if (us < 1) continue;
    const d = ((us + minOn) * cn.hz[i]) / 1e6;
    diff[cn.b0[i]] += d;
    diff[cn.b1[i] + 1] -= d;
  }
  let acc = 0, k = 0;
  for (let b = 0; b < s.vals.length; b++) {
    acc += diff[b];
    if (acc > 1e-12) s.vals[k++] = acc;
  }
  return k;
}

/** The q-quantile of the first `count` values (quickselect, reorders them). */
function quantile(vals: Float64Array, count: number, q: number): number {
  if (!count) return 0;
  const target = Math.min(count - 1, Math.floor(q * count));
  let lo = 0, hi = count - 1;
  while (lo < hi) {
    const pivot = vals[(lo + hi) >> 1];
    let i = lo, j = hi;
    while (i <= j) {
      while (vals[i] < pivot) i++;
      while (vals[j] > pivot) j--;
      if (i <= j) { const t = vals[i]; vals[i] = vals[j]; vals[j] = t; i++; j--; }
    }
    if (target <= j) hi = j;
    else if (target >= i) lo = i;
    else return vals[target];
  }
  return vals[target];
}

/* ------------------------------------------------------------ judging a drive */

/**
 * A note's level as heard: its lone pulse through the synth's level law and the
 * rate's √f, in dB (−60 for a silent one). Used to compare coils and settings,
 * not as a sound pressure.
 */
function noteLevel(drive: CoilDrive, hz: number, lim: Limits, lvl: number): number {
  const p = effectiveOntimeUs(drive, hz, lim, lvl);
  return p > 0 ? 20 * Math.log10(pulseLevel(p, hz)) + 10 * Math.log10(hz / 440) : -60;
}

function assess(cn: CoilNotes, drive: CoilDrive, lim: Limits, s: Scratch): Omit<PadCell, 'o' | 'd'> {
  const cap = capUs(lim) ?? Infinity;
  let W = 0, sum = 0, capped = 0;
  const ls = new Float64Array(cn.n);
  for (let i = 0; i < cn.n; i++) {
    ls[i] = noteLevel(drive, cn.hz[i], lim, cn.lvl[i]);
    W += cn.w[i];
    sum += ls[i] * cn.w[i];
    if (requestedOntimeUs(drive, cn.hz[i], cn.lvl[i]) > cap) capped += cn.w[i];
  }
  const mean = sum / W;
  let v = 0;
  for (let i = 0; i < cn.n; i++) v += (ls[i] - mean) ** 2 * cn.w[i];
  const count = demand(cn, drive, lim, s);
  let over = 0;
  for (let b = 0; b < count; b++) if (s.vals[b] > lim.duty + 1e-9) over++;
  return { level: mean, spread: Math.sqrt(v / W), capped: capped / W, busy: count ? over / count : 0 };
}

const round = (drive: CoilDrive): CoilDrive => ({ ontimeUs: Math.max(1, Math.round(drive.ontimeUs)), duty: Math.round(drive.duty * 1e4) / 1e4 });

/* -------------------------------------------------------- clean: one coil */

function maxOntime(lim: Limits, hw: HwLimits | null): number {
  return Math.min(hw ? hw.ontimeUs * HW_MARGIN : Infinity, lim.ontimeUs);
}
function maxDuty(lim: Limits, hw: HwLimits | null): number {
  return Math.min(hw ? hw.duty * HW_MARGIN : Infinity, lim.duty);
}

/**
 * The clean drive at `power` (a share of the coil) with its crossover at `tilt`
 * in its register: the largest ontime (the duty following, the crossover held)
 * whose demand stays under the coil's max duty `q` of the time.
 */
function cleanDrive(cn: CoilNotes, lim: Limits, hw: HwLimits | null, power: number, tilt: number, q: number, s: Scratch): CoilDrive {
  const fb = Math.exp(Math.log(cn.fHi) + tilt * (Math.log(cn.fLo) - Math.log(cn.fHi)));
  const budget = power * lim.duty;
  const driveOf = (o: number): CoilDrive => ({ ontimeUs: o, duty: Math.min(power * maxDuty(lim, hw), (o * fb) / 1e6) });
  let lo = 1, hi = Math.max(1, power * maxOntime(lim, hw));
  for (let k = 0; k < 18; k++) {
    const mid = (lo + hi) / 2;
    const count = demand(cn, driveOf(mid), lim, s);
    if (quantile(s.vals, count, q) <= budget) lo = mid;
    else hi = mid;
  }
  return round(driveOf(lo));
}

interface Fit { drive: CoilDrive; tilt: number; cell: Omit<PadCell, 'o' | 'd'> }

/** The crossover that keeps the coil's notes the most even, a little loudness traded for it. */
function bestClean(cn: CoilNotes, lim: Limits, hw: HwLimits | null, q: number, s: Scratch): Fit {
  let best: (Fit & { score: number }) | null = null;
  for (const tilt of CLEAN_TILT) {
    const drive = cleanDrive(cn, lim, hw, DEFAULT_POWER, tilt, q, s);
    const cell = assess(cn, drive, lim, s);
    const score = cell.spread - 0.25 * cell.level + 6 * cell.capped;
    if (!best || score < best.score) best = { drive, tilt, cell, score };
  }
  return best!;
}

function loudDrive(lim: Limits, hw: HwLimits | null, share: number, load: number): CoilDrive {
  return round({ ontimeUs: share * maxOntime(lim, hw), duty: load * maxDuty(lim, hw) });
}

/* ---------------------------------------------------------------- routing */

interface Setup { level: number; spread: number }

/**
 * Channels onto coils: louder and more even lines, each coil on a tight
 * register and within its voices, every line heard; then a line doubled on
 * another coil while it helps. Every routing when they are few, else a greedy
 * start improved by moves and swaps.
 */
function route(req: CalibRequest, setupOf: (k: number, mask: number) => Setup | null): number[] {
  const all = req.profiles;
  const N = req.coilCount;
  if (!all.length) return new Array(N).fill(0);
  // a coil given a role plays its channels: they are placed, the search places the others
  const forced = forcedMasks(all, req.coilRoles, N);
  const pinned = forced.reduce((m, f) => m | f, 0);
  const chans = all.filter((c) => !(pinned & (1 << c.ch)));
  const K = chans.length;
  const autoN = forced.filter((f) => !f).length;
  const evaluate = (masks: number[], partial = false): number | null => {
    if (!partial && K >= autoN && masks.some((m, k) => !forced[k] && !m)) return null;
    let cost = 0;
    masks.forEach((m, k) => {
      const cs = all.filter((c) => m & (1 << c.ch));
      if (!cs.length) return;
      const lo = Math.min(...cs.map((c) => c.lo)), hi = Math.max(...cs.map((c) => c.hi));
      const poly = cs.reduce((t, c) => t + c.maxPoly, 0);
      // each more line on a coil blurs the lines apart
      cost += (hi - lo) / 12 + Math.max(0, poly - req.limits[k].voices) * 2 + (cs.length - 1) * 2;
      if (forced[k]) cost += FOREIGN_LINE * cs.filter((c) => !(forced[k] & (1 << c.ch))).length;
    });
    const setups = masks.map((m, k) => (m ? setupOf(k, m) : null));
    let level = 0;
    for (const c of all) {
      let power = 0;
      setups.forEach((st, k) => { if (st && masks[k] & (1 << c.ch)) power += 10 ** (st.level / 10); });
      if (power) level += ROLE_WEIGHT[c.role] * 10 * Math.log10(power);
      else if (!partial) level -= 30 * ROLE_WEIGHT[c.role];
    }
    level -= setups.reduce((t, st) => t + (st ? st.spread * 0.5 : 0), 0);
    return level - cost;
  };
  const masksOf = (assign: number[]): number[] => {
    const masks = [...forced];
    assign.forEach((k, i) => { if (k >= 0) masks[k] |= 1 << chans[i].ch; });
    return masks;
  };
  let best: { assign: number[]; masks: number[]; score: number } | null = null;
  if (N ** K <= 3000) {
    for (let code = 0; code < N ** K; code++) {
      const assign: number[] = [];
      for (let i = 0, x = code; i < K; i++, x = Math.floor(x / N)) assign.push(x % N);
      const masks = masksOf(assign);
      const score = evaluate(masks);
      if (score != null && (!best || score > best.score)) best = { assign, masks, score };
    }
  } else {
    const order = chans.map((_, i) => i).sort((i, j) => chans[j].count - chans[i].count);
    const assign = new Array(K).fill(-1);
    order.forEach((i, n) => {
      let pick = 0, top = -Infinity;
      for (let k = 0; k < N; k++) {
        // the busiest channels first, one per coil while some stay empty
        if (n < N && assign.includes(k)) continue;
        assign[i] = k;
        const score = evaluate(masksOf(assign), true) ?? -Infinity;
        if (score > top) { top = score; pick = k; }
      }
      assign[i] = pick;
    });
    best = { assign: [...assign], masks: masksOf(assign), score: evaluate(masksOf(assign)) ?? -Infinity };
    for (let round = 0, better = true; better && round < 40; round++) {
      better = false;
      for (let i = 0; i < K; i++) {
        for (let k = 0; k < N; k++) {
          if (best.assign[i] === k) continue;
          const moved: number[] = [...best.assign];
          moved[i] = k;
          const score = evaluate(masksOf(moved));
          if (score != null && score > best.score + 1e-6) { best = { assign: moved, masks: masksOf(moved), score }; better = true; }
        }
        for (let j = i + 1; j < K; j++) {
          if (best.assign[i] === best.assign[j]) continue;
          const swapped: number[] = [...best.assign];
          [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
          const score = evaluate(masksOf(swapped));
          if (score != null && score > best.score + 1e-6) { best = { assign: swapped, masks: masksOf(swapped), score }; better = true; }
        }
      }
    }
  }
  if (!best) return new Array(N).fill(0);
  // doubling: a line onto another coil too, the weightiest first, while it clearly helps
  const byWeight = [...all].sort((x, y) => ROLE_WEIGHT[y.role] - ROLE_WEIGHT[x.role]);
  for (let round = 0, better = true; better && round < 6; round++) {
    better = false;
    for (const c of byWeight) {
      for (let k = 0; k < N && !better; k++) {
        if (best.masks[k] & (1 << c.ch)) continue;
        const masks: number[] = [...best.masks];
        masks[k] |= 1 << c.ch;
        const score = evaluate(masks);
        if (score != null && score > best.score + 0.5) { best = { ...best, masks, score }; better = true; }
      }
      if (better) break;
    }
  }
  // a coil left idle on stage plays the line it adds most to, the weightiest first
  for (let k = 0; k < N; k++) {
    if (best.masks[k]) continue;
    let pick: { masks: number[]; score: number } | null = null;
    for (const c of byWeight) {
      const masks: number[] = [...best.masks];
      masks[k] |= 1 << c.ch;
      const score = evaluate(masks);
      if (score != null && (!pick || score > pick.score)) pick = { masks, score };
    }
    if (pick) best = { ...best, ...pick };
  }
  return best.masks;
}

/* ---------------------------------------------------------------- the song */

export function toCalibNotes(
  notes: readonly { channel: number; note: number; startMs: number; endMs: number; velocity: number; volume: number }[],
  hzOf: (note: number) => number,
  releaseMs: (ch: number) => number,
): CalibNote[] {
  return notes.map((n) => ({
    ch: n.channel, hz: hzOf(n.note), lvl: (n.velocity / 127) * n.volume,
    startMs: n.startMs, endMs: n.endMs + releaseMs(n.channel), durMs: n.endMs - n.startMs,
  }));
}

export function calibrateSong(req: CalibRequest): CalibResult {
  const bins = binsOf(req.durationMs);
  const s = new Scratch(bins);
  const melody = req.profiles.find((c) => c.role === 'melody')?.ch ?? -1;
  // the melody's coil may only rarely be shrunk
  const qOf = (mask: number): number => (mask & (1 << melody) ? 0.99 : 0.97);
  const notesCache = new Map<number, CoilNotes | null>();
  const notesOf = (mask: number): CoilNotes | null => {
    if (!notesCache.has(mask)) notesCache.set(mask, coilNotes(req.notes, mask, bins));
    return notesCache.get(mask)!;
  };
  // coils with the same limits share their fits
  const limKey = (k: number): string => JSON.stringify(req.limits[k]);
  const cleanFits = new Map<string, Fit | null>();
  const cleanFit = (k: number, mask: number): Fit | null => {
    const key = `${limKey(k)}|${mask}`;
    if (!cleanFits.has(key)) {
      const cn = notesOf(mask);
      cleanFits.set(key, cn ? bestClean(cn, req.limits[k], req.hw, qOf(mask), s) : null);
    }
    return cleanFits.get(key)!;
  };
  const loudFits = new Map<string, Setup | null>();
  const loudFit = (k: number, mask: number): Setup | null => {
    const key = `${limKey(k)}|${mask}`;
    if (!loudFits.has(key)) {
      const cn = notesOf(mask);
      loudFits.set(key, cn ? assess(cn, loudDrive(req.limits[k], req.hw, 1, 1), req.limits[k], s) : null);
    }
    return loudFits.get(key)!;
  };

  const cleanMasks = req.masks ?? route(req, (k, m) => cleanFit(k, m)?.cell ?? null);
  const loudMasks = req.masks ?? route(req, loudFit);

  const clean: IntentionPlan = { masks: cleanMasks, pads: [], pick: [] };
  cleanMasks.forEach((mask, k) => {
    const cn = mask ? notesOf(mask) : null;
    const lim = req.limits[k];
    if (!cn) { clean.pads.push(null); clean.pick.push({ y: CLEAN_POWER.indexOf(DEFAULT_POWER), x: 2 }); return; }
    const q = qOf(mask);
    clean.pads.push(CLEAN_POWER.map((p) => CLEAN_TILT.map((t) => {
      const drive = cleanDrive(cn, lim, req.hw, p, t, q, s);
      return { o: drive.ontimeUs, d: drive.duty, ...assess(cn, drive, lim, s) };
    })));
    clean.pick.push({ y: CLEAN_POWER.indexOf(DEFAULT_POWER), x: CLEAN_TILT.indexOf(cleanFit(k, mask)!.tilt) });
  });

  const loud: IntentionPlan = { masks: loudMasks, pads: [], pick: [] };
  loudMasks.forEach((mask, k) => {
    const cn = mask ? notesOf(mask) : null;
    const lim = req.limits[k];
    loud.pick.push({ y: LOUD_SHARE.length - 1, x: LOUD_LOAD.length - 1 });
    if (!cn) { loud.pads.push(null); return; }
    loud.pads.push(LOUD_SHARE.map((share) => LOUD_LOAD.map((load) => {
      const drive = loudDrive(lim, req.hw, share, load);
      return { o: drive.ontimeUs, d: drive.duty, ...assess(cn, drive, lim, s) };
    })));
  });
  return { clean, loud };
}

/** How a setting treats each coil's notes, by the same measures as the pads (a coil with no channel: null). */
export function assessSetting(
  req: Pick<CalibRequest, 'durationMs' | 'notes' | 'limits'>,
  coils: readonly { channelMask: number; ontimeUs: number; duty: number }[],
): (Omit<PadCell, 'o' | 'd'> | null)[] {
  const bins = binsOf(req.durationMs);
  const s = new Scratch(bins);
  return coils.map((c, k) => {
    const cn = c.channelMask ? coilNotes(req.notes, c.channelMask, bins) : null;
    return cn ? assess(cn, { ontimeUs: c.ontimeUs, duty: c.duty }, req.limits[k], s) : null;
  });
}

/** The loudness of coils heard together (dB), from each one's level. */
export function combinedLevel(levels: readonly number[]): number {
  const sum = levels.reduce((t, l) => t + 10 ** (l / 10), 0);
  return sum > 0 ? 10 * Math.log10(sum) : -60;
}
