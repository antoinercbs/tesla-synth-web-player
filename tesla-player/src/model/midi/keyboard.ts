import { MidNote } from './note';

const WHITE_PER_OCTAVE = 7;

export interface WhiteKey {
  note: number;
  /** 0-based position among the white keys. */
  index: number;
}
export interface BlackKey {
  note: number;
  /** Left edge, in percent of the keyboard width. */
  left: number;
  /** Width, in percent of the keyboard width. */
  width: number;
}
export interface KeyboardLayout {
  whites: WhiteKey[];
  blacks: BlackKey[];
  whiteCount: number;
}

/**
 * The on-screen piano keyboard's window (PianoKeyboard.vue): whole octaves
 * starting on a C, plus the closing C on the right (like a real keyboard ends
 * on a C). White keys are laid out as equal flex columns; black keys are
 * absolutely positioned in PERCENT of the total width, straddling the boundary
 * between their two white neighbours with the slight left/right lean of a real
 * keyboard (C♯/F♯ lean left, D♯/A♯ right, G♯ centred).
 */
export class MidKeyboard {
  static readonly MAX_OCTAVES = 7;
  /** Its first note: a C, the whole window inside the MIDI range. */
  readonly start: number;

  constructor(start: number, readonly octaves: number) {
    this.start = MidKeyboard.clampStart(start, octaves);
  }

  /**
   * How many whole octaves fit in `widthPx` while keeping every white key at least
   * `minWhitePx` wide (1..MAX_OCTAVES). Accounts for the closing C.
   */
  static fit(widthPx: number, minWhitePx: number, max = MidKeyboard.MAX_OCTAVES): number {
    if (!(widthPx > 0) || !(minWhitePx > 0)) return 1;
    const octaves = Math.floor((widthPx / minWhitePx - 1) / WHITE_PER_OCTAVE);
    return Math.max(1, Math.min(max, octaves));
  }

  /**
   * Snap `start` to a C and clamp it so the whole window (start … start+12·octaves)
   * stays inside the MIDI note range.
   */
  static clampStart(start: number, octaves: number): number {
    const maxStart = Math.floor((MidNote.COUNT - 1 - 12 * octaves) / 12) * 12;
    const snapped = Math.round((Number.isFinite(start) ? start : 0) / 12) * 12;
    return Math.max(0, Math.min(maxStart, snapped));
  }

  /** Its last note (the closing C). */
  get end(): number {
    return this.start + 12 * this.octaves;
  }

  /** The window moved by `by` octaves, as far as the range allows. */
  shifted(by: number): MidKeyboard {
    return new MidKeyboard(this.start + 12 * by, this.octaves);
  }

  /** Its keys' positions; `blackRatio` = black-key width as a fraction of a white key. */
  layout(blackRatio = 0.62): KeyboardLayout {
    const { start, end } = this;
    const whites: WhiteKey[] = [];
    const whiteIndex = new Map<number, number>();
    for (let n = start; n <= end; n++) {
      if (MidNote.isBlack(n)) continue;
      whiteIndex.set(n, whites.length);
      whites.push({ note: n, index: whites.length });
    }
    const whiteCount = whites.length;
    const w = 100 / whiteCount;
    const blacks: BlackKey[] = [];
    for (let n = start; n <= end; n++) {
      if (!MidNote.isBlack(n)) continue;
      // n-1 is always a white key (C♯→C, D♯→D, F♯→F, G♯→G, A♯→A)
      const below = whiteIndex.get(n - 1);
      if (below === undefined) continue;
      const pc = ((n % 12) + 12) % 12;
      const lean = pc === 1 || pc === 6 ? -0.08 : pc === 3 || pc === 10 ? 0.08 : 0;
      const centre = (below + 1 + lean) * w;
      const width = w * blackRatio;
      blacks.push({ note: n, left: centre - width / 2, width });
    }
    return { whites, blacks, whiteCount };
  }
}
