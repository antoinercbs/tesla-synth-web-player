// Takes the showcase site's screenshots of the app (src/assets/site/shots/<locale>/*.webp).
//
// The app runs on the guided tour's sample library (public-domain tunes, the
// Zeus, Thor and Raijin coils): never on a real library, whose titles may not be
// shown publicly. Run the dev servers first (docs/development.md), then:
//
//   npm run shots                      # every language, every look
//   npm run shots -- --locale fr       # one language
//
// It drives the Chrome installed on this computer (playwright-core, no browser
// download); CHROME_PATH points it at another Chromium. APP_URL changes the dev
// server's address (default http://localhost:8080).
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const APP = process.env.APP_URL ?? 'http://localhost:8080';
const OUT = new URL('../src/assets/site/shots/', import.meta.url);
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const LOCALES = arg('locale') ? [arg('locale')] : ['fr', 'en'];
// the looks of the features page's gallery (SITE_LOOKS, src/site/shots.ts)
const LOOKS = ['lab', 'control', 'v1', 'term', 'web1', 'scope', 'blueprint'];
const ALL_TOURS = ['main', 'play', 'edit', 'playlists', 'midi', 'midiEdit', 'envelopes', 'tune', 'syntherrupter'];
// the demo library's ids (src/tour/demo/data.ts)
const SONG = 9001, FILE = 9201, ENVELOPE = 20;

const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// the encoder in a window of its own: a page sent to the background stops its animations
const encoder = await (await browser.newContext()).newPage();
const page = await context.newPage();
await page.bringToFront();

/** PNG → WebP through the browser's own encoder: a fraction of the size, no image tool needed. */
async function save(png, locale, key) {
  const dataUrl = await encoder.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/webp', 0.86);
  }, png.toString('base64'));
  const dir = new URL(`${locale}/`, OUT);
  await mkdir(dir, { recursive: true });
  await writeFile(new URL(`${key}.webp`, dir), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`  ${locale}/${key}.webp`);
}

const wait = (ms) => page.waitForTimeout(ms);
const go = async (path) => {
  await page.evaluate((p) => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(p), path);
  await wait(1300);
};

/** This language and look, the tours seen (no welcome dialog), the player as the shots want it. */
async function prepare(locale, skin, path) {
  await page.goto(`${APP}${path}`);
  await page.evaluate(({ locale, skin, tours }) => {
    localStorage.setItem('locale', locale);
    localStorage.setItem('skin', skin);
    localStorage.setItem('tourSeen', '1');
    localStorage.setItem('pageToursSeen', JSON.stringify(tours));
    localStorage.setItem('synthModel', 'tesla');
    localStorage.setItem('playerViz', 'lanes');
    localStorage.setItem('playMode', 'playback');
    localStorage.removeItem('sidebarCompact');
  }, { locale, skin, tours: ALL_TOURS });
  await page.reload();
  await wait(2000);
}

/** A fresh start in this language and look, on the tour's library. */
async function start(locale, skin = 'lab') {
  await prepare(locale, skin, '/play');
  await page.evaluate(async (l) => (await import('/src/tour/demo/demo-mode.ts')).enterDemo(l), locale);
  await wait(500);
  // mounted again, the play page reads the demo's settings
  await go('/playlists');
  await go('/play');
}

/** Korobeiniki, a few seconds in. */
async function playFirstSong() {
  await page.locator('.play-row .row-btn--play').first().click();
  await wait(700);
  await page.locator('.player-transport .btn--volt').first().click();
  await wait(3200);
}
async function panic() {
  await page.keyboard.press('Escape');
  await wait(300);
}

/**
 * A tuning trial running, the tour's phone filming the coil beside it: the
 * Tuning page's tour played up to its second trial, its card and veil hidden.
 * Last of a language: leaving the tour ends the demo.
 */
async function tuningTrial(locale) {
  // a fresh page: the tour puts its demo on itself
  await prepare(locale, 'lab', '/tune');
  // the page's own "?" button: the tour module the app holds
  await page.locator('.page-tour').first().click();
  await wait(2500);
  // the tour's veil catches the pointer: its clicks go through the DOM
  const domClick = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);
  // the tour asks twice to fire the coil: the first is let go, the second runs and is the shot
  let asked = 0;
  for (let i = 0; i < 40; i++) {
    if (await page.locator('.modal-card--confirm .btn--danger').count() && ++asked === 2) {
      await domClick('.modal-card--confirm .btn--danger');
      break;
    }
    const next = page.locator('.tour__card [data-primary]:not(:disabled)');
    await next.waitFor({ timeout: 40000 });
    await next.click();
    await wait(1400);
  }
  await wait(3500);
  await page.addStyleTag({ content: '.tour__card, .tour__block, .tour__hole, .tour__cursor, .fphone__caption { visibility: hidden !important; }' });
  await wait(300);
  await save(await page.screenshot(), locale, 'tune');
  await domClick('.tour__x');
  await wait(1500);
}

// --tune-only: that shot alone (it is the longest to set up); --looks-only: the gallery's
const TUNE_ONLY = process.argv.includes('--tune-only');
const LOOKS_ONLY = process.argv.includes('--looks-only');
for (const locale of LOCALES) {
  console.log(`[${locale}]`);
  if (TUNE_ONLY) {
    await tuningTrial(locale);
    continue;
  }
  if (LOOKS_ONLY) {
    for (const skin of LOOKS) {
      await start(locale, skin);
      await playFirstSong();
      await save(await page.screenshot(), locale, `look-${skin}`);
      await panic();
    }
    continue;
  }
  await start(locale);
  await playFirstSong();
  await save(await page.screenshot(), locale, 'play');

  // the synth: the output menu and its timbre, cropped around them
  await page.locator('.sidebar-out').first().click();
  await wait(600);
  const row = await page.locator('.sidebar-out').first().boundingBox();
  const menu = await page.locator('.sidebar-menu--output').boundingBox();
  const top = Math.max(0, Math.min(row.y, menu.y) - 120);
  await save(await page.screenshot({ clip: { x: 0, y: top, width: Math.min(1440, menu.x + menu.width + 260), height: Math.min(900 - top, Math.max(row.y + row.height, menu.y + menu.height) + 60 - top) } }), locale, 'synth');
  await page.keyboard.press('Escape');
  await panic();

  await go(`/edit/${SONG}`);
  await save(await page.screenshot(), locale, 'edit');
  await go('/playlists');
  await save(await page.screenshot(), locale, 'playlists');
  await go(`/midi/${FILE}/edit`);
  await save(await page.screenshot(), locale, 'midi-edit');
  await go(`/envelopes/${ENVELOPE}`);
  await save(await page.screenshot(), locale, 'envelopes');
  await go('/syntherrupter');
  await wait(800);
  await save(await page.screenshot(), locale, 'syntherrupter');
  await go('/play');
  await page.locator('.mode-switch button').nth(1).click();
  await wait(1200);
  await save(await page.screenshot(), locale, 'live');
  await page.locator('.mode-switch button').first().click();

  await tuningTrial(locale);

  for (const skin of LOOKS) {
    await start(locale, skin);
    await playFirstSong();
    await save(await page.screenshot(), locale, `look-${skin}`);
    await panic();
  }
}

// leave the browser profile as the default look would
await page.evaluate(() => localStorage.removeItem('skin'));
await browser.close();
