import { mkdir, writeFile } from 'node:fs/promises';
import type { Browser, Page } from '@playwright/test';
import { test, expect } from './fixtures';

/*
 * Not a test: the showcase site's screenshots of the app (src/site/shots/<locale>/*.webp) and the
 * guides' (docs/img/*.webp, in English like them), on the guided tour's sample library
 * (public-domain tunes, the Zeus, Thor and Raijin coils), never on a real one: its titles may not
 * be shown publicly. `npm run shots`, on the fake API: no backend needed. SHOTS_LOCALE=fr for one
 * language, SHOTS=play,coil for some shots only.
 */
const OUT = new URL('../src/site/shots/', import.meta.url);
const DOCS = new URL('../../docs/img/', import.meta.url);
type Clip = { x: number; y: number; width: number; height: number };
const LOCALES = process.env.SHOTS_LOCALE ? [process.env.SHOTS_LOCALE] : ['fr', 'en'];
const ONLY = (process.env.SHOTS ?? '').split(',').filter(Boolean);
const wanted = (key: string): boolean => !ONLY.length || ONLY.includes(key);
// the features page's gallery (SITE_LOOKS, src/site/shots.ts)
const LOOKS = ['lab', 'control', 'v1', 'term', 'web1', 'scope', 'blueprint'];
// the sample library's ids (src/app/demo/data.ts); its scene poses the coils on a concert stage
const SONG = 9001, PLAYLIST = 9101, ENVELOPE = 20, COIL = 9601, SCENE = 'tour-demo-scene-0';

/** One language's shots: the app on the sample library, each page saved as WebP. */
class Shooter {
  private encoder: Page | null = null;

  constructor(private readonly page: Page, private readonly browser: Browser, private readonly locale: string) {}

  /** The app on the tour's library, in this language, a page of it open; `keepBoard`: the offer to update the board left up. */
  async start(path = '/play', keepBoard = false): Promise<void> {
    await this.page.goto('/play');
    // a cold dev server compiles the page on its first visit
    await expect(this.page.locator('.player-dock__play')).toBeVisible({ timeout: 60_000 });
    // the app's own data first: answering after the demo's, it would take its place
    await this.page.waitForLoadState('networkidle');
    const demo = { mod: '/src/app/demo/demo-mode.ts', l: this.locale };
    // the app's own module, as the dev server serves it
    await this.page.evaluate(async ({ mod, l }) => (await import(/* @vite-ignore */ mod)).demoMode.enter(l), demo);
    // mounted again, the play page reads the demo's settings
    await this.go('/playlists');
    await this.page.evaluate(async ({ mod }) => (await import(/* @vite-ignore */ mod)).demoMode.reassert(), demo);
    await this.go('/play');
    // the demo's board differs from its sheets: the player's offer to update it is let go
    if (!keepBoard) await this.ignoreBoard();
    if (path !== '/play') await this.go(path);
  }

  async ignoreBoard(): Promise<void> {
    const ignore = this.page.locator('.player-alert--board .player-alert__acts .btn').last();
    if (await ignore.isVisible().catch(() => false)) await ignore.click();
  }

  /** Around an element, a margin of the page about it. */
  async around(selector: string, margin = 12): Promise<Clip> {
    const b = (await this.page.locator(selector).first().boundingBox())!;
    const x = Math.max(0, b.x - margin), y = Math.max(0, b.y - margin);
    return { x, y, width: Math.min(1440 - x, b.width + 2 * margin), height: Math.min(900 - y, b.height + 2 * margin) };
  }

  /** The bottom of the page: the atelier's tool under its score. */
  async toBottom(): Promise<void> {
    await this.page.evaluate(() => document.querySelector('.app-main')?.scrollTo(0, 1e6));
    await this.page.waitForTimeout(600);
  }

  /** In the app, as its links go: a reload would leave the demo. */
  async go(path: string): Promise<void> {
    await this.page.evaluate((p) => (document.querySelector('#app') as unknown as { __vue_app__: { config: { globalProperties: { $router: { push(p: string): Promise<unknown> } } } } })
      .__vue_app__.config.globalProperties.$router.push(p), path);
    // the pages scroll inside the shell, which keeps its place from one page to the next
    await this.page.evaluate(() => document.querySelector('.app-main')?.scrollTo(0, 0));
    await this.page.waitForTimeout(1500);
  }

  /** The first song of the library, a few seconds in, in one of the player's views (0 score … 3 the 3D). */
  async playFirstSong(view: number): Promise<void> {
    await this.page.locator('.player-viz__tabs button').nth(view).click();
    await this.page.locator('.player-viz__pick').click();
    await this.page.locator('.play-row .row-btn--play').first().click();
    await this.page.locator('.player-dock__play').click();
    await this.page.waitForTimeout(3500);
  }

