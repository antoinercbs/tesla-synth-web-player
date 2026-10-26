import { SndEnvPrograms, type EnvStep } from '@/model/sysex/envelopes';
import { SndChain } from './chain';
import { SndEnvShape, type EnvShape, type HeldEnd } from './shape';

/** An envelope's steps, as the firmware plays them and a song or the library stores them. */
export class SndEnvelope {
  constructor(readonly steps: readonly EnvStep[]) {}

  /** A program's envelope: the firmware's, or the library's. */
  static of(program: number): SndEnvelope {
    return new SndEnvelope(SndEnvPrograms.steps(program));
  }

  /** Amplitude within one step at fraction `frac` (0..1) of its duration: n-tau RC curve, linear at ntau≈0. */
  static stepAmp(start: number, target: number, ntau: number, frac: number): number {
    const f = frac < 0 ? 0 : frac > 1 ? 1 : frac;
    if (Math.abs(ntau) < 1e-6) return start + (target - start) * f;
    return start + (target - start) * (Math.expm1(-ntau * f) / Math.expm1(-ntau));
  }

  /** What a new envelope starts from: the firmware's piano (P1). */
  static starter(): EnvStep[] {
    return new SndEnvelope(SndEnvPrograms.steps(1)).normalized();
  }

  /** The first library program not `taken`; null: none left. */
  static freeProgram(taken: Iterable<number>): number | null {
    const used = new Set(taken);
    for (let p = SndEnvPrograms.CUSTOM_MIN; p <= SndEnvPrograms.CUSTOM_MAX; p++) if (!used.has(p)) return p;
    return null;
  }

  get chain(): SndChain {
    return new SndChain(this.steps);
  }

  /** Highest multiplier a held note reaches (never below the nominal 1). */
  get peak(): number {
    return this.chain.points.reduce((m, p) => Math.max(m, p.amp), 1);
  }

  /** The editor's view of it. */
  get shape(): EnvShape {
    const steps = this.steps, chain = this.chain;
    const phases = chain.points.map(({ step }) => ({ amp: steps[step].amp, durMs: steps[step].durMs, ntau: steps[step].ntau }));
    const end: HeldEnd =
      chain.sustain != null
        ? { kind: 'hold' }
        : chain.loopTo != null
          ? { kind: 'loop', from: chain.points.findIndex((p) => p.step === chain.loopTo) }
          : { kind: 'release' };
    const r = steps[SndEnvPrograms.RELEASE_STEP];
    return { phases, end, release: { durMs: r.durMs, ntau: r.ntau } };
  }

  clone(): EnvStep[] {
    return this.steps.map((s) => ({ ...s }));
  }

  /** The same sound, laid out the way the editor writes it (step i → i+1). */
  normalized(): EnvStep[] {
    return new SndEnvShape(this.shape).steps();
  }

  /** Its release (ms): the last step's. */
  get releaseMs(): number {
    return this.steps[7]?.durMs ?? 10;
  }

  /**
   * Its amplitude (a MULTIPLIER ≥ 0, possibly > 1) at `elapsedMs` after note-on;
   * with `offMs` (when the note-off came), the release runs from then. The
   * Syntherrupter's maths (MIDIProgram::updateCoefficients): each step eases from
   * the previous step's amplitude toward its own `amp` over `durMs`, following an
   * n-tau exponential (RC-like), the firmware's closed form, verified to reach the
   * target exactly at t = durMs and to degrade to a LINEAR ramp when ntau = 0:
   *
   *   amp(t) = start + (target - start) * expm1(-ntau * t/dur) / expm1(-ntau)
   *
   * Step 0 is the attack (note-on, starting from 0). The last step (index 7) is
   * the release (note-off → 0). A step whose `next` points to itself sustains.
   */
  amplitude(elapsedMs: number, offMs: number | null): number {
    const steps = this.steps;
    const tHeld = offMs == null ? elapsedMs : Math.min(elapsedMs, offMs);
    let prevAmp = 0;
    let cur = 0;
    let acc = 0;
    let heldAmp = 0;
    // generous: a looping envelope walks one step per iteration for as long as the note is held
    for (let guard = 0; guard < 2048; guard++) {
      const s = steps[cur];
      if (s.durMs > 0 && tHeld < acc + s.durMs) {
        heldAmp = SndEnvelope.stepAmp(prevAmp, s.amp, s.ntau, (tHeld - acc) / s.durMs);
        break;
      }
      acc += Math.max(0, s.durMs);
      prevAmp = s.amp;
      heldAmp = prevAmp;
      if (s.next === cur) break; // sustain self-loop → hold here
      cur = s.next;
    }
    if (offMs == null || elapsedMs <= offMs) return Math.max(0, heldAmp);
    const rel = steps[7];
    const rt = elapsedMs - offMs;
    if (rel.durMs <= 0 || rt >= rel.durMs) return 0;
    return Math.max(0, SndEnvelope.stepAmp(heldAmp, 0, rel.ntau, rt / rel.durMs));
  }

  same(other: readonly EnvStep[]): boolean {
    const a = this.steps;
    return (
      a.length === SndEnvPrograms.STEP_COUNT &&
      other.length === SndEnvPrograms.STEP_COUNT &&
      a.every((s, i) => s.next === other[i].next && s.amp === other[i].amp && s.durMs === other[i].durMs && s.ntau === other[i].ntau)
    );
  }
}
