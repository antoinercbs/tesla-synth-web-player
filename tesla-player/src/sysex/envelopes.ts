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

/** Amplitude within one step at fraction `frac` (0..1) of its duration: n-tau RC curve, linear at ntau≈0. */
export function stepAmp(start: number, target: number, ntau: number, frac: number): number {
  const f = frac < 0 ? 0 : frac > 1 ? 1 : frac;
  if (Math.abs(ntau) < 1e-6) return start + (target - start) * f;
  return start + (target - start) * (Math.expm1(-ntau * f) / Math.expm1(-ntau));
}

// ---------------------------------------------------------------------------
// Factory-default envelope tables, transcribed from the Syntherrupter firmware
// (Syntherrupter_Tiva/EEPROMSettings.cpp::initDefault), durations converted µs→ms.
// Shape per program: step 0 = attack (from 0), 1 → 2, step 2 self-loops as the
// sustain, step 7 (LAST) = release (note-off → 0). Amplitude MULTIPLIES the note
// ontime and may exceed 1 (e.g. P8/P9 punch on attack). ntau = curve: ≈0.1 (near
// linear) for P1-9, 3.0 for the exponential variants P11-19, P10 is its own design.
// ---------------------------------------------------------------------------
type Pt = [amp: number, durMs: number, ntau: number];
function fw(a: Pt, b: Pt, c: Pt, r: Pt): EnvStep[] {
  const mk = (t: Pt, next: number): EnvStep => ({ amp: t[0], durMs: t[1], ntau: t[2], next });
  const sustain = mk(c, 2);
  // steps 3-6 are never reached (next chains 0→1→2→2); mirror the sustain to be safe
  return [mk(a, 1), mk(b, 2), sustain, { ...sustain }, { ...sustain }, { ...sustain }, { ...sustain }, mk(r, 7)];
}

const BASE: Record<number, EnvStep[]> = {
  1: fw([1.0, 30, 0.1], [0.5, 10, 0.1], [0.1, 3500, 0.1], [0, 10, 0.1]),
  2: fw([1.0, 4000, 0.1], [1.0, 0.001, 0.1], [1.0, 0.001, 0.1], [0, 1000, 0.1]),
  3: fw([0.3, 8, 0.1], [1.0, 4000, 0.1], [1.0, 0.001, 0.1], [0, 1000, 0.1]),
  4: fw([1.0, 1500, 0.1], [1.0, 0.001, 0.1], [1.0, 0.001, 0.1], [0, 500, 0.1]),
  5: fw([1.0, 3, 0.1], [0.4, 30, 0.1], [0.0, 400, 0.1], [0, 0.001, 0.1]),
  6: fw([1.0, 7, 0.1], [0.5, 10, 0.1], [0.25, 3000, 0.1], [0, 3000, 0.1]),
  7: fw([0.3, 8, 0.1], [1.0, 4000, 0.1], [1.0, 0.001, 0.1], [0, 400, 0.1]),
  8: fw([2.0, 30, 0.1], [1.0, 2.5, 0.1], [0.1, 3500, 0.1], [0, 10, 0.1]),
  9: fw([3.0, 3, 0.1], [1.0, 27, 0.1], [0.0, 400, 0.1], [0, 0.001, 0.1]),
  10: fw([2.0, 15, 2.0], [1.0, 100, 2.0], [0.0, 8000, 7.0], [0, 200, 4.0]),
};

const PROGRAMS: Record<number, EnvStep[]> = { ...BASE };
// 11-19 = 1-9 with every step's ntau forced to 3.0 (the exponential variants)
for (let p = 1; p <= 9; p++) PROGRAMS[p + 10] = BASE[p].map((s) => ({ ...s, ntau: 3.0 }));
// 0 = "no envelope": full ontime held while the note is down, with a tiny release
PROGRAMS[0] = [
  { amp: 1, durMs: 0, ntau: 0, next: 0 },
  ...Array.from({ length: 6 }, (): EnvStep => ({ amp: 1, durMs: 0, ntau: 0, next: 0 })),
  { amp: 0, durMs: 6, ntau: 0.1, next: 7 },
];

/** The 8-step envelope table for a program (unknown programs fall back to constant). */
export function programSteps(program: number): EnvStep[] {
  return PROGRAMS[program] ?? PROGRAMS[0];
}

/**
 * Envelope amplitude (a MULTIPLIER ≥ 0, possibly > 1) at `elapsedMs` after note-on.
 * If `releaseMs` is set (elapsed time of the note-off), the release runs from then.
 */
export function envelopeAmplitude(program: number, elapsedMs: number, releaseMs: number | null): number {
  const steps = programSteps(program);
  const tHeld = releaseMs == null ? elapsedMs : Math.min(elapsedMs, releaseMs);
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
  if (releaseMs == null || elapsedMs <= releaseMs) return Math.max(0, heldAmp);
  const rel = steps[7];
  const rt = elapsedMs - releaseMs;
  if (rel.durMs <= 0 || rt >= rel.durMs) return 0;
  return Math.max(0, stepAmp(heldAmp, 0, rel.ntau, rt / rel.durMs));
}

/** Time (ms) from note-on until the sustain is reached — a good envelope-sampling horizon. */
export function envelopeSustainMs(program: number): number {
  const steps = programSteps(program);
  let cur = 0;
  let acc = 0;
  for (let g = 0; g < 16; g++) {
    acc += Math.max(0, steps[cur].durMs);
    if (steps[cur].next === cur) break;
    cur = steps[cur].next;
  }
  return Math.min(acc, 8000);
}

/** Release duration (ms) for a program (the LAST step). */
export function envelopeReleaseMs(program: number): number {
  return programSteps(program)[7]?.durMs ?? 10;
}
