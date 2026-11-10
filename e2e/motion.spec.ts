/** Reduced motion, from the in-app setting and from the operating system. */
import { JFK } from './support/fixtures'
import { expect, test, type Page } from './support/test'

/** Longest transition or animation on a sheet, in ms. */
const sheetMotionMs = (page: Page, name: string) =>
  page.getByRole('dialog', { name }).evaluate((el) => {
    const s = getComputedStyle(el)
    const ms = (v: string) => Math.max(...v.split(',').map((x) => (x.trim().endsWith('ms') ? parseFloat(x) : parseFloat(x) * 1000)))
    return Math.max(ms(s.transitionDuration), ms(s.animationDuration))
  })

/** The talking aircraft's halo radius over a few frames: it breathes unless motion is reduced. */
const haloRadii = (page: Page) =>
  page.evaluate(async () => {
    const map = window.__atc.mapHandle.current!
    const out: number[] = []
    for (let i = 0; i < 6; i++) {
      out.push(Number(map.getPaintProperty('ac-halo', 'circle-radius')))
      await new Promise((r) => setTimeout(r, 250))
    }
    return out
  })

test.describe('reduced motion', () => {
  test('the setting stills sheets and the talking-aircraft halo', async ({ app, page }) => {
    await app.open('JFK')
    // Normal motion first: sheets animate...
    await page.getByRole('button', { name: 'Map layers' }).click()
    expect(await sheetMotionMs(page, 'Map')).toBeGreaterThan(100)
    await page.getByRole('dialog', { name: 'Map' }).getByRole('button', { name: 'Close' }).click()
    // ...and the halo round a selected aircraft breathes (it only animates while something wears it).
    await app.tapAircraft(JFK.departure.icao24)
    await expect.poll(async () => new Set(await haloRadii(page)).size).toBeGreaterThan(1)

    await page.evaluate(() => window.__atc.settings.getState().update('reduceMotion', true))
    await expect(page.locator('.reduce-motion')).toHaveCount(1)
    await expect.poll(async () => new Set(await haloRadii(page)).size).toBe(1)
    await page.keyboard.press('Escape')
    await expect.poll(() => app.playhead((s) => s.selectedIcao)).toBeNull()
    await page.getByRole('button', { name: 'Map layers' }).click()
    expect(await sheetMotionMs(page, 'Map')).toBeLessThan(1)
  })

  test('the operating system setting is honoured too', async ({ app, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await app.open('JFK')
    await page.getByRole('button', { name: 'Map layers' }).click()
    expect(await sheetMotionMs(page, 'Map')).toBeLessThan(1)
  })
})
