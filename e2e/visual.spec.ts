/**
 * Visual checks.
 *
 * Compared against baselines (e2e/__screenshots__): UI surfaces that don't
 * depend on the map, shot with the map hidden, motion reduced and anything
 * that ticks with the clock masked. Update them with `npm run test:e2e:update`
 * (or the "Update screenshots" run of the CI workflow) after an intended
 * visual change, and look at the new images before committing them.
 *
 * Not compared: full-page screenshots of the main screens, with the map,
 * saved to test-results/screens/ for a person to look over (CI uploads them).
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { JFK } from './support/fixtures'
import type { TestInfo } from '@playwright/test'
import { expect, test, type Page } from './support/test'

const SCREENS = path.join(import.meta.dirname, '..', 'test-results', 'screens')

async function stillUi(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => document.fonts.ready)
}

test.describe('screenshots', () => {
  test.use({ initialSettings: { reduceMotion: true } })

  test('station bar, flight card, full view and settings', async ({ app, page }) => {
    test.setTimeout(180_000)
    await stillUi(page)
    await app.open('JFK')
    await app.hideMap()

    const bar = page.locator('div.on-yellow', { has: page.getByRole('button', { name: /^Change airport\./ }) })
    await expect(bar).toHaveScreenshot('station-bar.png', { timeout: 60_000, mask: [bar.locator('canvas')] })

    await app.tapAircraft(JFK.arrival.icao24)
    if (!app.docked) {
      const card = app.flightCard(JFK.arrival.callsign)
      await app.settled(card)
      // Speed and altitude sparklines grow with every poll; the waveform follows the audio.
      await expect(card).toHaveScreenshot('flight-card.png', { timeout: 60_000, mask: [card.locator('canvas'), card.locator('svg.h-4')] })
    }

    await app.openFlightDetail()
    const detail = app.flightDetail()
    await app.settled(detail)
    await expect(detail.getByRole('img', { name: /^Side view of / })).toBeVisible()
    await detail.evaluate((el) => el.querySelector('.overflow-y-auto')?.scrollTo(0, 0))
    // The timeline is in clock time; its chart grows as the flight is watched. The story so far tells those times too.
    await expect(detail).toHaveScreenshot('flight-detail.png', { timeout: 60_000, mask: [detail.getByRole('region', { name: 'Flight timeline' }), detail.getByRole('region', { name: 'Story so far' })] })
    await detail.getByRole('button', { name: 'Close flight' }).click()

    await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('menuitem', { name: 'Settings' }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await app.settled(settings)
    await expect(settings).toHaveScreenshot('settings-sheet.png', { timeout: 60_000 })
  })
})

/** Screens for a person to look over: saved under test-results/screens/<project>/ and attached to the report. */
function screens(page: Page, info: TestInfo) {
  const dir = path.join(SCREENS, info.project.name)
  mkdirSync(dir, { recursive: true })
  return async (name: string) => {
    const file = path.join(dir, `${name}.png`)
    await page.screenshot({ path: file, timeout: 60_000 })
    await info.attach(name, { path: file, contentType: 'image/png' })
  }
}

test.describe('screens for review (not compared)', () => {
  test.describe.configure({ timeout: 180_000 })

  test('map, flight and channels', async ({ app, page }, info) => {
    const shot = screens(page, info)
    await app.open('JFK')
    await app.waitForCameraIdle()
    await shot('01-jfk')

    await app.tapAircraft(JFK.arrival.icao24)
    if (!app.docked) {
      await app.settled(app.flightCard())
      await shot('02-flight-card')
    }
    await app.openFlightDetail()
    await app.settled(app.flightDetail())
    await shot('03-flight-detail')
    await app.flightDetail().getByRole('button', { name: 'Close flight' }).click()

    await page.getByRole('button', { name: /^Switch channel\./ }).click()
    await app.settled(page.getByRole('dialog', { name: /^Channels at / }))
    await shot('04-channels')
  })

  test('traffic, layers, radio and transcript', async ({ app, page, stubs }, info) => {
    const shot = screens(page, info)
    stubs.transcribeQueue.push({ text: 'JetBlue nine twenty four, runway three one left, line up and wait' })
    await app.open('JFK')
    await page.getByRole('button', { name: /^Live\. \d+ aircraft/ }).click()
    await app.settled(app.view('traffic', 'Traffic at JFK'))
    await shot('05-traffic')
    if (!app.docked) await app.view('traffic', 'Traffic at JFK').getByRole('button', { name: 'Close' }).first().click()

    await page.evaluate(() => window.__atc.playhead.getState().setPanel('layers'))
    await app.settled(page.getByRole('dialog', { name: 'Map' }))
    await shot('06-layers')
    await page.getByRole('dialog', { name: 'Map' }).getByRole('button', { name: 'Close' }).click()

    await page.getByRole('button', { name: /^Listen live to / }).click()
    await expect(page.getByRole('button', { name: 'Open the radio transcript' })).toContainText('JetBlue', { timeout: 45_000 })
    await shot('07-radio-caption')
    await page.getByRole('button', { name: 'Open the radio transcript' }).click()
    if (app.docked) await expect(app.dockTab('Radio')).toHaveAttribute('aria-selected', 'true')
    const transcript = app.view('transcripts', 'Transcripts')
    await expect(transcript.getByRole('searchbox', { name: 'Search transcripts' })).toBeVisible()
    await expect(transcript.getByRole('listitem').filter({ hasText: 'JetBlue' })).toBeVisible()
    await app.settled(transcript)
    await shot('08-transcripts')
  })

  test('replay and another airport', async ({ app, page }, info) => {
    const shot = screens(page, info)
    await app.open('JFK')
    await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('menuitem', { name: /^Replay/ }).click()
    await page.getByRole('dialog', { name: 'Replay' }).getByRole('button', { name: /Kennedy Tower/ }).click()
    await expect(page.getByRole('button', { name: 'Open the transcript' })).toContainText('Delta', { timeout: 30_000 })
    await shot('09-replay')
    await page.getByRole('button', { name: 'Back to live', exact: true }).click()

    await page.goto('/#/YYC')
    await app.waitForMap()
    await app.waitForTraffic()
    await app.waitForCameraIdle()
    await shot('10-yyc')
  })
})
