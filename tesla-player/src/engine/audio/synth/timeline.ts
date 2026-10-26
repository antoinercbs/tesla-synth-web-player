import { EPS } from './constants';

interface Stamped {
  when: number;
  v: number;
}

/** A value along the audio clock: what a controller or a coil setting is at any moment. */
export class SndTimeline {
  private points: Stamped[] = [];
  constructor(private readonly initial: number) {}

  set(when: number, v: number): void {
    let i = this.points.length;
    while (i > 0 && this.points[i - 1].when > when) i--;
    this.points.splice(i, 0, { when, v });
  }

  at(t: number): number {
    for (let i = this.points.length - 1; i >= 0; i--) if (this.points[i].when <= t + EPS) return this.points[i].v;
    return this.initial;
  }

  /** Forget what came before `t`, keeping the value it left. */
  prune(t: number): void {
    let i = 0;
    while (i + 1 < this.points.length && this.points[i + 1].when <= t) i++;
    if (i > 0) this.points.splice(0, i);
  }
}
