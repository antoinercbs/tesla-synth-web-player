import { getTeslaSynth, type MidiSink } from '@/audio/tesla-synth';
import { RELEASE_STEP, programSteps, type EnvStep } from '@/sysex/envelopes';
import { ToneRunner } from '@/tuning/tone-runner';
import { sendSysex, type SysexOutput } from '@/utils/live-sysex-helper';
import { MAX_COILS } from '@/types/domain';

/** One note played through an envelope, as the editor shows it. */
export interface Audition {
  program: number;
  /** Written into the slot first (the editor's draft); null for a firmware program. */
  steps: readonly EnvStep[] | null;
  note: number;
  noteMs: number;
}

/** Past this the tail is cut: the release has faded or the envelope is odd. */
const MAX_TAIL_MS = 5000;

/**
 * On the emulated synth, whichever output is selected. The synth is sent the
 * envelope exactly as a device would be, so a draft sounds before it is saved.
 */
export function auditionOnSynth(a: Audition, onDone: () => void): ToneRunner {
  const synth = getTeslaSynth();
  // ontime × duty only sets the synth's loudness
  return run(synth, (f) => sendSysex(synth as SysexOutput, f), a, 0, 40, 0.05, onDone);
}

/**
 * On one real coil through output 1, every other coil muted. Duty 0 leaves the
 * ontime alone in charge (the firmware plays whichever of the two gives more),
 * and the device still caps it at the coil limits.
 */
export function auditionOnCoil(
  out: MidiSink,
  send: (frame: number[]) => void,
  a: Audition,
  coilIndex: number,
  ontimeUs: number,
  onDone: () => void,
): ToneRunner {
  return run(out, send, a, coilIndex, ontimeUs, 0, onDone);
}

function run(
  primary: MidiSink,
  send: (frame: number[]) => void,
  a: Audition,
  coilIndex: number,
  ontimeUs: number,
  duty: number,
  onDone: () => void,
): ToneRunner {
  const releaseMs = (a.steps ?? programSteps(a.program))[RELEASE_STEP].durMs;
  const runner = new ToneRunner(
    { primary, secondary: null, sendSysex: send },
    {
      notes: [a.note],
      holdMs: a.noteMs,
      // the runner ends on "all sound off": give the release time to play first
      gapMs: Math.min(MAX_TAIL_MS, releaseMs + 60),
      velocity: 127,
      channel: 0,
      coilIndex,
      ontimeUs,
      duty,
      program: a.program,
      envelope: a.steps,
      coilCount: MAX_COILS,
    },
    { onDone },
  );
  runner.start();
  return runner;
}
