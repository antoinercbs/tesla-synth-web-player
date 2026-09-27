/** µs per beat (120 BPM) until a setTempo appears. */
export const DEFAULT_TEMPO = 500000;

export interface TempoMap {
  toMs(tick: number): number;
  toTick(ms: number): number;
}

/** Tick ↔ ms through the tempo changes (tick-stamped, any order). */
export function tempoMap(tempos: { tick: number; us: number }[], ticksPerBeat: number): TempoMap {
  const points = [...tempos].sort((a, b) => a.tick - b.tick);
  if (points.length === 0 || points[0].tick > 0) points.unshift({ tick: 0, us: DEFAULT_TEMPO });
  // cumulative ms at the start of each tempo segment
  const cum: { tick: number; ms: number; us: number }[] = [];
  let ms = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) ms += ((points[i].tick - points[i - 1].tick) * points[i - 1].us) / ticksPerBeat / 1000;
    cum.push({ tick: points[i].tick, ms, us: points[i].us });
  }
  return {
    toMs(tick) {
      let seg = cum[0];
      for (const c of cum) {
        if (c.tick <= tick) seg = c;
        else break;
      }
      return seg.ms + ((tick - seg.tick) * seg.us) / ticksPerBeat / 1000;
    },
    toTick(at) {
      let seg = cum[0];
      for (const c of cum) {
        if (c.ms <= at) seg = c;
        else break;
      }
      return seg.tick + ((at - seg.ms) * 1000 * ticksPerBeat) / seg.us;
    },
  };
}
