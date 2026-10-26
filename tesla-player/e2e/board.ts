import type { Page } from '@playwright/test';

/**
 * The tour's Syntherrupter (src/app/demo/fake-device.ts) plugged in for the rest
 * of the test: the board's page opens and reads a three-coil device; what is
 * sent to it is dropped. After the app has started (the store is the page's).
 */
export async function plugFakeBoard(page: Page): Promise<void> {
  await page.evaluate(async ([store, device]) => {
    const { useMidiStore } = await import(/* @vite-ignore */ store);
    const { fakeDeviceLink } = await import(/* @vite-ignore */ device);
    const midi = useMidiStore();
    midi.setDeviceLink(fakeDeviceLink);
    // the outputs, resolved once Web MIDI answers, would unplug it
    midi.$subscribe(() => { if (midi.deviceLink !== fakeDeviceLink) midi.setDeviceLink(fakeDeviceLink); });
  }, ['/src/app/stores/midi.ts', '/src/app/demo/fake-device.ts']);
}
