import { test, expect } from './fixtures';
import { plugFakeBoard } from './board';

test('the Syntherrupter page reads the board plugged in', async ({ page }) => {
  await page.goto('/play');
  await plugFakeBoard(page);
  await page.getByRole('link', { name: 'Syntherrupter' }).click();
  await expect(page).toHaveURL(/\/syntherrupter$/);
  await expect(page.getByText('4.2.2').first()).toBeVisible();
});
