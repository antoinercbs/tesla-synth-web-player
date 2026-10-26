import { DevOutput, type CoilDrive, type Limited, type Tone } from '@/model/devices/output';
import type { CoilLimits } from '@/model/devices/coil-limits';
import type { CoilConfig } from '@/model/domain';
import { MidNote } from '@/model/midi/note';

/** A note sounding (its release included), as one coil after another sees it. */
export interface BoardNote {
  /** Stable while the note lives. */
  id: number;
  hz: number;
  /** velocity × CC7 × CC11 × envelope × the soft pedal × the LFO: the firmware's finishedVolume. */
  level: number;
  /** Its volume on each coil (the pan), in the coils' order; 0: the coil doesn't play it. */
  vols: readonly number[];
  /** Its channel's controllers changed: looked at again whatever its level. */
  touched?: boolean;
}

export interface BoardCoil {
  drive: CoilDrive;
  limits: CoilLimits | null;
}

/** One coil at one moment. */
export interface CoilStep {
  limited: Limited;
  /** The notes it fires (indexes into the step's notes), in the order of limited.pulsesUs. */
  fired: number[];
  /** The notes it plays that have no tone for lack of a voice. */
  cut: number[];
  /** The longest ontime asked by the notes it fires (µs). */
  askedUs: number;
}

/** A key held in Live mode. */
export interface HeldKey {
  note: number;
  channel: number;
  velocity: number;
}

/**
 * What the board does with the notes sounding at one moment, coil by coil
 * (MIDI.cpp updateToneList, then DevOutput's limits). From the newest note to
 * the oldest, each takes one of the coil's voices, whichever coil it is for, and a
 * note past them loses its tone. The firmware only looks at a note again when it
 * changes (its volume, its controllers, the coil's settings), or when no voice is
 * left for it: a note that lost its tone stays silent while it holds still, even
 * once a voice frees up. Shared by the song's simulation and the built-in synth.
 */
export class DevBoard {
  private toned: Set<number>[] = [];
  private lastLevel = new Map<number, number>();
  private lastCoil: (BoardCoil | undefined)[] = [];

  /**
   * Live mode: by how much a coil's limits reduce the keys held right now (0..1,
   * 0 when they don't), the oldest first in `held`. The voices count every key held,
   * as the board's do; the envelope and the controller's CC7 are left out.
   */
  static heldReduction(held: readonly HeldKey[], coil: CoilConfig, limits: CoilLimits | null): number {
    const notes = held.map((k, id) => ({
      id, hz: MidNote.hz(k.note), level: k.velocity / 127, vols: [coil.channelMask & (1 << k.channel) ? 1 : 0],
    }));
    const [step] = new DevBoard().step(notes, [{ drive: { ontimeUs: coil.ontimeUs, duty: coil.duty }, limits }]);
    return 1 - step.limited.factor;
  }

  /** `notes` oldest first. */
  step(notes: readonly BoardNote[], coils: readonly BoardCoil[]): CoilStep[] {
    const changed = notes.map((n) => n.touched || this.lastLevel.get(n.id) !== n.level);
    const out = coils.map((c, k) => {
      const toned = (this.toned[k] ??= new Set());
      const last = this.lastCoil[k];
      const coilChange = !last || last.limits !== c.limits
        || last.drive.ontimeUs !== c.drive.ontimeUs || last.drive.duty !== c.drive.duty;
      this.lastCoil[k] = { drive: { ...c.drive }, limits: c.limits };
      const output = new DevOutput(c.drive, c.limits);
      let left = c.limits?.voices ?? Infinity;
      const tones: Tone[] = [];
      const fired: number[] = [];
      const cut: number[] = [];
      let askedUs = 0;
      for (let j = notes.length - 1; j >= 0; j--) {
        const n = notes[j];
        const vol = n.vols[k] ?? 0;
        const us = vol > 0 ? output.requested(n.hz, n.level * vol) : 0;
        let has = toned.has(n.id) && us >= 1;
        if (changed[j] || coilChange || left === 0) has = left > 0 && us >= 1;
        if (has) {
          toned.add(n.id);
          tones.push({ ontimeUs: us, hz: n.hz });
          fired.push(j);
          askedUs = Math.max(askedUs, us);
        } else {
          toned.delete(n.id);
          if (us >= 1) cut.push(j);
        }
        left = Math.max(0, left - 1);
      }
      return { limited: DevOutput.limit(tones, c.limits), fired, cut, askedUs };
    });
    for (const n of notes) this.lastLevel.set(n.id, n.level);
    return out;
  }

  /** A note gone for good: its release is over. */
  forget(id: number): void {
    this.lastLevel.delete(id);
    for (const s of this.toned) s?.delete(id);
  }

  /** A copy, to step again from this moment. */
  clone(): DevBoard {
    const c = new DevBoard();
    c.toned = this.toned.map((s) => new Set(s));
    c.lastLevel = new Map(this.lastLevel);
    c.lastCoil = this.lastCoil.map((l) => l && { drive: { ...l.drive }, limits: l.limits });
    return c;
  }

  /** The coils' settings changed shape (another song, other coils): start over. */
  reset(): void {
    this.toned = [];
    this.lastLevel.clear();
    this.lastCoil = [];
  }
}
