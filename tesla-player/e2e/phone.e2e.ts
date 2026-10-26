import { test, expect } from './fixtures';
import { SynthTap } from './synth-tap';

// the phone project (playwright.config.ts) runs this file alone
test.describe('Phone', () => {
  test('the bottom bar leads to the pages, its menu to the arc meter', async ({ page }) => {
    await page.goto('/play');
    const bar = page.locator('.sidebar');
    const box = (await bar.boundingBox())!;
    expect(box.y + box.height).toBeCloseTo(page.viewportSize()!.height, 0);
    await bar.getByRole('link', { name: 'Edit' }).click();
    await expect(page).toHaveURL(/\/edit$/);
    await bar.getByRole('button', { name: 'More options' }).click();
    await page.getByRole('menuitem', { name: 'Arc meter' }).click();
    await expect(page).toHaveURL(/\/tune\/meter$/);
  });

  test('a song plays', async ({ page }) => {
    await page.goto('/play');
    await page.getByRole('button', { name: 'Choose a song' }).click();
    await page.locator('.play-row', { hasText: 'Korobeiniki' }).locator('.row-btn--play').click();
    const tap = await SynthTap.install(page);
    const play = page.locator('.player-dock__play');
    await play.click();
    await expect(play).toHaveAttribute('aria-label', 'Pause');
    await expect.poll(() => tap.noteOns()).toBeGreaterThan(10);
  });
});
