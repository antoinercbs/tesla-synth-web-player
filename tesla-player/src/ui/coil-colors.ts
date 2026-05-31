/**
 * Per-coil identity colours (mirrors the --coil-* CSS variables in main.scss).
 * Used by the editor cards and, later, the colour-coded score preview, so a
 * coil keeps the same colour everywhere in the app.
 */
export const COIL_COLORS = [
  '#ff4d6d', // coil 0 — hot pink
  '#ffd23f', // coil 1 — amber
  '#3ddc97', // coil 2 — green
  '#4cc9f0', // coil 3 — cyan
  '#b15cff', // coil 4 — violet
  '#ff8c42', // coil 5 — orange
] as const;

export function coilColor(index: number): string {
  return COIL_COLORS[((index % COIL_COLORS.length) + COIL_COLORS.length) % COIL_COLORS.length];
}
