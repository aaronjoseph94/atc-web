import { expect, test } from './support/test'

test.describe('loading', () => {
  test('JFK opens with live traffic and no errors', async ({ app, page, stubs }) => {
    await app.open('JFK')
    // The top pill counts what the fixture holds.
    await expect(page.getByRole('button', { name: /^Live\. \d+ aircraft/ })).toBeVisible()
    const count = await app.playhead((s) => s.liveCount)
    expect(count).toBeGreaterThanOrEqual(20)
    // Station bar: big airport code, the default channel, weather from the recorded METAR.
    await expect(page.getByRole('button', { name: /^Change airport\. Showing / })).toHaveText('JFK')
    await expect(page.getByRole('button', { name: /^Switch channel\./ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Weather and ATIS' })).toContainText('VFR')
    // Aircraft from the fixture are on the map.
    await page.waitForFunction(() => (window.__atc.mapHandle.current?.queryRenderedFeatures({ layers: ['ac-hit'] }).length ?? 0) > 5)
    expect(stubs.apiCalls.some((c) => c.startsWith('GET /api/aircraft?airport=JFK'))).toBe(true)
  })
})
