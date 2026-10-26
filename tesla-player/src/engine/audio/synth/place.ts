import { MidStereo } from '@/model/midi/stereo';
import { PAN_PN } from '@/model/sysex/syntherrupter';

/** Where a coil stands for the spatialisation, as the device holds it (MIDI.h). */
export class SndPlace {
  /** 0..1, or -1: not placed (the coil plays every note it is assigned). */
  position = -1;
  reach = 1;
  single = false;

  /** Its stereo position (-1..1); unplaced: the middle. */
  get stereo(): number {
    return this.position >= 0 ? 2 * this.position - 1 : 0;
  }

  /** Mirrors Sysex.cpp 0x62-0x64, quirks included: the integer reach is not divided by 127. */
  write(pn: number, value: number, isFloat: boolean): void {
    if (pn === PAN_PN.CONFIG) {
      if ((value & 0b111) === 0) this.single = true;
      else if ((value & 0b111) === 1) this.single = false;
    } else if (pn === PAN_PN.POSITION) {
      const f = isFloat ? value : value / 127;
      this.position = f >= 0 && f <= 1 ? f : -1;
    } else if (value >= 0 && value <= 1) {
      this.reach = value;
    }
  }

  /** How loud it plays a note the device puts at `pan` (null: everywhere). */
  volume(pan: number | null): number {
    if (pan == null || this.position < 0) return 1;
    return MidStereo.panVolume(pan, this, this.single ? 'single' : 'fade');
  }
}
