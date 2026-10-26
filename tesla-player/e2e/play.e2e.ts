import { test, expect } from './fixtures';
import { SynthTap } from './synth-tap';
import type { Page } from '@playwright/test';

async function loadSong(page: Page, name: string): Promise<void> {
  await page.goto('/play');
  await page.getByRole('button', { name: 'Choose a song' }).click();
  await page.locator('.play-row', { hasText: name }).locator('.row-btn--play').click();
  await expect(page.locator('.player-progress__time').last()).not.toHaveText('0:00');
}

test.describe('Play', () => {
  test('a song plays on the synth, pauses, seeks and stops', async ({ page }) => {
    await loadSong(page, 'Korobeiniki');
    const tap = await SynthTap.install(page);
    const play = page.locator('.player-dock__play');
    const seek = page.getByRole('slider', { name: 'Seek' });

    await play.click();
    await expect(play).toHaveAttribute('aria-label', 'Pause');
    await expect.poll(() => tap.noteOns()).toBeGreaterThan(10);
    await expect(seek).not.toHaveAttribute('aria-valuenow', '0');

    await play.click();
    await expect(play).toHaveAttribute('aria-label', 'Play');
    // what was scheduled ahead is sent already: nothing more once paused
    const paused = await tap.noteOns();
    await page.waitForTimeout(1500);
    expect(await tap.noteOns()).toBe(paused);

    const at = Number(await seek.getAttribute('aria-valuenow'));
    await seek.focus();
    await page.keyboard.press('PageUp');
    await expect(seek).toHaveAttribute('aria-valuenow', String(at + 30));

    // the page's Space, out of the slider that keeps its keys
    await seek.blur();
    await page.keyboard.press('Space');
    await expect(play).toHaveAttribute('aria-label', 'Pause');
    await expect.poll(() => tap.noteOns()).toBeGreaterThan(paused);

    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(play).toHaveAttribute('aria-label', 'Play');
    await expect(seek).toHaveAttribute('aria-valuenow', '0');
  });

  test('the load lanes share the height of the panel', async ({ page }) => {
    await loadSong(page, 'Korobeiniki');
    await page.locator('.player-viz__tabs button', { hasText: 'Load' }).click();
    const lanes = page.locator('.cload__lanes');
    await expect(page.locator('.cload__plot svg')).toHaveCount(3);
    const plots = await page.locator('.cload__plot svg').evaluateAll((svgs) => svgs.reduce((h, s) => h + s.getBoundingClientRect().height, 0));
    const room = (await lanes.boundingBox())!.height;
    expect(plots).toBeGreaterThan(room * 0.7);
  });
});
