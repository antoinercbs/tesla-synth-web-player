import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/** The showcase site's screenshots (e2e/site.shots.ts): one browser at a time, the window of a laptop. */
export default defineConfig({
  ...base,
  testMatch: '**/*.shots.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // no trace: other runs (the tests, the video) may empty test-results/ meanwhile
  use: { ...base.use, trace: 'off', screenshot: 'off' },
  projects: [{ name: 'shots', use: { viewport: { width: 1440, height: 900 } } }],
});
