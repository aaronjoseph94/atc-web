import { JFK } from './support/fixtures'
import { expect, test } from './support/test'

test('the traffic list searches and selects', async ({ app, page }) => {
  await app.open('JFK')
  // The status pill opens it: a sheet on phones, the side panel's Traffic tab on wide screens.
  await page.getByRole('button', { name: /^Live\. \d+ aircraft\. Open traffic list/ }).click()
  const panel = app.view('traffic', 'Traffic at JFK')
  await expect(panel).toBeVisible()
  if (app.docked) await expect(app.dockTab('Traffic')).toHaveAttribute('aria-selected', 'true')
  // Grouped by what each aircraft is doing.
  await expect(panel.getByRole('heading', { name: /^Parked/ })).toBeVisible()
  const search = panel.getByRole('searchbox', { name: 'Search traffic' })

  // By airline name: every JetBlue flight and nothing else.
  await search.fill('JetBlue')
  const rows = panel.getByRole('listitem')
  await expect(rows.first()).toBeVisible()
  const names = await rows.locator('.font-display').allTextContents()
  expect(names.length).toBeGreaterThan(2)
  for (const n of names) expect(n).toMatch(/^JBU/)

  // By type and by tail number.
  await search.fill('C172')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText(JFK.light.callsign)
  await search.fill('N717AN')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText(JFK.departure.callsign)

  // Nothing found says so.
  await search.fill('zzzz')
  await expect(panel.getByText('Nothing in view matches “zzzz”.')).toBeVisible()

  // A tap selects the flight.
  await search.fill(JFK.helicopter.callsign)
  await rows.first().getByRole('button').click()
  await expect.poll(() => app.playhead((s) => s.selectedIcao)).toBe(JFK.helicopter.icao24)
  if (app.docked) {
    await expect(app.dockTab(JFK.helicopter.callsign)).toHaveAttribute('aria-selected', 'true')
  } else {
    await expect(panel).toBeHidden()
    await expect(app.flightCard(JFK.helicopter.callsign)).toBeVisible()
  }
})
