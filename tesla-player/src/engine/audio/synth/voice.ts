import { SndEnvPrograms, type EnvStep } from '@/model/sysex/envelopes';
import { EPS, noteHz } from './constants';
import type { SndSound } from './sound';

export interface VoiceSpec {
  id: number;
  sounds: SndSound[];
  retro: boolean;
  note: number;
  vel: number;
  ch: number;
  steps: EnvStep[];
  onAt: number;
  coilVol: number[];
  placeRev: number;
}

/** A note on the board's list, from its note-on until its release is over. */
export class SndVoice {
  readonly id: number;
  /** Its sounds, one per coil playing it (one shared, the physics off); none: no coil plays its channel, it still takes the board's voices. */
  readonly sounds: SndSound[];
  readonly retro: boolean;
  readonly note: number;
  readonly vel: number;
  readonly ch: number;
  readonly steps: EnvStep[];
  readonly releaseS: number;
  readonly onAt: number;
  /** The key that holds it: its channel and note. */
  readonly key: string;
  keyUp: number | null = null;
  /** When its envelope went to the release: the key up, or the pedal up after it. */
  releaseAt: number | null = null;
  /** Cut short (struck again, stolen, all sound off), with its fade. */
  endAt: number | null = null;
  endFade = 0;
  /** How loud each coil plays it (the spatialisation); 0 = not at all. */
  coilVol: number[];
  placeRev: number;
  closed = false;
  /** When it changed on its own (its key up): the firmware looks at it again then. */
  private touches: number[] = [];

  constructor(s: VoiceSpec) {
    this.id = s.id;
    this.sounds = s.sounds;
    this.retro = s.retro;
    this.note = s.note;
    this.vel = s.vel;
    this.ch = s.ch;
    this.steps = s.steps;
    this.releaseS = Math.max(0, s.steps[SndEnvPrograms.RELEASE_STEP].durMs) / 1000;
    this.onAt = s.onAt;
    this.key = SndVoice.keyOf(s.ch, s.note);
    this.coilVol = s.coilVol;
    this.placeRev = s.placeRev;
  }

  static keyOf(ch: number, note: number): string {
    return `${ch}:${note}`;
  }

  /** When it leaves the board's list: its release over, or cut short. */
  get death(): number | null {
    if (this.endAt != null) return this.endAt;
    return this.releaseAt != null ? this.releaseAt + this.releaseS : null;
  }

  soundingAt(when: number): boolean {
    return (this.death ?? Infinity) > when;
  }

  /** It changed on its own in (from, to]. */
  touchedIn(from: number, to: number): boolean {
    return this.touches.some((x) => x > from + EPS && x <= to + EPS);
  }

  keyReleased(when: number): void {
    this.keyUp = when;
    this.touches.push(when);
  }

  /** Its envelope goes to its release step; false when it already did, or was cut. */
  release(when: number): boolean {
    if (this.releaseAt != null || this.endAt != null) return false;
    this.releaseAt = when;
    for (const s of this.sounds) s.stop(when + this.releaseS + 0.05);
    return true;
  }

  /** Cut short; false when it was already gone. */
  end(when: number, fade: number): boolean {
    const death = this.death;
    if (death != null && death <= when) return false;
    this.endAt = when;
    this.endFade = fade;
    for (const s of this.sounds) s.stop(when + fade + 0.05);
    return true;
  }

  /** Its sounds follow its channel's pitch (`bend` semitones) from `when`. */
  retune(bend: number, when: number): void {
    if (!this.soundingAt(when)) return;
    for (const s of this.sounds) s.retune(noteHz(this.note + bend), Math.max(when, this.onAt));
  }

  /** Leaving the board's list: silent from its death (a fade if cut short). */
  close(death: number): void {
    if (this.closed || !this.sounds.length) return;
    this.closed = true;
    for (const s of this.sounds) s.close(death, this.endAt != null ? this.endFade : null);
  }

  /** Its sounds' levels from `when` dropped, to be scheduled again; a fade already under way is left alone. */
  rewind(when: number): void {
    const death = this.death;
    if (this.closed && death != null && death < when) return;
    let any = false;
    for (const s of this.sounds) if (s.rewind(when, this.onAt)) any = true;
    if (any) this.closed = false;
  }

  disconnect(when: number): void {
    for (const s of this.sounds) s.disconnect(when);
  }
}
