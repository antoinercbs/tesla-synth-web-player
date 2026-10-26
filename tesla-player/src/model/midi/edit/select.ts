import type { MidTempo } from '@/model/midi/tempo';
import type { EdNote } from './doc';

/** The ways to pick notes from the "Select" menu, among the notes in scope: each returns the matching ones. */
export class MidPicker {
  constructor(readonly notes: EdNote[]) {}

  shorterThan(ms: number, map: MidTempo): EdNote[] {
    return this.notes.filter((n) => map.toMs(n.tick + n.dur) - map.toMs(n.tick) < ms);
  }

  velocityBelow(velocity: number): EdNote[] {
    return this.notes.filter((n) => n.velocity < velocity);
  }

  fromPitch(pitch: number): EdNote[] {
    return this.notes.filter((n) => n.note >= pitch);
  }

  belowPitch(pitch: number): EdNote[] {
    return this.notes.filter((n) => n.note < pitch);
  }

  /**
   * Notes struck together, highest first. "Together" allows a little spread:
   * a played chord is rarely on one tick.
   */
  chords(tolerance: number): EdNote[][] {
    const sorted = [...this.notes].sort((a, b) => a.tick - b.tick);
    const groups: EdNote[][] = [];
    let start = -Infinity;
    for (const n of sorted) {
      if (n.tick - start > tolerance) {
        groups.push([]);
        start = n.tick;
      }
      groups[groups.length - 1].push(n);
    }
    return groups.map((g) => g.sort((a, b) => b.note - a.note));
  }

  /** The top voice: the highest note of every chord, and the single notes. */
  chordTops(tolerance: number): EdNote[] {
    return this.chords(tolerance).map((g) => g[0]);
  }

  chordRest(tolerance: number): EdNote[] {
    return this.chords(tolerance).flatMap((g) => g.slice(1));
  }

  /**
   * The notes that start while `max` others already sound. Of notes starting
   * together the higher ones take the voices first, so the extra ones picked are
   * the lower ones.
   */
  beyondVoices(max: number): EdNote[] {
    const out: EdNote[] = [];
    let sounding: EdNote[] = [];
    for (const n of [...this.notes].sort((a, b) => a.tick - b.tick || b.note - a.note)) {
      sounding = sounding.filter((o) => o.tick + o.dur > n.tick);
      if (sounding.length >= max) out.push(n);
      else sounding.push(n);
    }
    return out;
  }

  /** Every note on the same key and channel as one of `sample`. */
  sameKeys(sample: EdNote[]): EdNote[] {
    const keys = new Set(sample.map((n) => n.channel * 128 + n.note));
    return this.notes.filter((n) => keys.has(n.channel * 128 + n.note));
  }
}
