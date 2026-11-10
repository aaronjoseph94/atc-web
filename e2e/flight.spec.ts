import { JFK } from './support/fixtures'
import { expect, test, type Locator } from './support/test'

/** What the full flight view shows, wherever it is: the drawing, the route, the facts, the timeline. */
async function expectFullView(detail: Locator) {
  const aircraft = detail.getByRole('region', { name: 'Aircraft' })
  await expect(aircraft).toBeVisible()
  await expect(aircraft.getByRole('img', { name: /^Top view of / })).toBeVisible()
  await expect(detail).toContainText('Delta Air Lines flight 1210')
  await expect(detail.getByRole('img', { name: /percent of the route flown/ })).toBeVisible()
  for (const label of ['Speed', 'Altitude', 'Climb', 'Heading', 'Transponder']) await expect(detail.getByText(label, { exact: true }).first()).toBeVisible()
  await expect(detail.getByText('3341', { exact: true })).toBeVisible()
  await expect(detail.getByRole('region', { name: 'Flight timeline' })).toBeVisible()
}

test.describe('phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'the purple card and its gestures are the phone layout')

  test('tapping an aircraft opens its card; dragging opens and closes the full view', async ({ app, page }) => {
    await app.open('JFK')
    await app.tapAircraft(JFK.arrival.icao24)

    // The purple card: callsign, type, route from the flight lookup, the numbers.
    const card = app.flightCard(JFK.arrival.callsign)
    await expect(card).toBeVisible()
    await expect(card.getByRole('heading', { name: JFK.arrival.callsign })).toBeVisible()
    await expect(card).toContainText('A321')
    await expect(card).toContainText('ATL')
    await expect(card).toContainText('145 kt')
    await expect(card).toContainText('1,300 ft')
    // It fits the screen: nothing runs off the right edge.
    const width = page.viewportSize()!.width
    expect((await card.boundingBox())!.width).toBeLessThanOrEqual(width)
    await expect(card.getByRole('button', { name: 'Close flight' })).toBeInViewport({ ratio: 1 })
    // The station bar hides behind the card.
    await expect(page.getByRole('button', { name: /^Change airport\./ })).toBeHidden()
    await app.settled(card)

    // Drag the card up: the full view.
    const box = (await card.boundingBox())!
    await app.drag({ x: box.x + box.width / 2, y: box.y + 8 }, { x: box.x + box.width / 2, y: box.y - 260 })
    const detail = app.flightDetail()
    await expect(detail).toBeVisible()
    await expect.poll(() => app.playhead((s) => s.sheet)).toBe('full')
    await expectFullView(detail)
    await app.settled(detail)

    // Drag the header down: back to the card.
    const top = (await detail.boundingBox())!
    await app.drag({ x: top.x + 60, y: top.y + 30 }, { x: top.x + 60, y: top.y + 330 })
    await expect(detail).toBeHidden()
    await expect.poll(() => app.playhead((s) => s.sheet)).toBe('card')
    await expect(card).toBeVisible()
    await app.settled(card)

    // Drag the card down: the aircraft is let go and the station bar comes back.
    const again = (await card.boundingBox())!
    await app.drag({ x: again.x + again.width / 2, y: again.y + 8 }, { x: again.x + again.width / 2, y: again.y + 260 })
    await expect.poll(() => app.playhead((s) => s.selectedIcao)).toBeNull()
    await expect(card).toBeHidden()
    await expect(page.getByRole('button', { name: /^Change airport\./ })).toBeVisible()
  })

  test('the frequency dial on the card tunes to the next channel when dragged', async ({ app, page }) => {
    await app.open('JFK')
    await app.tapAircraft(JFK.taxiing.icao24)
    const dial = app.flightCard().getByRole('slider', { name: 'Frequency' })
    await expect(dial).toBeVisible()
    await app.settled(app.flightCard())
    const at = Number(await dial.getAttribute('aria-valuenow'))
    const before = await app.playhead((s) => s.stationId)
    const c = await app.center(dial)
    // One channel to the right: drag the scale left by a little more than one gap (78 px).
    await app.drag({ x: c.x, y: c.y }, { x: c.x - 95, y: c.y }, { steps: 20 })
    await expect(dial).toHaveAttribute('aria-valuenow', String(at + 1))
    await expect.poll(() => app.playhead((s) => s.stationId)).not.toBe(before)
    await expect(dial).toHaveAttribute('aria-valuetext', /\d{3}\.\d+/)
    // Tuning starts that channel's audio when a feed carries it, or says there is none.
    await expect.poll(() => page.evaluate(() => window.__atc.radio.getState().status)).toMatch(/connecting|live|buffering|nofeed/)
    // Arrow keys move it too.
    await dial.focus()
    await page.keyboard.press('ArrowLeft')
    await expect(dial).toHaveAttribute('aria-valuenow', String(at))
  })
})

