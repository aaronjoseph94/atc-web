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
  await expect(panel.getByText('Nothing matches “zzzz”.')).toBeVisible()

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

test('takeoffs and landings are listed under recent activity, not in the transcript', async ({ app, page }) => {
  await app.open('JFK')
  const text = 'American 100 took off from runway 31L.'
  // Through the store the detector feeds, so the test doesn't wait for a real takeoff.
  await page.evaluate(
    ([icao24, callsign, line]) => {
      window.__atc.playhead.getState().addEvents([{ id: 'e2e-takeoff', at: Date.now() - 60_000, kind: 'departed', icao24, callsign, runway: '31L', text: line, lon: 0, lat: 0 }])
    },
    [JFK.departure.icao24, JFK.departure.callsign, text],
  )
  const openPanel = (p: 'traffic' | 'transcripts') => page.evaluate((x) => window.__atc.playhead.getState().setPanel(x), p)

  // The transcript is for what was said on the radio.
  await openPanel('transcripts')
  const transcript = app.view('transcripts', 'Transcripts')
  await expect(transcript.getByRole('searchbox', { name: 'Search transcripts' })).toBeVisible()
  await expect(transcript.getByRole('toolbar', { name: 'Filters' }).getByRole('button', { name: 'Tower log' })).toHaveCount(0)
  await expect(transcript.getByText(text)).toHaveCount(0)

  // The traffic panel lists it, colour-coded as a takeoff.
  await openPanel('traffic')
  const panel = app.view('traffic', 'Traffic at JFK')
  const row = panel.getByRole('region', { name: 'Recent activity' }).getByRole('listitem').filter({ hasText: text })
  await expect(row).toBeVisible()
  await expect(row).toContainText('Takeoff')

  // A tap selects the aircraft.
  await row.getByRole('button').click()
  await expect.poll(() => app.playhead((s) => s.selectedIcao)).toBe(JFK.departure.icao24)
})
