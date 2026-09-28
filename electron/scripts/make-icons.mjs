// Regenerates every logo asset from the glyph drawing (scripts/icons/glyph.mjs):
//   tesla-player/src/assets/logo_tesla_player.svg   sidebar mask (shape only, CSS paints it)
//   tesla-player/public/favicon.svg|.ico, icon.png, icon-maskable.png, apple-touch-icon.png
//   electron/build-assets/icon.svg|.png|.ico
//   electron/src/main.ts                            splash emblem (EMBLEM_STOPS / _VIEWBOX / _PATH)
//
//   npm run icons                 write into the repo
//   npm run icons -- --out <dir>  write everything flat into <dir> instead (to compare)
//
// Three drawings, picked by size: fine turns (≥ 64 px), coarse turns (sidebar,
// 32–48 px), plain (16–24 px). PNGs are rendered by Electron (scripts/icons/render.cjs).
// The colours are the default theme's arc, read from the app's themes/_palettes.scss.
// They are not optimised: run them through a PNG optimiser if size matters.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { bbox, ellD, f, glyph, ringD } from './icons/glyph.mjs';

const here = resolve(fileURLToPath(import.meta.url), '..', '..'); // electron/
const repo = resolve(here, '..');
const outIdx = process.argv.indexOf('--out');
const outDir = outIdx > -1 ? resolve(process.argv[outIdx + 1]) : null;
const target = (rel) => (outDir ? join(outDir, basename(rel)) : join(repo, rel));
const write = (rel, data) => {
  writeFileSync(target(rel), data);
  console.log(rel, typeof data === 'string' ? `${data.length} chars` : `${data.length} B`);
};
const crlf = (s) => s.replace(/\r?\n/g, '\r\n'); // the working copy's line endings

// the default theme's arc (core, mid, deep); the halo is its mid colour, like --arc-glow-rgb
const themesScss = readFileSync(join(repo, 'tesla-player', 'src', 'assets', 'styles', 'themes', '_palettes.scss'), 'utf8');
const defaultTheme = themesScss.match(/^\$default-theme: ([\w-]+);/m)?.[1];
const themeBlock = defaultTheme
  && themesScss.match(new RegExp(`^ {4}${defaultTheme}: \\(([\\s\\S]*?)^ {4}\\),`, 'm'))?.[1];
