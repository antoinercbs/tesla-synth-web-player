import { inject, type InjectionKey } from 'vue';

/**
 * An output's colour, as the CSS variable the active palette tones (each
 * look's, ui/styles/themes/<look>/_palettes.scss): red, yellow, green, cyan,
 * violet, orange, the caps of the board's fibres. A coil wears the colour of
 * the output it is plugged on, never one of its own: swapping the fibres
 * swaps the colours.
 * A var(), not a hex, so every use (styles, SVG fills, gradients) follows the
 * theme; don't do colour maths on it.
 */
export const COIL_COLOR_COUNT = 6;

export function coilColor(index: number): string {
  return `var(--coil-${((index % COIL_COLOR_COUNT) + COIL_COLOR_COUNT) % COIL_COLOR_COUNT})`;
}

/** A coil on no output: no fibre, no colour. */
export const UNPLUGGED_COLOR = 'var(--text-mute)';

/**
 * The colour of a song's coil k: output k's (the player plays places on
 * outputs). The editor, whose k are the song's places, provides each place
 * its coil's output colour instead.
 */
export const PLACE_COLORS: InjectionKey<(k: number) => string> = Symbol('placeColors');
export const useCoilColor = (): ((k: number) => string) => inject(PLACE_COLORS, coilColor);
