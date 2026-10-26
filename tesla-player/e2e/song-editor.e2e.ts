import { test, expect } from './fixtures';

type SongBody = { name: string; coils: { coilIndex: number; ontimeUs: number }[]; tagIds: number[] };

test.describe('Song editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/edit/9001');
    await page.getByRole('tab', { name: 'Coils', exact: true }).click();
  });

  test('a song renamed and its coil set, undone, redone, saved', async ({ page, api }) => {
    await page.getByRole('button', { name: 'Rename the song' }).click();
    const name = page.getByRole('textbox', { name: 'Song name' });
    await name.fill('Tetris night');
    await name.press('Enter');
    await expect(page.getByRole('heading', { name: 'Tetris night' })).toBeVisible();

    const ontime = page.getByRole('spinbutton', { name: 'Treble · ontime (µs)' }).first();
    await expect(ontime).toHaveValue('45');
    await ontime.fill('77');
    await ontime.press('Tab');
    await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click();
    await expect(ontime).toHaveValue('45');
    await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)' }).click();
    await expect(ontime).toHaveValue('77');

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.editor-dirty')).toBeHidden();
    const [body] = api.sent('PUT', '/api/songs/9001') as SongBody[];
    expect(body.name).toBe('Tetris night');
    expect(body.coils[0].ontimeUs).toBe(77);
    expect(body.tagIds).toEqual([9301, 9304]);
  });

  test('leaving unsaved changes asks first, and discarding saves nothing', async ({ page, api }) => {
    const ontime = page.getByRole('spinbutton', { name: 'Treble · ontime (µs)' }).first();
    await ontime.fill('77');
    await ontime.press('Tab');
    await expect(page.locator('.editor-dirty')).toBeVisible();

    const leave = page.getByRole('link', { name: 'Play', exact: true });
    const ask = page.getByRole('dialog', { name: 'Unsaved changes' });
    await leave.click();
    // the button, not the corner's ×, which says the same
    await ask.getByText('Cancel', { exact: true }).click();
    await expect(page).toHaveURL(/\/edit\/9001$/);
    await expect(ontime).toHaveValue('77');

    await leave.click();
    await ask.getByRole('button', { name: 'Discard' }).click();
    await expect(page).toHaveURL(/\/play$/);
    expect(api.writes).toEqual([]);
  });

  test('a preset from the Assistant changes the song', async ({ page }) => {
    await page.getByRole('tab', { name: 'Assistant', exact: true }).click();
    await page.locator('button.assist__tile').first().click();
    await expect(page.locator('.editor-dirty')).toBeVisible();
  });
});
