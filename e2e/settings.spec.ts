import { JFK } from './support/fixtures'
import { expect, test } from './support/test'

test('settings persist across a reload', async ({ app, page }) => {
  await app.open('JFK')
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  const sheet = page.getByRole('dialog', { name: 'Settings' })
  await expect(sheet).toBeVisible()

  const reduce = sheet.getByRole('switch', { name: 'Reduce motion' })
  await expect(reduce).toHaveAttribute('aria-checked', 'false')
  await reduce.click()
  await expect(reduce).toHaveAttribute('aria-checked', 'true')
  await sheet.getByRole('radiogroup', { name: 'Altitude unit' }).getByRole('radio', { name: 'Metres' }).click()
  await sheet.getByRole('radiogroup', { name: 'Speed unit' }).getByRole('radio', { name: 'km/h' }).click()
  await sheet.getByRole('combobox', { name: 'Airport shown when the app opens' }).selectOption('YYC')
  await expect.poll(() => app.settings((s) => [s.reduceMotion, s.altitudeUnit, s.speedUnit, s.defaultAirport])).toEqual([true, 'm', 'kmh', 'YYC'])

  // The URL still says JFK, so the reload stays there; everything else comes back as set.
  await page.reload()
  await app.waitForMap()
  await app.waitForTraffic()
  await expect(page.locator('.reduce-motion')).toHaveCount(1)
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  await expect(sheet.getByRole('switch', { name: 'Reduce motion' })).toHaveAttribute('aria-checked', 'true')
  await expect(sheet.getByRole('radiogroup', { name: 'Altitude unit' }).getByRole('radio', { name: 'Metres' })).toHaveAttribute('aria-checked', 'true')
  await expect(sheet.getByRole('combobox', { name: 'Airport shown when the app opens' })).toHaveValue('YYC')
  await sheet.getByRole('button', { name: 'Close' }).click()

  // And they apply: the flight shows metres and km/h.
  await app.tapAircraft(JFK.arrival.icao24)
  const flight = app.docked ? app.flightDetail() : app.flightCard(JFK.arrival.callsign)
  await expect(flight).toContainText('396 m')
  await expect(flight).toContainText('269 km/h')

  // Without an airport in the URL the app opens at the chosen default.
  await page.goto('/')
  await app.waitForMap()
  await expect(page.getByRole('button', { name: /^Change airport\./ })).toHaveText('YYC')
})
