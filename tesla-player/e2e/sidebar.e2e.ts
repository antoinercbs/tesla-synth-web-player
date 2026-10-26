import { test, expect } from './fixtures';

test.describe('Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/play');
  });

  test('collapsed, it stays so after a reload', async ({ page }) => {
    await page.getByRole('button', { name: 'Collapse' }).click();
    await expect(page.getByRole('button', { name: 'Expand' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Expand' })).toBeVisible();
  });

  test('the coils output menu sets the synth timbre', async ({ page }) => {
    await page.locator('.sidebar-out--coils').click();
    await page.getByLabel('Timbre').selectOption('pulse');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('synthModel'))).toBe('pulse');
    await page.keyboard.press('Escape');
    await expect(page.locator('body > .sidebar-menu')).toHaveCount(0);
  });

  test('the language changes from the footer menu', async ({ page }) => {
    await page.getByRole('button', { name: 'More options' }).click();
    await page.getByRole('menu').getByRole('group', { name: 'Language' }).getByRole('button', { name: /fr/i }).click();
    await expect(page.getByRole('link', { name: 'Lecture' })).toBeVisible();
  });
});

test.describe('Sidebar, beginner', () => {
  test.use({ storage: { uiMode: 'beginner' } });

  test('the badge switches to expert', async ({ page }) => {
    await page.goto('/play');
    await page.locator('.sidebar-level').click();
    await expect(page.locator('.sidebar-level')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('uiMode'))).toBe('expert');
  });
});
