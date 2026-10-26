import { test, expect } from './fixtures';

type CoilBody = { spec: { board: { ontime: number } } };

test.describe('Coil sheet', () => {
  // the sheet draws its coil in 3D: on a runner without a GPU, in software, the page takes most of the default 30 s
  test.slow();

  test.beforeEach(async ({ page }) => {
    await page.goto('/coils/9601');
    // the model's sweep comes a beat after the page, longer while other tests draw their 3D in software
    await expect(page.getByRole('slider', { name: "The play point's ontime" })).toBeVisible({ timeout: 20_000 });
  });

  test('the play point moves with the slider and the notes', async ({ page }) => {
    const thumb = page.getByRole('slider', { name: "The play point's ontime" });
    const caption = page.locator('.coil-3d__cap');
    await expect(caption).toHaveText('220 Hz · 40 µs');
    await thumb.focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    await expect(thumb).toHaveAttribute('aria-valuenow', '45');
    await expect(caption).toHaveText('220 Hz · 45 µs');
    await expect(page.getByRole('radiogroup', { name: 'Power by note' }).getByRole('radio')).toHaveCount(5);
    await page.getByRole('radio', { name: /440 Hz/ }).click();
    await expect(caption).toHaveText('440 Hz · 45 µs');
    await expect(page.getByRole('radio', { name: /440 Hz/ })).toHaveAttribute('aria-checked', 'true');
  });

  test('the board limit\'s handle is the Max ontime field, and saves with the sheet', async ({ page, api }) => {
    const field = page.getByRole('textbox', { name: 'Max ontime' });
    const max = Number(await field.inputValue());
    const lock = page.getByRole('slider', { name: "The board's max ontime" });
    await expect(lock).toHaveAttribute('aria-valuenow', String(max));
    await lock.focus();
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(field).toHaveValue(String(max - 10));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => (api.sent('PUT', '/api/coils/9601') as CoilBody[]).map((b) => b.spec.board.ontime)).toEqual([max - 10]);
  });

  test('a drag on the ruler moves the point, a drag on the padlock the limit', async ({ page }) => {
    const ruler = page.locator('.oruler svg');
    const box = (await ruler.boundingBox())!;
    const thumb = page.getByRole('slider', { name: "The play point's ontime" });
    const lock = page.getByRole('slider', { name: "The board's max ontime" });
    const trackY = box.y + box.height - 48 + 13;
    await page.mouse.move(box.x + box.width * 0.5, trackY);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3, trackY, { steps: 5 });
    await page.mouse.up();
    const on = Number(await thumb.getAttribute('aria-valuenow'));
    expect(on).toBeGreaterThan(20);
    expect(on).toBeLessThan(60);

    const before = Number(await lock.getAttribute('aria-valuenow'));
    const pill = (await page.locator('.oruler__lock-pill').boundingBox())!;
    await page.mouse.move(pill.x + pill.width / 2, pill.y + pill.height / 2);
    await page.mouse.down();
    await page.mouse.move(pill.x + pill.width / 2 - 60, pill.y + pill.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => Number(await lock.getAttribute('aria-valuenow'))).toBeLessThan(before);
    expect(Number(await thumb.getAttribute('aria-valuenow'))).toBe(on);
  });

  test('JavaTC import sits in the menu', async ({ page }) => {
    await page.locator('.coil-sheet__actions').getByRole('button', { name: 'More options' }).click();
    await expect(page.getByRole('button', { name: 'Import JavaTC 3D' })).toBeVisible();
  });
});
