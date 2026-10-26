import { test, expect } from './fixtures';

test.describe('MIDI editor', () => {
  test('a note written, undone, redone, saved into the file', async ({ page, api }) => {
    const before = api.midiOf(9001);
    await page.goto('/edit/9001/midi');
    const count = page.getByText(/ · \d+ notes$/);
    await expect(count).toHaveText(/ 864 notes$/);

    // the highest rows, where the tune never goes
    const roll = page.locator('.roll__scroller');
    await roll.evaluate((el) => { el.scrollTop = 0; });
    const box = (await roll.boundingBox())!;
    await page.mouse.dblclick(box.x + 300, box.y + 40);
    await expect(count).toHaveText(/ 865 notes$/);
    await page.keyboard.press('Control+z');
    await expect(count).toHaveText(/ 864 notes$/);
    await page.keyboard.press('Control+y');
    await expect(count).toHaveText(/ 865 notes$/);

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const ask = page.getByRole('dialog', { name: /^Save / });
    await expect(ask).toContainText('864 → 865 notes');
    await ask.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => api.sent('PUT', '/api/songs/9001/midi').length).toBe(1);
    const after = api.midiOf(9001);
    expect(Buffer.from(after.subarray(0, 4)).toString('latin1')).toBe('MThd');
    expect(after).not.toEqual(before);
  });

  test('a channel deleted takes its notes, until undone', async ({ page }) => {
    await page.goto('/edit/9001/midi');
    const count = page.getByText(/ · \d+ notes$/);
    await expect(count).toHaveText(/ 864 notes$/);
    const channel = page.locator('.me-chan', { hasText: 'Channel 9' });
    await channel.getByRole('button', { name: 'Delete the channel and its notes' }).click();
    await expect(count).toHaveText(/ 288 notes$/);
    await expect(channel).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(count).toHaveText(/ 864 notes$/);
  });
});
