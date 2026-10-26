import type { CoilLimits } from '@/model/devices/coil-limits';

/**
 * The pulses a Syntherrupter really fires, from what the app sends a coil
 * (firmware: MIDI.cpp setVolSettings / updateOutput, ToneList.cpp updateTone /
 * limit, Output.cpp addPulse, Simple.h). The ontime and duty sent are not
 * ceilings: in MIDI mode a note under the crossover gets the duty × its period,
 * longer than the ontime sent. Then the coil's own limits: each note is capped
 * at its max ontime, the notes sounding together share its max duty (past it all
 * of them shrink by the same factor), its min ontime is added to every pulse, and
 * the output cuts the whole pulse at the max ontime again, and drops one shorter
 * than it can fire.
 */

/** Output.h MIN_TIME_US: the output drops a shorter pulse. */
export const MIN_PULSE_US = 4;

/** What a coil is sent: ontime (µs) and duty (fraction), after automation and Power. */
export interface CoilDrive {
  ontimeUs: number;
  duty: number;
}

/** One note held by a coil: the ontime it asks for (µs, after its volume) and its frequency. */
export interface Tone {
  ontimeUs: number;
  hz: number;
}

/** What the coil makes of the tones it holds together. */
export interface Limited {
  /** The pulse of each tone (µs), in their order; 0 for a silent one. */
  pulsesUs: number[];
  /** The factor all of them were scaled by to fit the max duty (1: untouched). */
  factor: number;
  /** The duty they ask for together, min ontime included (fraction). */
  dutyAsked: number;
  /** The duty they fire. */
  duty: number;
}

/** An output of the board driving a coil: what it is sent, under the coil's limits (null: unknown, nothing limits it here). */
export class DevOutput {
  constructor(readonly drive: CoilDrive, readonly limits: CoilLimits | null = null) {}

  /**
   * The limits of the coil on the tones it holds together: each capped at the max
   * ontime (no tone under 1 µs), all scaled to share the max duty, the min ontime
   * added to each, every pulse cut at the max ontime and dropped under 4 µs
   * (ToneList::limit, Output::addPulse). An absent limit does not limit.
   */
  static limit(tones: readonly Tone[], limits: CoilLimits | null = null): Limited {
    const maxOn = limits?.ontimeUs ?? Infinity;
    const maxDuty = limits?.duty ?? Infinity;
    const minOn = limits?.minOntimeUs ?? 0;
    const capped = tones.map((t) => {
      const us = Math.min(t.ontimeUs, maxOn);
      return us < 1 ? 0 : us;
    });
    let unlimited = 0;
    let minimum = 0;
    tones.forEach((t, k) => {
      if (!capped[k]) return;
      unlimited += (capped[k] * t.hz) / 1e6;
      minimum += (minOn * t.hz) / 1e6;
    });
    // the min ontime is left out when it alone would pass the max duty
    const offset = minimum >= maxDuty ? 0 : minOn;
    const budget = maxDuty - (offset ? minimum : 0);
    const factor = unlimited > budget ? budget / unlimited : 1;
    // a dropped pulse still took its share of the duty above
    const pulsesUs = capped.map((us) => {
      const pulse = us ? Math.min(offset + us * factor, maxOn) : 0;
      return pulse < MIN_PULSE_US ? 0 : pulse;
    });
    const duty = pulsesUs.reduce((sum, us, k) => sum + (us * tones[k].hz) / 1e6, 0);
    return { pulsesUs, factor, dutyAsked: unlimited + (offset ? minimum : 0), duty };
  }

  /**
   * The ontime past which a note fires the max ontime whatever it asks: the min
   * ontime is added within it. Null when the max ontime is unknown.
   */
  static cap(limits: CoilLimits | null): number | null {
    if (limits?.ontimeUs == null) return null;
    return Math.max(0, limits.ontimeUs - (limits.minOntimeUs ?? 0));
  }

  /** Where the duty (below) hands over to the ontime (above), in Hz: the firmware's absFreq. */
  get crossoverHz(): number {
    // the firmware divides by an ontime of at least 1 µs
    return (this.drive.duty * 1e6) / Math.max(this.drive.ontimeUs, 1);
  }

  /**
   * MIDI mode: under this frequency (Hz) a note at full volume fires the max
   * ontime, and stays there whatever the velocity, CC7 or Power until the volume
   * falls under capVolume(). Infinity: every note; 0: none.
   */
  get saturationHz(): number {
    const cap = DevOutput.cap(this.limits);
    if (cap == null) return 0;
    if (!(cap > 0) || this.drive.ontimeUs > cap) return Infinity;
    return (this.drive.duty * 1e6) / cap;
  }

  /** MIDI mode: the ontime (µs) a note of `hz` asks for at volume `vol`, before any limit of the coil. */
  requested(hz: number, vol = 1): number {
    // the firmware's own test, so a note right on the crossover lands on the same side
    return vol * (hz >= this.crossoverHz ? this.drive.ontimeUs : (this.drive.duty * 1e6) / hz);
  }

  /**
   * MIDI mode (songs, Live): the pulse (µs) a note of `hz` fires when it sounds
   * alone, at volume `vol` (velocity × CC7 × CC11 × envelope × pan, 0..1).
   */
  effective(hz: number, vol = 1): number {
    return DevOutput.limit([{ ontimeUs: this.requested(hz, vol), hz }], this.limits).pulsesUs[0];
  }

  /** MIDI mode: the volume (0..1) under which a note of `hz` leaves the cap. 1 or more: it never reaches it. */
  capVolume(hz: number): number {
    const cap = DevOutput.cap(this.limits);
    return cap == null ? Infinity : cap / this.requested(hz);
  }

  /** The live Power (%) past which a note of `hz` fires the max ontime whatever more it gets (its notch on the fader); null: not under 200 %. */
  powerNotch(hz: number): number | null {
    const pct = Math.floor(this.capVolume(hz) * 100);
    return pct < 200 ? pct : null;
  }

  /**
   * Fixed (Simple) mode: the ontime (µs) asked at `bpsHz`. The app sends the BPS,
   * the ontime, then the duty, and the firmware turns that last duty into an
   * ontime with the BPS: the ontime sent never counts.
   */
  fixedRequested(bpsHz: number): number {
    return bpsHz > 0 ? (this.drive.duty * 1e6) / bpsHz : 0;
  }

  /** Fixed (Simple) mode: the pulse (µs) fired at `bpsHz`, through the same limits of the coil. */
  fixedPulse(bpsHz: number): number {
    if (!(bpsHz > 0)) return 0;
    return DevOutput.limit([{ ontimeUs: this.fixedRequested(bpsHz), hz: bpsHz }], this.limits).pulsesUs[0];
  }
}
