import type { CoilEvent, CoilParam } from '@/types/domain';

/**
 * The ratio (multiplier of the coil's configured value, 1 = 100%) in effect for
 * a coil+param at time `atMs`. Step/hold semantics: the last event at or before
 * `atMs` wins; 100% before the first event.
 */
export function effectiveRatio(
  events: CoilEvent[],
  coilIndex: number,
  param: CoilParam,
  atMs: number,
): number {
  let ratio = 1;
  let bestAt = -1;
  for (const e of events) {
    if (e.coilIndex !== coilIndex || e.param !== param) continue;
    if (e.atMs <= atMs && e.atMs > bestAt) { bestAt = e.atMs; ratio = e.value; }
  }
  return ratio;
}
