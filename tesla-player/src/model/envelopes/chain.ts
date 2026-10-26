import { SndEnvPrograms, type EnvStep } from '@/model/sysex/envelopes';

/** Where a step's handle sits on the held-note curve: it reaches `amp` at `t`. */
export interface ChainPoint {
  step: number;
  t: number;
  amp: number;
}

export type StepRole = 'attack' | 'decay' | 'sustain' | 'loop' | 'unused' | 'release';

/**
 * The first pass over the steps from note-on, as the firmware plays them while
 * the note is held: 0 → next → … until a step repeats (sustain on itself, or a
 * loop back) or the chain jumps to the release.
 */
export class SndChain {
  readonly points: ChainPoint[] = [];
  /** The step that holds until note-off, when the chain ends on a self-loop. */
  readonly sustain: number | null = null;
  /** The step the chain jumps back to, when it loops. */
  readonly loopTo: number | null = null;
  readonly loopSteps = new Set<number>();
  /** Steps a held note ever plays (the release always counts). */
  readonly reachable: Set<number>;

  constructor(steps: readonly EnvStep[]) {
    const points = this.points;
    const seenAt = new Map<number, number>();
    let cur = 0;
    let t = 0;
    while (cur !== SndEnvPrograms.RELEASE_STEP && !seenAt.has(cur)) {
      seenAt.set(cur, points.length);
      t += Math.max(0, steps[cur].durMs);
      points.push({ step: cur, t, amp: steps[cur].amp });
      const next = steps[cur].next;
      if (next === cur) {
        this.sustain = cur;
        break;
      }
      if (seenAt.has(next)) {
        this.loopTo = next;
        break;
      }
      cur = next;
    }
    if (this.loopTo != null) for (let i = seenAt.get(this.loopTo)!; i < points.length; i++) this.loopSteps.add(points[i].step);
    this.reachable = new Set(points.map((p) => p.step));
    this.reachable.add(SndEnvPrograms.RELEASE_STEP);
  }

  /** What a step does; a replayed or held first step is named for that, not as the attack. */
  role(step: number): StepRole {
    if (step === SndEnvPrograms.RELEASE_STEP) return 'release';
    if (!this.reachable.has(step)) return 'unused';
    if (this.loopSteps.has(step)) return 'loop';
    if (this.sustain === step) return 'sustain';
    if (step === 0) return 'attack';
    return 'decay';
  }
}
