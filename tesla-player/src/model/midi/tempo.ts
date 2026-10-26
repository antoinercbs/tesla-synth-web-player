/** Tick ↔ ms through a file's tempo changes (tick-stamped, any order). */
export class MidTempo {
  /** µs per beat (120 BPM) until a setTempo appears. */
  static readonly DEFAULT = 500000;
  // cumulative ms at the start of each tempo segment
  private readonly cum: { tick: number; ms: number; us: number }[] = [];

  constructor(tempos: readonly { tick: number; us: number }[], private readonly ticksPerBeat: number) {
    const points = [...tempos].sort((a, b) => a.tick - b.tick);
    if (points.length === 0 || points[0].tick > 0) points.unshift({ tick: 0, us: MidTempo.DEFAULT });
    let ms = 0;
    for (let i = 0; i < points.length; i++) {
      if (i > 0) ms += ((points[i].tick - points[i - 1].tick) * points[i - 1].us) / ticksPerBeat / 1000;
      this.cum.push({ tick: points[i].tick, ms, us: points[i].us });
    }
  }

  toMs(tick: number): number {
    let seg = this.cum[0];
    for (const c of this.cum) {
      if (c.tick <= tick) seg = c;
      else break;
    }
    return seg.ms + ((tick - seg.tick) * seg.us) / this.ticksPerBeat / 1000;
  }

  toTick(at: number): number {
    let seg = this.cum[0];
    for (const c of this.cum) {
      if (c.ms <= at) seg = c;
      else break;
    }
    return seg.tick + ((at - seg.ms) * 1000 * this.ticksPerBeat) / seg.us;
  }
}
