/**
 * Syntherrupter built-in envelope "programs" (a.k.a. instruments). On the coil
 * driver an envelope is selected PER MIDI CHANNEL with a standard Program Change
 * (status 0xC0 | channel, data = program number).
 *
 * Names are condensed from the Syntherrupter wiki (Documentation/Wiki/Envelopes.md):
 * programs 1-9 are linear shapes, 11-19 are the same shapes with exponential
 * curves. 0 means "no envelope" (constant ontime).
 */
export type EnvelopeKind = 'constant' | 'piano' | 'pad' | 'staccato' | 'legato';

export interface Envelope {
  program: number;
  name: string;
  kind: EnvelopeKind;
}

export const ENVELOPES: Envelope[] = [
  { program: 0, name: 'Constant', kind: 'constant' },
  { program: 1, name: 'Piano', kind: 'piano' },
  { program: 2, name: 'Slow pad', kind: 'pad' },
  { program: 3, name: 'Piano + step', kind: 'piano' },
  { program: 4, name: 'Piano (fast)', kind: 'piano' },
  { program: 5, name: 'Staccato', kind: 'staccato' },
  { program: 6, name: 'Legato', kind: 'legato' },
  { program: 7, name: 'Pad (fast release)', kind: 'pad' },
  { program: 8, name: 'Piano (soft)', kind: 'piano' },
  { program: 9, name: 'Piano 2', kind: 'piano' },
  { program: 10, name: 'Piano 3', kind: 'piano' },
  { program: 11, name: 'Piano (exp)', kind: 'piano' },
  { program: 12, name: 'Slow pad (exp)', kind: 'pad' },
  { program: 13, name: 'Piano + step (exp)', kind: 'piano' },
  { program: 14, name: 'Piano fast (exp)', kind: 'piano' },
  { program: 15, name: 'Staccato (exp)', kind: 'staccato' },
  { program: 16, name: 'Legato (exp)', kind: 'legato' },
  { program: 17, name: 'Pad fast rel. (exp)', kind: 'pad' },
  { program: 18, name: 'Piano soft (exp)', kind: 'piano' },
  { program: 19, name: 'Piano 2 (exp)', kind: 'piano' },
];

const BY_PROGRAM = new Map(ENVELOPES.map((e) => [e.program, e]));

export function envelope(program: number): Envelope {
  return BY_PROGRAM.get(program) ?? { program, name: `Program ${program}`, kind: 'piano' };
}

const KIND_ICON: Record<EnvelopeKind, string> = {
  constant: 'fa-wave-square',
  piano: 'fa-music',
  pad: 'fa-wind',
  staccato: 'fa-bolt',
  legato: 'fa-grip-lines',
};
export function envelopeIcon(program: number): string {
  return KIND_ICON[envelope(program).kind];
}

/** MIDI Program Change message bytes for a channel (0..15) and program. */
export function programChange(channel: number, program: number): number[] {
  return [0xc0 | (channel & 0x0f), program & 0x7f];
}

// ---------------------------------------------------------------------------
// Envelope simulation (for the VU). Replicates the Syntherrupter envelope maths
// (MIDIProgram::updateCoefficients): each step eases from the previous step's
// amplitude toward its own `amp` over `durMs`, following an n-tau exponential
// (RC-like). The firmware closed form, verified to reach the target exactly at
// t = durMs and to degrade to a LINEAR ramp when ntau = 0:
//
//   amp(t) = start + (target - start) * expm1(-ntau * t/dur) / expm1(-ntau)
//
// Step 0 is the attack (note-on, starting from 0). The last step (index 7) is
// the release (note-off → 0). A step whose `next` points to itself sustains.
//
// NOTE: the firmware's *default* step tables are loaded at runtime (not in the
// public source), so the per-archetype values below are modelled to match the
// documented behaviour of programs 0-19 (Documentation/Wiki/Envelopes.md). The
// MATHS is the firmware's; only the step constants are an editable model.
// ---------------------------------------------------------------------------

