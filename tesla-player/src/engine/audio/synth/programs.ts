import { SndEnvPrograms, type EnvStep } from '@/model/sysex/envelopes';
import { ENVELOPE_PN } from '@/model/sysex/syntherrupter';

/**
 * The envelopes written over SysEx, like the device's RAM: kept across clear()
 * (a device forgets them only on reboot). Unwritten programs use the shared table.
 */
export class SndPrograms {
  private written = new Map<number, EnvStep[]>();

  steps(program: number): EnvStep[] {
    return this.written.get(program) ?? SndEnvPrograms.steps(program);
  }

  /** Mirrors MIDIProgram::setDataPoint: the release amplitude stays 0, n-tau is kept off zero, and out-of-range values are ignored. */
  write(pn: number, target: number, value: number, isFloat: boolean): void {
    const step = target & 0x7f;
    const program = (target >> 8) & 0x7f;
    if (step >= SndEnvPrograms.STEP_COUNT || program > 63) return;
    const steps = this.steps(program).map((s) => ({ ...s }));
    const s = steps[step];
    const milli = isFloat ? value : value / 1000;
    if (pn === ENVELOPE_PN.NEXT) {
      if (value >= SndEnvPrograms.STEP_COUNT) return;
      s.next = value;
    } else if (pn === ENVELOPE_PN.AMPLITUDE) {
      if (milli < 0) return;
      s.amp = step === SndEnvPrograms.RELEASE_STEP ? 0 : milli;
    } else if (pn === ENVELOPE_PN.DURATION) {
      // µs in both the int and the float variant
      if (value < 0) return;
      s.durMs = value / 1000;
    } else {
      s.ntau = Math.abs(milli) < 0.1 ? 0.1 : milli;
    }
    this.written.set(program, steps);
  }
}
