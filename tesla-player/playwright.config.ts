import { defineConfig, devices } from '@playwright/test';

// a dev server of its own: one already running (npm run dev) talks to the real backend
const PORT = 5198;

/**
 * The end-to-end tests (e2e/*.e2e.ts): the app in headless Chrome, on the fake API.
 * It drives the Chrome installed on this computer (no browser download);
 * CHROME_PATH points it at another Chromium.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // the dev server compiles a page on its first visit: a cold start takes a few seconds
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
      // software WebGL where there is no GPU (CI): the 3D views need a context
      args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'],
    },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } }, testIgnore: '**/phone.e2e.ts' },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: '**/phone.e2e.ts' },
  ],
  webServer: {
    command: `npx vite --mode e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
