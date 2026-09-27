// One colour per MIDI channel, drawn on a canvas (so plain values, not CSS
// variables), distinct from each other on every theme's dark background.
const CHANNEL_COLORS = [
  '#7aa7ff', '#3ddc97', '#c49bff', '#e0a93b', '#ff7eb6', '#4fd1e8', '#ff9f5a', '#b8e05a',
  '#9aa8ff', '#ff6b6b', '#5ee0c1', '#f2d15c', '#d38cff', '#6fb1ff', '#ffa3c4', '#8fd46b',
];

export function channelColor(channel: number): string {
  return CHANNEL_COLORS[((channel % 16) + 16) % 16];
}
