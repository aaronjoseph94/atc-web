/**
 * The `test` every spec imports: Playwright's, plus
 *  - `stubs`: the fixture-backed network (installed before the page loads);
 *  - `app`: helpers that drive the app through its `window.__atc` debug handles;
 *  - an automatic check after each test that the page logged no errors and
 *    asked for nothing the stubs don't cover.
 */
import { test as base, expect } from '@playwright/test'
import type { StubOptions } from './stubs'
import { Stubs } from './stubs'
import { App, defaultSettings } from './app'

type Fixtures = {
  stubs: Stubs
  app: App
  /** Console errors matching these are expected in this test (e.g. a deliberately failing feed). */
  allowedErrors: RegExp[]
  /** Network options for this test, applied before the page loads. */
  stubOptions: StubOptions
  /** Settings stored before the app loads (merged over the test defaults). */
  initialSettings: Record<string, unknown>
  /** Collected page errors and console errors; checked automatically. */
  pageErrors: string[]
}

/** Noise that isn't the app's fault: map tiles fetched live from OpenFreeMap can fail on a bad network day. */
const ALWAYS_ALLOWED = [/tiles\.openfreemap\.org/, /net::ERR_ABORTED/]

export const test = base.extend<Fixtures>({
  allowedErrors: [[], { option: true }],
  stubOptions: [{}, { option: true }],
  initialSettings: [{}, { option: true }],

  pageErrors: async ({ page, allowedErrors }, provide) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()} ${m.location().url ?? ''}`)
    })
    await provide(errors)
    const allowed = [...ALWAYS_ALLOWED, ...allowedErrors]
    const real = errors.filter((e) => !allowed.some((r) => r.test(e)))
    expect(real, 'page errors and console errors').toEqual([])
  },

  stubs: async ({ page, stubOptions }, provide) => {
    const stubs = new Stubs(stubOptions)
    await stubs.install(page)
    await provide(stubs)
    expect(stubs.unexpected, 'requests nothing stubs').toEqual([])
  },

  app: async ({ page, stubs, pageErrors, initialSettings }, provide) => {
    void stubs
    void pageErrors
    await page.addInitScript(
      ([settings]) => {
        ;(window as { __ATC_E2E__?: boolean }).__ATC_E2E__ = true
        // Seed settings once per test; a reload in the test must see what the app saved, not the seed.
        if (!sessionStorage.getItem('e2e-seeded')) {
          sessionStorage.setItem('e2e-seeded', '1')
          localStorage.setItem('atc-web.settings.v1', JSON.stringify({ state: settings, version: 0 }))
        }
      },
      [{ ...defaultSettings, ...initialSettings }],
    )
    await provide(new App(page))
  },
})

export { expect }
export type { Locator, Page } from '@playwright/test'