export interface EnvStep { next: number; durMs: number; amp: number; ntau: number }

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Amplitude within one step at fraction `frac` (0..1) of its duration. */
export function stepAmp(start: number, target: number, ntau: number, frac: number): number {
  const f = clamp01(frac);
  if (Math.abs(ntau) < 1e-6) return start + (target - start) * f; // linear
  return start + (target - start) * (Math.expm1(-ntau * f) / Math.expm1(-ntau));
}

/** Build an 8-step ADSR-style table (attack→decay→sustain self-loop, release@7). */
function adsr(
  aMs: number, aN: number, dMs: number, sLevel: number, dN: number, rMs: number, rN: number,
): EnvStep[] {
  const s: EnvStep[] = Array.from({ length: 8 }, (_, i) => ({ next: i, durMs: 0, amp: sLevel, ntau: 0 }));
  s[0] = { next: 1, durMs: aMs, amp: 1, ntau: aN };       // attack 0 → 1
  s[1] = { next: 2, durMs: dMs, amp: sLevel, ntau: dN };  // decay 1 → sustain
  s[2] = { next: 2, durMs: 0, amp: sLevel, ntau: 0 };     // sustain (hold) until note-off
  s[7] = { next: 7, durMs: rMs, amp: 0, ntau: rN };       // release → 0
  return s;
}
function expify(steps: EnvStep[]): EnvStep[] {
  // exponential variant: linear segments become gently exponential, others sharper
  return steps.map((s) => ({ ...s, ntau: s.ntau === 0 ? 1.2 : s.ntau * 2.5 }));
}

const ARCH: Record<EnvelopeKind, EnvStep[]> = {
  constant: adsr(0, 0, 0, 1, 0, 25, 2),       // instant full, hold, quick release
  piano: adsr(4, 0, 1400, 0, 3, 90, 2),       // fast attack, long decay to silence
  pad: adsr(650, 2, 200, 1, 1, 650, 2),       // slow rise, sustain, slow release
  staccato: adsr(3, 0, 90, 0, 2, 40, 2),      // always short
  legato: adsr(12, 0, 60, 1, 1, 420, 2),      // held, longer release
};
const ARCH_EXP: Record<EnvelopeKind, EnvStep[]> = {
  constant: expify(ARCH.constant),
  piano: expify(ARCH.piano),
  pad: expify(ARCH.pad),
  staccato: expify(ARCH.staccato),
  legato: expify(ARCH.legato),
};

/** Step table for a program (programs ≥ 11 are the exponential-curve variants). */
export function programSteps(program: number): EnvStep[] {
  const kind = envelope(program).kind;
  return program >= 11 ? ARCH_EXP[kind] : ARCH[kind];
}

/**
 * Envelope amplitude (0..1) at `elapsedMs` after note-on. If `releaseMs` is set
 * (elapsed time at which note-off happened), the release segment runs from then.
 */
export function envelopeAmplitude(program: number, elapsedMs: number, releaseMs: number | null): number {
  const steps = programSteps(program);
  const tHeld = releaseMs == null ? elapsedMs : Math.min(elapsedMs, releaseMs);

  // walk the held phase to the amplitude at min(elapsed, release)
  let prevAmp = 0;
  let cur = 0;
  let acc = 0;
  let heldAmp = 0;
  for (let guard = 0; guard < 64; guard++) {
    const s = steps[cur];
    if (s.durMs > 0 && tHeld < acc + s.durMs) {
      heldAmp = stepAmp(prevAmp, s.amp, s.ntau, (tHeld - acc) / s.durMs);
      break;
    }
    acc += Math.max(0, s.durMs);
    prevAmp = s.amp;
    heldAmp = prevAmp;
    if (s.next === cur) break; // sustain self-loop → hold here
    cur = s.next;
  }
  if (releaseMs == null || elapsedMs <= releaseMs) return clamp01(heldAmp);

  // release segment: from the amplitude at note-off down to 0
  const rel = steps[7];
  const rt = elapsedMs - releaseMs;
  if (rel.durMs <= 0 || rt >= rel.durMs) return 0;
  return clamp01(stepAmp(heldAmp, 0, rel.ntau, rt / rel.durMs));
}
