/** When the feeds are down: one clear state card, honest empty states, replays still work, and recovery. */
import { expect, test } from './support/test'

test.describe('feeds down', () => {
  test.use({ stubOptions: { feedsDown: true }, allowedErrors: [/status of 503/] })

  test('shows the offline card, keeps replays working, and recovers', async ({ app, page, stubs }) => {
    await app.open('JFK', { traffic: false })
    await expect.poll(() => app.playhead((s) => s.liveStatus), { timeout: 30_000 }).toBe('error')

    // The card over the map says what is wrong and what can be done.
    const card = page.getByRole('status').filter({ hasText: 'Live traffic is offline' })
    await expect(card).toBeVisible()
    await expect(card).toContainText('replays still work')
    await expect(card.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Watch a replay' })).toBeVisible()
    // And the top pill.
    await expect(page.getByRole('button', { name: 'Live traffic is offline. Try again' })).toBeVisible()

    // The traffic list and weather say why they are empty.
    await page.keyboard.press('/')
    await expect(app.view('traffic', 'Traffic at JFK')).toContainText('Live traffic is offline')
    if (!app.docked) await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('menuitem', { name: /^Weather/ }).click()
    const weather = app.view('weather', 'Weather at JFK')
    await expect(weather).toContainText('Weather isn’t available right now', { timeout: 30_000 })
    if (!app.docked) await weather.getByRole('button', { name: 'Close' }).first().click()

    // Recorded scenes don't need the feeds: straight from the card.
    await card.getByRole('button', { name: 'Watch a replay' }).click()
    await page.getByRole('dialog', { name: 'Replay' }).getByRole('button', { name: /Kennedy Tower/ }).click()
    await expect.poll(() => app.playhead((s) => s.mode)).toBe('playback')
    await page.getByRole('button', { name: 'Back to live', exact: true }).click()

    // Try again asks the feed straight away.
    await expect.poll(() => app.playhead((s) => s.liveStatus), { timeout: 30_000 }).toBe('error')
    const asked = () => stubs.apiCalls.filter((c) => c.startsWith('GET /api/aircraft')).length
    const before = asked()
    await card.getByRole('button', { name: 'Try again' }).click()
    await expect.poll(asked).toBeGreaterThan(before)

    // The feeds come back: the next poll finds the traffic and the card goes.
    stubs.set({ feedsDown: false })
    await app.waitForTraffic()
    await expect(card).toBeHidden()
    await expect(page.getByRole('button', { name: /^Live\. \d+ aircraft/ })).toBeVisible()
  })
})

test.describe('radio feed offline', () => {
  test.use({ stubOptions: { streamStatus: 404 }, allowedErrors: [/status of 404/] })

  test('the station bar says the feed is offline and when it will retry', async ({ app, page }) => {
    await app.open('JFK')
    await page.getByRole('button', { name: /^Listen live to / }).click()
    await expect(page.getByRole('status').filter({ hasText: /Feed is offline/i })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('status').filter({ hasText: /Retrying in \d+s/ })).toBeVisible()
    await page.getByRole('button', { name: /^Stop listening to / }).click()
    await expect.poll(() => page.evaluate(() => window.__atc.radio.getState().status)).toBe('off')
  })
})