  async panic(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(300);
  }

  /** A shot of the site's, in this language. */
  async save(key: string, clip?: Clip): Promise<void> {
    await this.write(new URL(`${this.locale}/`, OUT), key, clip);
  }

  /** A shot of the guides'. */
  async saveDoc(key: string, clip?: Clip): Promise<void> {
    await this.write(DOCS, key, clip);
  }

  /** PNG → WebP through the browser's own encoder: a fraction of the size, no image tool needed. */
  private async write(dir: URL, key: string, clip?: Clip): Promise<void> {
    if (!wanted(key)) return;
    const png = await this.page.screenshot({ clip });
    this.encoder ??= await (await this.browser.newContext()).newPage();
    const dataUrl = await this.encoder.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d')!.drawImage(img, 0, 0);
      return c.toDataURL('image/webp', 0.86);
    }, png.toString('base64'));
    await mkdir(dir, { recursive: true });
    await writeFile(new URL(`${key}.webp`, dir), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`  ${dir.pathname.split('/').slice(-2, -1)[0]}/${key}.webp`);
  }
}

for (const locale of LOCALES) {
  test.describe(locale, () => {
    // the player's 3D in the sample library's scene; the coil sheet keeps its close-up
    test.use({ storage: { locale, 'scene3d.play': SCENE } });
    test.setTimeout(300_000);

    test('the pages', async ({ page, browser }) => {
      const s = new Shooter(page, browser, locale);
      await s.start();
      await s.playFirstSong(3);
      await s.save('play');

      // the synth: the output menu and its timbre, cropped around them
      await page.locator('.sidebar-out').first().click();
      const row = (await page.locator('.sidebar-out').first().boundingBox())!;
      const menu = (await page.locator('.sidebar-menu--output').boundingBox())!;
      const top = Math.max(0, Math.min(row.y, menu.y) - 120);
      await s.save('synth', {
        x: 0, y: top, width: Math.min(1440, menu.x + menu.width + 260),
        height: Math.min(900 - top, Math.max(row.y + row.height, menu.y + menu.height) + 60 - top),
      });
      await page.keyboard.press('Escape');
      await s.panic();

      await s.go('/play');
      await page.locator('.mode-switch--play button').nth(1).click();
      await page.waitForTimeout(1200);
      await s.save('live');
      await page.locator('.mode-switch--play button').first().click();

      await s.go(`/edit/${SONG}`);
      // a song already set opens on its coils once loaded: the Assistant's tab clicked until it stays
      await expect(async () => {
        await page.locator('.atelier__tool[data-tool="assist"]').click();
        await expect(page.locator('.assist')).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 20_000 });
      await page.waitForTimeout(1500);
      // the Assistant's pads under the score
      await page.locator('.assist').evaluate((el) => el.scrollIntoView({ block: 'end' }));
      await page.waitForTimeout(500);
      await s.save('edit');
      await s.go(`/coils/${COIL}`);
      await expect(page.locator('.oruler')).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(2500);
      await s.save('coil');
      await s.go(`/playlists/${PLAYLIST}`);
      await s.save('playlists');
      await s.go(`/edit/${SONG}/midi`);
      await s.save('midi-edit');
      await s.go(`/envelopes/${ENVELOPE}`);
      await s.save('envelopes');
      await s.go('/syntherrupter');
      await page.waitForTimeout(800);
      await s.save('syntherrupter');
    });

    /*
     * A tuning trial running, the tour's phone filming the coil beside it: the Tuning page's
     * tour played up to its second trial, its card and veil hidden.
     */
    test('a tuning trial', async ({ page, browser }) => {
      test.skip(!wanted('tune'));
      const s = new Shooter(page, browser, locale);
      // the dev server reloads the page the first time it serves the 3D (its dependencies optimized):
      // a coil sheet first, so the tour's phone doesn't take the tour down with it
      await page.goto(`/coils/${COIL}`);
      await expect(page.locator('.oruler')).toBeVisible({ timeout: 60_000 });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      await expect(async () => {
        await page.goto('/tune');
        await page.locator('.page-tour').first().click();
        await expect(page.locator('.tour__card')).toBeVisible({ timeout: 15_000 });
      }).toPass({ timeout: 120_000 });
      await page.waitForTimeout(2500);
      // the tour's veil catches the pointer: its clicks go through the DOM
      const domClick = (sel: string) => page.evaluate((x) => (document.querySelector(x) as HTMLElement | null)?.click(), sel);
      // the tour asks twice to fire the coil: the first is let go, the second runs and is the shot
      let asked = 0;
      for (let i = 0; i < 40; i++) {
        if (await page.locator('.modal-card--confirm .btn--danger').count() && ++asked === 2) {
          await domClick('.modal-card--confirm .btn--danger');
          break;
        }
        const next = page.locator('.tour__card [data-primary]:not(:disabled)');
        await next.waitFor({ timeout: 40_000 });
        await next.click();
        await page.waitForTimeout(1400);
      }
      await page.waitForTimeout(3500);
      await page.addStyleTag({ content: '.tour__card, .tour__block, .tour__hole, .tour__cursor, .fphone__caption { visibility: hidden !important; }' });
      await page.waitForTimeout(300);
      await s.save('tune');
      if (locale === 'en') await s.saveDoc('tuning-trial');
      await domClick('.tour__x');
    });

    // the guides are in English: their shots too
    if (locale === 'en') {
      test('the guides', async ({ page, browser }) => {
        const s = new Shooter(page, browser, locale);
        await s.start('/play', true);
        await page.waitForTimeout(800);
        await s.saveDoc('board-update', await s.around('.player-alert--board'));
        await s.ignoreBoard();
        await s.playFirstSong(2);
        // the coils' lanes and the strips' lights: the simulation, worked out off the page's thread
        await expect(page.locator('.preview__rail-lane').first()).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(1500);
        await s.saveDoc('player');
        await s.saveDoc('power', await s.around('.strips', 6));
        await page.locator('.sidebar-out').first().click();
        const row = (await page.locator('.sidebar-out').first().boundingBox())!;
        const menu = (await page.locator('.sidebar-menu--output').boundingBox())!;
        const top = Math.max(0, Math.min(row.y, menu.y) - 40);
        await s.saveDoc('outputs', {
          x: 0, y: top, width: Math.min(1440, menu.x + menu.width + 24),
          height: Math.min(900 - top, Math.max(row.y + row.height, menu.y + menu.height) + 24 - top),
        });
        await page.keyboard.press('Escape');
        await s.panic();

        await s.go(`/edit/${SONG}`);
        await s.saveDoc('atelier');
        await page.locator('.atelier__way-btn').click();
        await page.waitForTimeout(500);
        const btn = (await page.locator('.atelier__way-btn').boundingBox())!;
        const ways = (await page.locator('.atelier__way-menu').boundingBox())!;
        const left = Math.max(0, Math.min(btn.x, ways.x) - 16);
        await s.saveDoc('variants', {
          x: left, y: Math.max(0, btn.y - 16),
          width: Math.max(btn.x + btn.width, ways.x + ways.width) + 16 - left, height: ways.y + ways.height - btn.y + 32,
        });
        await page.keyboard.press('Escape');
        for (const [tool, key] of [['coils', 'coils-tool'], ['space', 'space'], ['dyn', 'dynamics']] as const) {
          await page.locator(`.atelier__tool[data-tool="${tool}"]`).click();
          await page.waitForTimeout(1200);
          await s.toBottom();
          await s.saveDoc(key);
        }
        await expect(async () => {
          await page.locator('.atelier__tool[data-tool="assist"]').click();
          await expect(page.locator('.assist')).toBeVisible({ timeout: 1000 });
        }).toPass({ timeout: 20_000 });
        await page.waitForTimeout(1500);
        await page.locator('.assist').evaluate((el) => el.scrollIntoView({ block: 'end' }));
        await page.waitForTimeout(500);
        await s.saveDoc('assistant');

        await s.go(`/playlists/${PLAYLIST}`);
        await s.saveDoc('playlist');
        await s.go(`/edit/${SONG}/midi`);
        await page.locator('.me-chan__name').first().click();
        await page.waitForTimeout(800);
        await s.saveDoc('midi-editor');
        await s.go(`/envelopes/${ENVELOPE}`);
        await s.saveDoc('envelopes');
        await s.go('/coils');
        await s.saveDoc('coils');
        await s.go(`/coils/${COIL}`);
        await expect(page.locator('.oruler')).toBeVisible({ timeout: 20_000 });
        await page.waitForTimeout(2500);
        await s.saveDoc('coil-sheet');
        await s.go(`/coils/${COIL}/calculs`);
        await page.waitForTimeout(1500);
        await s.saveDoc('calculations');
        await s.go('/coils/scenes/9701');
        await page.waitForTimeout(3000);
        await s.saveDoc('scene');
        await s.go('/syntherrupter');
        await page.waitForTimeout(800);
        await s.saveDoc('syntherrupter');
      });
    }

    test('the looks', async ({ page, browser }) => {
      const s = new Shooter(page, browser, locale);
      for (const skin of LOOKS) {
        if (!wanted(`look-${skin}`)) continue;
        await page.goto('/play');
        await page.evaluate((k) => localStorage.setItem('skin', k), skin);
        await s.start();
        await s.playFirstSong(2);
        await s.save(`look-${skin}`);
        await s.panic();
      }
    });
  });
}
