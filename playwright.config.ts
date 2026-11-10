/**
 * End-to-end tests: the production build (`vite preview`) in Chromium, at
 * phone and desktop sizes, with every network API stubbed by recorded
 * fixtures (see e2e/support/stubs.ts). Run with `npm run test:e2e`.
 *
 * Headless Chromium draws the map's WebGL in software (SwiftShader), which is
 * slow, so timeouts are generous and tests wait on app state, never on sleeps.
 */
import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.E2E_PORT ?? 4173)
const ci = !!process.env.CI

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results/e2e',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}',
  timeout: 90_000,
  expect: {
    timeout: 20_000,
    toHaveScreenshot: {
      // Fonts are served from fixtures, so only anti-aliasing should differ between machines.
      maxDiffPixelRatio: 0.02,
      threshold: 0.25,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  // Software WebGL is CPU-bound: two browsers at a time is what a CI runner's two cores can draw.
  workers: Number(process.env.E2E_WORKERS ?? 2),
  reporter: ci ? [['github'], ['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Tests stub requests at the page; a service worker would answer some of them first.
    serviceWorkers: 'block',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  projects: [
    {
      name: 'phone',
      use: { ...devices['Desktop Chrome'], viewport: { width: 430, height: 820 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    },
  ],
  webServer: {
    // Serves the last `vite build` (npm run test:e2e builds first; CI builds in an earlier step).
    command: `npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !ci,
    timeout: 60_000,
  },
})
