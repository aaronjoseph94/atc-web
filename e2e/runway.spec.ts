import { expect, test } from './support/test'

/** Halfway along JFK 4R/22L, clear of every aircraft in the fixture. */
const RUNWAY_4R_22L: [number, number] = [-73.7626, 40.6353]

test('tapping a runway opens its card', async ({ app, page }) => {
  await app.open('JFK')
  await page.evaluate((center) => {
    window.__atc.playhead.getState().setCameraMode('manual')
    window.__atc.mapHandle.current!.jumpTo({ center, zoom: 14.5, bearing: 0 })
  }, RUNWAY_4R_22L)
  await app.waitForCameraIdle()
  const p = await page.evaluate((c) => {
    const map = window.__atc.mapHandle.current!
    const xy = map.project(c)
    const r = map.getCanvas().getBoundingClientRect()
    return { x: r.left + xy.x, y: r.top + xy.y }
  }, RUNWAY_4R_22L)
  if (app.isMobile) await page.touchscreen.tap(p.x, p.y)
  else await page.mouse.click(p.x, p.y)

  const card = page.getByRole('dialog', { name: /^Runway (4R|22L)/ })
  await expect(card).toBeVisible()
  // Its size, and which end the recorded wind favours.
  await expect(card).toContainText(/8,400/)
  await expect(card).toContainText(/wind|Wind/)
  // Tapping it again closes it; so does Escape.
  await page.keyboard.press('Escape')
  await expect(card).toBeHidden()
})
