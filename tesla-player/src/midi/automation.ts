import { SONG_WIDE, type AutomationParam, type CoilConfig, type CoilEvent, type CoilParam } from "@/types/domain";

/**
 * A song's power automation. Each curve (the song's power, or one coil's
 * ontime or duty) is a list of points: a step holds its level until the next
 * point, a ramp point is reached linearly from the previous one. A coil gets
 * its configured value × the song's power × its own curve (× the player's live
 * power, applied by the player).
 */

/** The automation's ceiling; the device caps at the coil limits anyway. */
export const MAX_RATIO = 2;
/** How finely a ramp is drawn. */
const RAMP_SAMPLE_MS = 100;

/** One curve's points, in time order. */
export function curvePoints(events: readonly CoilEvent[], coilIndex: number, param: AutomationParam): CoilEvent[] {
  return events.filter((e) => e.coilIndex === coilIndex && e.param === param).sort((a, b) => a.atMs - b.atMs);
}

/** A curve's level at `atMs`: 100% before its first point (a first ramp starts
 *  from 100% at 0), the last point at the same time winning. */
export function curveAt(points: readonly CoilEvent[], atMs: number): number {
  let prevT = 0;
  let prevV = 1;
  for (const p of points) {
    if (p.atMs > atMs) {
      if (p.ramp && p.atMs > prevT) return prevV + ((p.value - prevV) * (atMs - prevT)) / (p.atMs - prevT);
      return prevV;
    }
    prevT = p.atMs;
    prevV = p.value;
  }
  return prevV;
}

/**
 * The ratio (multiplier of the coil's configured value, 1 = 100%) in effect for
 * a coil's ontime or duty at `atMs`: the song's power × the coil's own curve.
 */
export function effectiveRatio(
  events: readonly CoilEvent[],
  coilIndex: number,
  param: CoilParam,
  atMs: number,
): number {
  return curveAt(curvePoints(events, SONG_WIDE, "power"), atMs) * curveAt(curvePoints(events, coilIndex, param), atMs);
}

/**
 * [time, ratio] vertices of a curve for drawing: a step is a vertical jump,
 * ramps are sampled (the product of two ramps is not a straight line). With
 * `coilIndex` = SONG_WIDE, the song's power alone.
 */
export function levelSamples(
  events: readonly CoilEvent[],
  coilIndex: number,
  param: AutomationParam,
  durationMs: number,
): [number, number][] {
  const song = curvePoints(events, SONG_WIDE, "power");
  const own = coilIndex === SONG_WIDE ? [] : curvePoints(events, coilIndex, param);
  const at = (t: number): number => curveAt(song, t) * (coilIndex === SONG_WIDE ? 1 : curveAt(own, t));
  const times = new Set<number>([0, durationMs]);
  for (const points of [song, own]) {
    let prev = 0;
    for (const p of points) {
      times.add(p.atMs);
      if (p.ramp) for (let t = prev + RAMP_SAMPLE_MS; t < p.atMs; t += RAMP_SAMPLE_MS) times.add(t);
      prev = p.atMs;
    }
  }
  const out: [number, number][] = [];
  for (const t of [...times].filter((t) => t >= 0 && t <= durationMs).sort((a, b) => a - b)) {
    const before = t > 0 ? at(t - 0.001) : at(0);
    const after = at(t);
    // a jump, not the slope of a ramp over that thousandth of a millisecond
    if (Math.abs(before - after) > 1e-4) out.push([t, before]);
    out.push([t, after]);
  }
  return out;
}

/** Where a point dropped at `ms` lands: the nearest beat, or the nearest
 *  100 ms when the file has no tempo map to go by. */
export function snapToBeat(beats: readonly number[], ms: number): number {
  if (!beats.length) return Math.round(ms / 100) * 100;
  let lo = 0;
  let hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] < ms) lo = mid + 1;
    else hi = mid;
  }
  return Math.round(lo > 0 && ms - beats[lo - 1] < beats[lo] - ms ? beats[lo - 1] : beats[lo]);
}

/** What a coil is sent at `atMs`: its configured values × the automation × the
 *  player's live power (percent, one for each parameter). */
export function coilLevelAt(
  events: readonly CoilEvent[],
  coil: CoilConfig,
  atMs: number,
  liveOntimePct: number,
  liveDutyPct: number,
): { ontimeUs: number; duty: number } {
  return {
    ontimeUs: Math.round((coil.ontimeUs * effectiveRatio(events, coil.coilIndex, "ontime", atMs) * liveOntimePct) / 100),
    duty: Math.min(1, (coil.duty * effectiveRatio(events, coil.coilIndex, "duty", atMs) * liveDutyPct) / 100),
  };
}
