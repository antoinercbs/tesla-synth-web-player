import { MidStereo } from '@/model/midi/stereo';
import { BEND_RANGE, EPS } from './constants';
import { SndTimeline } from './timeline';

/** A channel's note pan mapping (NRP 42) and its NRPN selection, as Channel.h holds them. */
interface PanMapping {
  selMsb: number;
  selLsb: number;
  mode: number;
  srcLow: number;
  srcHigh: number;
  tgtLow: number;
  tgtHigh: number;
}
const freshMapping = (): PanMapping => ({ selMsb: 127, selLsb: 127, mode: 0, srcLow: 0, srcHigh: 127, tgtLow: 0, tgtHigh: 1 });

/** A MIDI channel as the board holds it (Channel.h): its program, its controllers along the clock (and when they changed), its pitch, its note pan mapping. */
export class SndChannel {
  program = 0;
  readonly volume = new SndTimeline(1);
  readonly expression = new SndTimeline(1);
  readonly modulation = new SndTimeline(0);
  readonly soft = new SndTimeline(0);
  readonly sustain = new SndTimeline(0);
  readonly pan = new SndTimeline(MidStereo.CENTER);
  /** Semitones off the note: the pitch bend × its range, plus the tuning. */
  readonly bend = new SndTimeline(0);
  /** When its controllers changed: the firmware looks at its notes again then. */
  private touches: number[] = [];
  private bendRaw = 0;
  private rangeCoarse = BEND_RANGE;
  private rangeFine = 0;
  private fineCoarse = 64;
  private fineFine = 0;
  private coarseTuning = 0;
  /** The RPN selected (0x7f7f: none); the NRPN one is in the pan mapping. */
  private rpn = 0x7f7f;
  private mapping = freshMapping();

  touch(when: number): void {
    this.touches.push(when);
  }

  /** Its controllers changed in (from, to]. */
  touchedIn(from: number, to: number): boolean {
    return this.touches.some((x) => x > from + EPS && x <= to + EPS);
  }

  /** Channel.cpp resetControllers (CC121, the MIDI mode switched on), the channel's own part: not the NRPs themselves, nor the pedal. */
  reset(when: number): void {
    this.volume.set(when, 1);
    this.expression.set(when, 1);
    this.modulation.set(when, 0);
    this.pan.set(when, MidStereo.CENTER);
    this.soft.set(when, 0);
    this.bendRaw = 0;
    this.rangeCoarse = BEND_RANGE;
    this.rangeFine = 0;
    this.fineCoarse = 64;
    this.fineFine = 0;
    this.coarseTuning = 0;
    this.rpn = 0x7f7f;
    this.bend.set(when, 0);
    this.mapping.selMsb = 127;
    this.mapping.selLsb = 127;
  }

  /** The note pan mapping back to its defaults (Sysex 0x66), its NRPN selection kept. */
  resetPanMapping(): void {
    this.mapping = { ...freshMapping(), selMsb: this.mapping.selMsb, selLsb: this.mapping.selLsb };
  }

  /** CC 99 (msb) / 98: an NRPN selected forgets the RPN. */
  selectNrpn(msb: boolean, v: number): void {
    if (msb) this.mapping.selMsb = v;
    else this.mapping.selLsb = v;
    this.rpn = 0x7f7f;
  }

  /** CC 101 (msb) / 100: an RPN selected forgets the NRPN. */
  selectRpn(msb: boolean, v: number): void {
    this.rpn = msb ? (this.rpn & 0x00ff) | (v << 8) : (this.rpn & 0xff00) | v;
    this.mapping.selMsb = 127;
    this.mapping.selLsb = 127;
  }

  /**
   * CC6 (coarse) / CC38 (fine) on the RPN or NRPN selected, as MIDI.cpp reads
   * them: 'pitch' when its pitch changed (its notes follow), 'set' for another
   * parameter, null when nothing takes it.
   */
  dataEntry(fine: boolean, v: number, when: number): 'pitch' | 'set' | null {
    const n = this.mapping;
    if (this.rpn === 0) {
      if (fine) this.rangeFine = v;
      else this.rangeCoarse = v;
    } else if (this.rpn === 1) {
      if (fine) this.fineFine = v;
      else this.fineCoarse = v;
    } else if (this.rpn === 2 && !fine) this.coarseTuning = v - 64;
    else if (n.selMsb === 42 && !fine && n.selLsb === 1) n.srcHigh = v;
    else if (n.selMsb === 42 && !fine && n.selLsb === 2) n.tgtHigh = v / 127;
    else if (n.selMsb === 42 && fine && n.selLsb === 0) n.mode = v;
    else if (n.selMsb === 42 && fine && n.selLsb === 1) n.srcLow = v;
    else if (n.selMsb === 42 && fine && n.selLsb === 2) n.tgtLow = v / 127;
    else return null;
    const pitch = this.rpn <= 2;
    if (pitch) this.bend.set(when, this.bendNow);
    this.touch(when);
    return pitch ? 'pitch' : 'set';
  }

  pitchBend(raw: number, when: number): void {
    this.bendRaw = raw;
    this.bend.set(when, this.bendNow);
    this.touch(when);
  }

  /**
   * Where the device puts a note (0..1), or null when it plays everywhere (omni).
   * held: the channel's keys down, asked only by the mappings that follow the
   * lowest, highest or loudest of them.
   */
  notePan(note: number, vel: number, t: number, held: () => readonly { note: number; vel: number }[]): number | null {
    const n = this.mapping;
    if (n.mode === 0) return this.pan.at(t);
    if (n.mode === 2) return null;
    let input = note;
    if (n.mode !== 1) {
      const all = [...held(), { note, vel }];
      if (n.mode === 3) input = Math.min(...all.map((h) => h.note));
      else if (n.mode === 4) input = Math.max(...all.map((h) => h.note));
      else input = all.reduce((a, h) => (h.vel > a.vel ? h : a)).note;
    }
    if (input <= n.srcLow) return n.tgtLow;
    if (input >= n.srcHigh) return n.tgtHigh;
    return ((input - n.srcLow) * (n.tgtHigh - n.tgtLow)) / (n.srcHigh - n.srcLow) + n.tgtLow;
  }

  /** Forget what came before `past`. */
  prune(past: number): void {
    for (const tl of [this.volume, this.expression, this.modulation, this.soft, this.sustain, this.pan, this.bend]) tl.prune(past);
    this.touches = this.touches.filter((x) => x > past);
  }

  /** Semitones off the note: the bend × its range (semitones + cents), plus the tuning. */
  private get bendNow(): number {
    const tuning = ((this.fineCoarse << 7) + this.fineFine - 8192) / 8192 + this.coarseTuning;
    return (this.bendRaw / 8192) * (this.rangeCoarse + this.rangeFine / 100) + tuning;
  }
}
