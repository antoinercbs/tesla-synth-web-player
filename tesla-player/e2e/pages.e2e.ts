import { test, expect } from './fixtures';

// every page of the app on the sample library (src/app/demo/data.ts ids), the
// Syntherrupter's aside (board.e2e.ts: it needs a board): each opens and stays,
// and the fixtures fail it on any error in the page
const PAGES = [
  '/play', '/edit', '/edit/9001', '/edit/9001/midi', '/playlists', '/playlists/9101', '/envelopes', '/envelopes/20',
  '/coils', '/coils/9601', '/coils/9601/calculs', '/coils/scenes', '/tune', '/styleguide', '/about',
];

for (const path of PAGES) {
  test(`${path} opens`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('#app').getByRole('heading').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL((url) => url.pathname === path);
  });
}
