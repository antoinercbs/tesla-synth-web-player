const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

/**
 * A MIDI note number (0…127) and what it is: its name, its equal-temperament
 * pitch, its key's colour. Notes stay plain numbers everywhere (the files, the
 * player, hot loops): the class holds what is said about them.
 */
export class MidNote {
  static readonly COUNT = 128;

  static isBlack(note: number): boolean {
    return BLACK_PITCH_CLASSES.has(((note % 12) + 12) % 12);
  }

  /** Scientific pitch name, middle C (MIDI 60) = "C4". */
  static name(note: number): string {
    return `${NAMES[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`;
  }

  /** Equal-temperament frequency, A4 (69) = 440 Hz. */
  static hz(note: number): number {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  /** The note nearest to `hz`, which may lie outside 0..127. */
  static nearest(hz: number): number {
    return Math.round(69 + 12 * Math.log2(hz / 440));
  }

  /** "131 Hz" above 100 Hz, "65.4 Hz" below (a Tesla coil's firing rate IS the pitch). */
  static hzLabel(hz: number): string {
    return `${hz >= 100 ? Math.round(hz) : hz.toFixed(1)} Hz`;
  }

  /** A note's pitch, as hzLabel says it. */
  static label(note: number): string {
    return MidNote.hzLabel(MidNote.hz(note));
  }
}
