import { test as base, expect } from '@playwright/test';
import { FakeApi } from './fake-api';

export { expect };

// every page's tour seen: no welcome dialog, no pulsing "?"
const TOURS = ['main', 'play', 'edit', 'playlists', 'midiEdit', 'envelopes', 'tune', 'syntherrupter'];

/** What a test's device has stored before the app starts; `storage` in test.use() adds to it. */
const DEVICE: Record<string, string> = {
  locale: 'en',
  tourSeen: '1',
  pageToursSeen: JSON.stringify(TOURS),
  uiMode: 'expert',
  synthModel: 'tesla',
  // the score: the 3D, the default, keeps a headless GPU busy for nothing
  playerViz: 'roll',
};

// errors the browser reports about the environment, not the app
const NOISE = /Web ?MIDI|Failed to load resource/i;

type Fixtures = {
  /** The server the app talks to (fake-api.ts), fresh for each test. */
  api: FakeApi;
  storage: Record<string, string>;
  /** The page's uncaught errors and console errors so far; any left at the end fails the test. */
  errors: string[];
};

/**
 * The app's tests start from here: a new browser profile on the fake API, the
 * device set up as `storage` says, and a test that leaves an error in the page
 * fails even if its own checks passed.
 */
export const test = base.extend<Fixtures>({
  storage: [{}, { option: true }],
  api: [async ({ page, baseURL }, use) => {
    const api = new FakeApi();
    await api.attach(page, baseURL as string);
    await use(api);
    expect(api.unknown, 'requests the fake API does not know').toEqual([]);
  }, { auto: true }],
  errors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`${e.message}\n${e.stack ?? ''}`));
    page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text()); });
    await use(errors);
    expect(errors, 'errors in the page').toEqual([]);
  }, { auto: true }],
  page: async ({ page, storage }, use) => {
    // once per test: a reload keeps what the test changed
    await page.addInitScript((items) => {
      if (sessionStorage.getItem('e2e')) return;
      sessionStorage.setItem('e2e', '1');
      for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v);
    }, { ...DEVICE, ...storage });
    // the world outside stays out: weather, maps, GitHub
    await page.context().route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
    await use(page);
  },
});
