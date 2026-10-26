/**
 * A colour token (`--line`, `--text-mute`…) as the browser resolves it now,
 * as `rgb(r,g,b)`: for a picture drawn outside CSS (three.js) that should
 * follow the palette.
 */
export function tokenColor(name: string): string {
  const probe = document.createElement('span');
  probe.style.color = `var(${name})`;
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  const n = c.match(/[\d.]+/g)?.map(Number) ?? [128, 128, 128];
  // color(srgb r g b) gives 0..1
  const k = c.startsWith('color(') ? 255 : 1;
  return `rgb(${n.slice(0, 3).map((v) => Math.round(v * k)).join(',')})`;
}
