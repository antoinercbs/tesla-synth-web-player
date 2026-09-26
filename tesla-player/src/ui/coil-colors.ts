/**
 * A coil's identity colour, as the CSS variable the active theme tones
 * (assets/styles/_themes.scss): red, yellow, green, cyan, violet, orange.
 * A var(), not a hex, so every use (styles, SVG fills, gradients) follows the
 * theme; don't do colour maths on it.
 */
export const COIL_COLOR_COUNT = 6;

export function coilColor(index: number): string {
  return `var(--coil-${((index % COIL_COLOR_COUNT) + COIL_COLOR_COUNT) % COIL_COLOR_COUNT})`;
}
