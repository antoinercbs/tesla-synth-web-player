import { SndTeslaSynth, type MidiSink } from '@/engine/audio/synth';
import type { DeviceDriver } from '@/model/devices/driver';
import { SndEnvPrograms, type EnvStep } from '@/model/sysex/envelopes';
import { ToneRunner } from '@/engine/tuning/tone-runner';
import { sendSysex, type SysexOutput } from '@/engine/serial/live-sysex-helper';

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

/** An envelope heard: one note through it, on the emulated synth or on a real coil, through `driver`'s messages. */
export class SndAudition {
  constructor(readonly a: Audition, private readonly driver: DeviceDriver) {}

  /**
   * On the emulated synth, whichever output is selected. The synth is sent the
   * envelope exactly as a device would be, so a draft sounds before it is saved.
   */
  onSynth(onDone: () => void): ToneRunner {
    const synth = SndTeslaSynth.shared();
    // ontime × duty only sets the synth's loudness
    return this.run(synth, (f) => sendSysex(synth as SysexOutput, f), 0, 40, 0.05, onDone);
  }

  /**
   * On one real coil through output 1, every other coil muted. Duty 0 leaves the
   * ontime alone in charge (the firmware plays whichever of the two gives more),
   * and the device still caps it at the coil limits.
   */
  onCoil(out: MidiSink, send: (frame: number[]) => void, coilIndex: number, ontimeUs: number, onDone: () => void): ToneRunner {
    return this.run(out, send, coilIndex, ontimeUs, 0, onDone);
  }

  private run(primary: MidiSink, send: (frame: number[]) => void, coilIndex: number, ontimeUs: number, duty: number, onDone: () => void): ToneRunner {
    const a = this.a;
    const releaseMs = (a.steps ?? SndEnvPrograms.steps(a.program))[SndEnvPrograms.RELEASE_STEP].durMs;
    const runner = new ToneRunner(
      { primary, secondary: null, sendSysex: send, driver: this.driver },
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
        coilCount: this.driver.profile.coils,
      },
      { onDone },
    );
    runner.start();
    return runner;
  }
}
