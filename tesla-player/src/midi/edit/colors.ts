// One colour per MIDI channel: the --chan-0…15 tokens (assets/styles/tokens), distinct
// from each other on every theme's dark background.
const CHANNELS = 16;
const index = (channel: number): number => ((channel % CHANNELS) + CHANNELS) % CHANNELS;

/** For a style: a var(), so it follows the theme. */
export function channelColor(channel: number): string {
  return `var(--chan-${index(channel)})`;
}

/** For a canvas, which can't read a var(): the sixteen values as `el` sees them. */
export function channelColors(el: Element): string[] {
  const s = getComputedStyle(el);
  return Array.from({ length: CHANNELS }, (_, i) => s.getPropertyValue(`--chan-${i}`).trim());
}