const arc = themeBlock?.match(/arc: \((#[0-9a-f]{6}), (#[0-9a-f]{6}), (#[0-9a-f]{6})\)/i);
if (!arc) throw new Error('_palettes.scss: the default theme\'s arc was not found');
const [, C1, C2, C3] = arc;
const GLOW = C2;

const big = glyph('fine'), small = glyph('coarse'), tiny = glyph('none');
// all drawings share the big one's frame, so they overlay exactly
const b = bbox(big);
const dx = 256 - (b.x0 + b.x1) / 2, dy = 256 - (b.y0 + b.y1) / 2;
const w = b.x1 - b.x0, h = b.y1 - b.y0;
const vb = `${f(256 - w / 2)} ${f(256 - h / 2)} ${f(w)} ${f(h)}`;
const pathD = (shapes) => shapes.map((s) => {
  if (s.pts) return 'M' + s.pts.map(([x, y]) => `${f(x + dx)} ${f(y + dy)}`).join('L') + 'Z';
  if (s.ring) return ringD(s.ring, dx, dy);
  const [cx, cy, rx, ry, rot] = s.ell;
  return ellD(cx + dx, cy + dy, rx, ry, rot, 1);
}).join('');
const dBig = pathD(big), dSmall = pathD(small), dTiny = pathD(tiny);

const defs = (glow) => `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#18222f"/><stop offset="1" stop-color="#0a0e15"/></linearGradient>
    <linearGradient id="gl" gradientUnits="userSpaceOnUse" x1="0" y1="${f(256 - h / 2)}" x2="0" y2="${f(256 + h / 2)}"><stop offset="0" stop-color="${C1}"/><stop offset=".45" stop-color="${C2}"/><stop offset="1" stop-color="${C3}"/></linearGradient>${glow ? `
    <radialGradient id="halo" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${GLOW}" stop-opacity=".2"/><stop offset="1" stop-color="${GLOW}" stop-opacity="0"/></radialGradient>
    <filter id="blur" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="16"/></filter>` : ''}
  </defs>`;
const mark = (d, k, glow) => `<g transform="translate(256 256) scale(${k}) translate(-256 -256)">${glow ? `
    <path d="${d}" fill="${GLOW}" filter="url(#blur)" opacity=".6"/>` : ''}
    <path d="${d}" fill="url(#gl)"/>
  </g>`;
// rounded tile: app icon (fine drawing + halo) and small sizes / favicon (no halo, bigger glyph)
const tile = (isBig, d = dSmall) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${defs(isBig)}
  <rect x="16" y="16" width="480" height="480" rx="108" fill="url(#bg)" stroke="#78a0cd" stroke-opacity=".22" stroke-width="4"/>${isBig ? `
  <circle cx="256" cy="256" r="210" fill="url(#halo)"/>` : ''}
  ${isBig ? mark(dBig, 0.74, true) : mark(d, 0.84, false)}
</svg>
`;
// full-bleed square for OS-masked icons (PWA maskable, iOS): glyph inside the 80 % safe circle
const bleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${defs(true)}
  <rect width="512" height="512" fill="url(#bg)"/>
  <circle cx="256" cy="256" r="200" fill="url(#halo)"/>
  ${mark(dBig, 0.6, true)}
</svg>
`;
const sidebar = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">
  <path d="${dSmall}"/>
</svg>
`;

// ---- SVG sources
write('tesla-player/src/assets/logo_tesla_player.svg', crlf(sidebar));
write('electron/build-assets/icon.svg', crlf(tile(true)));
write('tesla-player/public/favicon.svg', crlf(tile(false)));

// ---- rasters
const sources = { tile: tile(true), small: tile(false), tiny: tile(false, dTiny), bleed };
const jobs = [
  ['s16', 'tiny', 16], ['s24', 'tiny', 24], ['s32', 'small', 32], ['s48', 'small', 48],
  ['t48', 'small', 48], ['t64', 'tile', 64], ['t128', 'tile', 128], ['t256', 'tile', 256], ['t512', 'tile', 512],
  ['b180', 'bleed', 180], ['b512', 'bleed', 512],
];
const tmp = mkdtempSync(join(tmpdir(), 'tp-icons-'));
try {
  const jobsFile = join(tmp, 'jobs.json'), outFile = join(tmp, 'out.json');
  writeFileSync(jobsFile, JSON.stringify({ sources, jobs }));
  // shells spawned by VS Code inherit ELECTRON_RUN_AS_NODE, which would start Electron as plain Node
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const run = spawnSync(electronPath, [join(here, 'scripts', 'icons', 'render.cjs'), jobsFile, outFile], { stdio: 'inherit', env });
  if (run.status !== 0) throw new Error(`Electron render failed (exit ${run.status})`);
  const png = JSON.parse(readFileSync(outFile, 'utf8'));
  const buf = (k) => Buffer.from(png[k], 'base64');

  // ICO with PNG-compressed entries (Vista+)
  const ico = (entries) => {
    const head = Buffer.alloc(6 + 16 * entries.length);
    head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
    let offset = head.length;
    entries.forEach(([size, data], i) => {
      const o = 6 + 16 * i;
      head[o] = size >= 256 ? 0 : size; head[o + 1] = size >= 256 ? 0 : size; // 0 means 256
      head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
      head.writeUInt32LE(data.length, o + 8); head.writeUInt32LE(offset, o + 12);
      offset += data.length;
    });
    return Buffer.concat([head, ...entries.map((e) => e[1])]);
  };

  write('electron/build-assets/icon.png', buf('t512'));
  write('electron/build-assets/icon.ico', ico([
    [16, buf('s16')], [24, buf('s24')], [32, buf('s32')], [48, buf('t48')],
    [64, buf('t64')], [128, buf('t128')], [256, buf('t256')],
  ]));
  write('tesla-player/public/favicon.ico', ico([[16, buf('s16')], [32, buf('s32')], [48, buf('s48')]]));
  write('tesla-player/public/icon.png', buf('t512'));
  write('tesla-player/public/icon-maskable.png', buf('b512'));
  write('tesla-player/public/apple-touch-icon.png', buf('b180'));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ---- splash emblem in main.ts (fine drawing, same frame)
const mainTs = join(here, 'src', 'main.ts');
let src = readFileSync(mainTs, 'utf8');
const before = src;
src = src.replace(/(const EMBLEM_VIEWBOX = ')[^']*(';)/, `$1${vb}$2`);
src = src.replace(/(const EMBLEM_PATH =\s*')[^']*(';)/, `$1${dBig}$2`);
const stops = `['${C1}', '${C2}', '${C3}']`;
src = src.replace(/(const EMBLEM_STOPS = )\[[^\]]*\](;)/, `$1${stops}$2`);
if (!src.includes(dBig) || !src.includes(`'${vb}'`) || !src.includes(stops)) {
  throw new Error('main.ts: EMBLEM_STOPS / EMBLEM_VIEWBOX / EMBLEM_PATH not found');
}
if (outDir) write('electron/src/main.ts', src);
else if (src !== before) write('electron/src/main.ts', src);
else console.log('electron/src/main.ts unchanged');