test.describe('desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'the docked side panel is the wide-screen layout')

  test('a selected aircraft fills the side panel; its tabs switch views and keep the selection', async ({ app, page }) => {
    await app.open('JFK')
    const panel = app.sidePanel()
    await expect(panel).toBeVisible()
    // With nothing selected: Transcript, Traffic, Weather.
    await expect(panel.getByRole('tab')).toHaveText(['Transcript', 'Traffic', 'Weather'])

    await app.tapAircraft(JFK.arrival.icao24)
    // The flight takes the panel, with its own tab first; no card over the station bar.
    await expect(app.dockTab(JFK.arrival.callsign)).toHaveAttribute('aria-selected', 'true')
    await expectFullView(app.flightDetail())
    await expect(page.getByRole('button', { name: /^Change airport\./ })).toBeVisible()

    // Another tab: the panel changes, the aircraft stays selected.
    await app.dockTab('Traffic').click()
    await expect(app.dockTab('Traffic')).toHaveAttribute('aria-selected', 'true')
    await expect(panel.getByRole('searchbox', { name: 'Search traffic' })).toBeVisible()
    expect(await app.playhead((s) => s.selectedIcao)).toBe(JFK.arrival.icao24)
    await app.dockTab('Weather').click()
    await expect(panel).toContainText(/300°\s*·\s*9\s*kt/)
    await app.dockTab(JFK.arrival.callsign).click()
    await expect(app.flightDetail()).toBeVisible()

    // Closing the flight hands the panel back to the tabs.
    await app.flightDetail().getByRole('button', { name: 'Close flight' }).click()
    await expect.poll(() => app.playhead((s) => s.selectedIcao)).toBeNull()
    await expect(panel.getByRole('tab')).toHaveText(['Transcript', 'Traffic', 'Weather'])

    // Tucked away and brought back.
    await panel.getByRole('button', { name: 'Hide side panel' }).click()
    await expect(panel).toHaveAttribute('data-collapsed', '')
    await page.keyboard.press(']')
    await expect(panel).not.toHaveAttribute('data-collapsed')
  })
})

test('helicopters and light aircraft get their own drawing', async ({ app }) => {
  await app.open('JFK')
  for (const ac of [JFK.helicopter, JFK.light]) {
    await app.tapAircraft(ac.icao24)
    if (!app.docked) {
      const card = app.flightCard(ac.callsign)
      await expect(card).toBeVisible()
      await expect(card).toContainText(ac.type)
    }
    await app.openFlightDetail()
    const detail = app.flightDetail()
    await expect(detail.getByRole('img', { name: /^Top view of / })).toBeVisible()
    await expect(detail.getByRole('region', { name: 'Aircraft' })).toContainText(ac.drawing)
    await detail.getByRole('button', { name: 'Close flight' }).click()
    await expect.poll(() => app.playhead((s) => s.selectedIcao)).toBeNull()
  }
})
