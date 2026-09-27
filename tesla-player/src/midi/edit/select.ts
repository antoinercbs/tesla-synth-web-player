import type { TempoMap } from '@/midi/tempo';
import type { EdNote } from './doc';

/** The ways to pick notes from the "Select" menu. Each takes the notes in scope and returns the matching ones. */

export function shorterThan(notes: EdNote[], ms: number, map: TempoMap): EdNote[] {
  return notes.filter((n) => map.toMs(n.tick + n.dur) - map.toMs(n.tick) < ms);
}

export function velocityBelow(notes: EdNote[], velocity: number): EdNote[] {
  return notes.filter((n) => n.velocity < velocity);
}

export function fromPitch(notes: EdNote[], pitch: number): EdNote[] {
  return notes.filter((n) => n.note >= pitch);
}

export function belowPitch(notes: EdNote[], pitch: number): EdNote[] {
  return notes.filter((n) => n.note < pitch);
}

/**
 * Notes struck together, highest first. "Together" allows a little spread:
 * a played chord is rarely on one tick.
 */
export function chords(notes: EdNote[], tolerance: number): EdNote[][] {
  const sorted = [...notes].sort((a, b) => a.tick - b.tick);
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
export function chordTops(notes: EdNote[], tolerance: number): EdNote[] {
  return chords(notes, tolerance).map((g) => g[0]);
}

export function chordRest(notes: EdNote[], tolerance: number): EdNote[] {
  return chords(notes, tolerance).flatMap((g) => g.slice(1));
}

/**
 * The notes that start while `max` others already sound. Of notes starting
 * together the higher ones take the voices first, so the extra ones picked are
 * the lower ones.
 */
export function beyondVoices(notes: EdNote[], max: number): EdNote[] {
  const out: EdNote[] = [];
  let sounding: EdNote[] = [];
  for (const n of [...notes].sort((a, b) => a.tick - b.tick || b.note - a.note)) {
    sounding = sounding.filter((o) => o.tick + o.dur > n.tick);
    if (sounding.length >= max) out.push(n);
    else sounding.push(n);
  }
  return out;
}

/** Every note on the same key and channel as one of `sample`. */
export function sameKeys(notes: EdNote[], sample: EdNote[]): EdNote[] {
  const keys = new Set(sample.map((n) => n.channel * 128 + n.note));
  return notes.filter((n) => keys.has(n.channel * 128 + n.note));
}
