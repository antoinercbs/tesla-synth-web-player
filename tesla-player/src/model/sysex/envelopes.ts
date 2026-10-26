import type { CustomEnvelope } from '@/model/domain';

export type EnvelopeKind = 'constant' | 'piano' | 'pad' | 'staccato' | 'legato' | 'custom';

export interface Envelope {
  program: number;
  name: string;
  kind: EnvelopeKind;
}

/**
 * A firmware envelope step. Each step eases from the previous step's amplitude
 * toward its own `amp` over `durMs` along an n-tau curve (SndEnvelope plays
 * them); a step whose `next` points to itself sustains.
 */
export interface EnvStep { next: number; durMs: number; amp: number; ntau: number }

type Library = Map<number, CustomEnvelope>;

// ---------------------------------------------------------------------------
// Factory-default envelope tables, transcribed from the Syntherrupter firmware
// (Syntherrupter_Tiva/EEPROMSettings.cpp::initDefault), durations converted µs→ms.
// Shape per program: step 0 = attack (from 0), 1 → 2, step 2 self-loops as the
// sustain, step 7 (LAST) = release (note-off → 0). Amplitude MULTIPLIES the note
// ontime and may exceed 1 (e.g. P8/P9 punch on attack). ntau = curve: ≈0.1 (near
// linear) for P1-9, 3.0 for the exponential variants P11-19, P10 is its own design.
//
// NOTE: the firmware's *default* step tables are loaded at runtime (not in the
// public source), so the per-archetype values below are modelled to match the
// documented behaviour of programs 0-19 (Documentation/Wiki/Envelopes.md). The
// MATHS is the firmware's; only the step constants are an editable model.
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

/**
 * The envelope "programs" (a.k.a. instruments) a channel can pick. On the coil
 * driver an envelope is selected PER MIDI CHANNEL with a standard Program Change
 * (status 0xC0 | channel, data = program number). Names are condensed from the
 * Syntherrupter wiki (Documentation/Wiki/Envelopes.md): programs 1-9 are linear
 * shapes, 11-19 are the same shapes with exponential curves. 0 means "no
 * envelope" (constant ontime). Programs 20-63 are the user's library envelopes:
 * the store registers the list here so the synth, the VU and every picker read
 * the very shape the device is sent; the app holds it in a ref (holdIn) so the
 * pickers' computeds follow edits.
 */
export class SndEnvPrograms {
  static readonly BUILTIN: Envelope[] = [
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
  static readonly CUSTOM_MIN = 20;
  static readonly CUSTOM_MAX = 63;
  /** Firmware envelopes always have 8 steps: 0 = attack (note-on), 7 = release (note-off). */
  static readonly STEP_COUNT = 8;
  static readonly RELEASE_STEP = SndEnvPrograms.STEP_COUNT - 1;

  private static readonly byProgram = new Map(SndEnvPrograms.BUILTIN.map((e) => [e.program, e]));
  private static library: { value: Library } = { value: new Map() };

  /** Keeps the library in `box` (a Vue shallowRef, for one) from now on, with what it holds already. */
  static holdIn(box: { value: Library }): void {
    box.value = SndEnvPrograms.library.value;
    SndEnvPrograms.library = box;
  }

  static setCustom(list: readonly CustomEnvelope[]): void {
    SndEnvPrograms.library.value = new Map(
      list
        .filter((e) => e.program >= SndEnvPrograms.CUSTOM_MIN && e.program <= SndEnvPrograms.CUSTOM_MAX)
        .filter((e) => e.steps?.length === SndEnvPrograms.STEP_COUNT)
        .map((e) => [e.program, e]),
    );
  }

  static custom(program: number): CustomEnvelope | undefined {
    return SndEnvPrograms.library.value.get(program);
  }

  /** A program's name and kind. */
  static info(program: number): Envelope {
    const custom = SndEnvPrograms.custom(program);
    if (custom) return { program, name: custom.name, kind: 'custom' };
    return SndEnvPrograms.byProgram.get(program) ?? { program, name: `Program ${program}`, kind: 'piano' };
  }

  /** Every envelope a channel can pick, as the pickers group them. */
  static choices(): { custom: Envelope[]; builtin: Envelope[] } {
    const custom = [...SndEnvPrograms.library.value.values()].sort((a, b) => a.program - b.program);
    return {
      custom: custom.map((e) => ({ program: e.program, name: e.name, kind: 'custom' })),
      builtin: SndEnvPrograms.BUILTIN,
    };
  }

  /** The 8-step table of a program. Unset slots behave like P0 on the device (constant), and so do they here. */
  static steps(program: number): EnvStep[] {
    return SndEnvPrograms.custom(program)?.steps ?? PROGRAMS[program] ?? PROGRAMS[0];
  }

  /** MIDI Program Change message bytes for a channel (0..15) and program. */
  static change(channel: number, program: number): number[] {
    return [0xc0 | (channel & 0x0f), program & 0x7f];
  }
}
