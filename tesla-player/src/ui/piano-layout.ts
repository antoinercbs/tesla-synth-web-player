/**
 * Pure geometry for the on-screen piano keyboard (PianoKeyboard.vue).
 *
 * The keyboard shows whole octaves starting on a C, plus the closing C on the
 * right (like a real keyboard ends on a C). White keys are laid out as equal
 * flex columns; black keys are absolutely positioned in PERCENT of the total
 * width, straddling the boundary between their two white neighbours with the
 * slight left/right lean of a real keyboard (C♯/F♯ lean left, D♯/A♯ right,
 * G♯ centred).
 */

export const MIDI_NOTE_COUNT = 128;
export const MAX_OCTAVES = 7;
const WHITE_PER_OCTAVE = 7;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

export function isBlackKey(note: number): boolean {
  return BLACK_PITCH_CLASSES.has(((note % 12) + 12) % 12);
}

/** Scientific pitch name, middle C (MIDI 60) = "C4". */
export function noteName(note: number): string {
  return `${NAMES[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`;
}

/** Equal-temperament frequency of a MIDI note, A4 (69) = 440 Hz. */
export function noteFrequency(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/** "131 Hz" above 100 Hz, "65.4 Hz" below (a Tesla coil's firing rate IS the pitch). */
export function noteHzLabel(note: number): string {
  const f = noteFrequency(note);
  return `${f >= 100 ? Math.round(f) : f.toFixed(1)} Hz`;
}

/** Last note of a window of `octaves` octaves starting at `start` (the closing C). */
export function endNote(start: number, octaves: number): number {
  return start + 12 * octaves;
}

/**
 * How many whole octaves fit in `widthPx` while keeping every white key at least
 * `minWhitePx` wide (1..MAX_OCTAVES). Accounts for the closing C.
 */
export function fitOctaves(widthPx: number, minWhitePx: number, max = MAX_OCTAVES): number {
  if (!(widthPx > 0) || !(minWhitePx > 0)) return 1;
  const octaves = Math.floor((widthPx / minWhitePx - 1) / WHITE_PER_OCTAVE);
  return Math.max(1, Math.min(max, octaves));
}

/**
 * Snap `start` to a C and clamp it so the whole window (start … start+12·octaves)
 * stays inside the MIDI note range.
 */
export function clampStart(start: number, octaves: number): number {
  const maxStart = Math.floor((MIDI_NOTE_COUNT - 1 - 12 * octaves) / 12) * 12;
  const snapped = Math.round((Number.isFinite(start) ? start : 0) / 12) * 12;
  return Math.max(0, Math.min(maxStart, snapped));
}

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
 * Key positions for a window starting on the C `start` spanning `octaves`
 * octaves (+ closing C). `blackRatio` = black-key width as a fraction of a white key.
 */
export function keyboardLayout(start: number, octaves: number, blackRatio = 0.62): KeyboardLayout {
  const end = endNote(start, octaves);
  const whites: WhiteKey[] = [];
  const whiteIndex = new Map<number, number>();
  for (let n = start; n <= end; n++) {
    if (isBlackKey(n)) continue;
    whiteIndex.set(n, whites.length);
    whites.push({ note: n, index: whites.length });
  }
  const whiteCount = whites.length;
  const w = 100 / whiteCount;
  const blacks: BlackKey[] = [];
  for (let n = start; n <= end; n++) {
    if (!isBlackKey(n)) continue;
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
