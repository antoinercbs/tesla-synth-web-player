import { test, expect } from './fixtures';

test('a playlist reordered, a song added and one removed, saved', async ({ page, api }) => {
  await page.goto('/playlists/9101');
  const queue = page.locator('.pl-row--queue .pl-row__name');
  await expect(queue).toHaveText(['Korobeiniki (Tetris)', 'Ode to Joy', 'In the Hall of the Mountain King']);

  await page.locator('.pl-row:not(.pl-row--queue)', { hasText: 'Für Elise' }).getByRole('button', { name: 'Add to the playlist' }).click();
  await page.locator('.pl-row--queue', { hasText: 'Ode to Joy' }).getByRole('button', { name: 'Move up' }).click();
  await page.locator('.pl-row--queue', { hasText: 'Mountain King' }).getByRole('button', { name: 'Remove from playlist' }).click();
  await expect(queue).toHaveText(['Ode to Joy', 'Korobeiniki (Tetris)', 'Für Elise']);

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => api.sent('PUT', '/api/playlists/9101')).toEqual([expect.objectContaining({ songIds: [9002, 9001, 9003] })]);
});
