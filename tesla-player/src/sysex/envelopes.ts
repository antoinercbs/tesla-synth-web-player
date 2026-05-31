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
