/** Keyboard shortcuts (a desktop thing; phones have no keyboard). */
import { JFK } from './support/fixtures'
import { expect, test } from './support/test'

test.skip(({ isMobile }) => isMobile, 'keyboard shortcuts are for desktop')

test('every panel has a key: sheets close with Escape, docked views switch tabs', async ({ app, page }) => {
  await app.open('JFK')
  const sheets: [string, RegExp | string][] = [
    ['a', 'Airports'],
    ['c', /^Channels at /],
    ['r', 'Replay'],
    ['l', 'Map'],
    ['?', 'Help'],
  ]
  for (const [key, name] of sheets) {
    await page.keyboard.press(key)
    const dialog = page.getByRole('dialog', { name, exact: typeof name === 'string' })
    await expect(dialog, `${key} opens ${name}`).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  }
  // The radio transcript, traffic and weather live in the side panel at this width.
  // (Keys are ignored while typing, so leave any search box first.)
  const blur = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  const docked: [string, string][] = [
    ['/', 'Traffic'],
    ['w', 'Weather'],
    ['t', 'Radio'],
  ]
  for (const [key, tab] of docked) {
    await blur()
    await page.keyboard.press(key)
    await expect(app.dockTab(tab), `${key} shows ${tab}`).toHaveAttribute('aria-selected', 'true')
    // "/" also moves the cursor into the search box, a moment later; wait for it, or the
    // next key would be typed into the box instead of reaching the shortcuts.
    if (key === '/') await expect(app.sidePanel().getByRole('searchbox', { name: 'Search traffic' })).toBeFocused()
  }
  // "/" means search: the cursor lands in the traffic search box.
  await blur()
  await page.keyboard.press('/')
  await expect(app.sidePanel().getByRole('searchbox', { name: 'Search traffic' })).toBeFocused()
  await blur()
  await page.keyboard.press('m')
  await expect(page.getByRole('menu', { name: 'Menu' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu', { name: 'Menu' })).toBeHidden()
})

test('map keys zoom, turn north up and frame the airfield', async ({ app, page }) => {
  await app.open('JFK')
  await app.waitForCameraIdle()
  const camera = () => page.evaluate(() => {
    const m = window.__atc.mapHandle.current!
    return { zoom: Math.round(m.getZoom() * 10) / 10, bearing: Math.round(m.getBearing()) }
  })
  const start = await camera()
  await page.keyboard.press('+')
  await expect.poll(async () => (await camera()).zoom).toBeGreaterThan(start.zoom + 0.5)
  await app.waitForCameraIdle()
  const zoomed = await camera()
  await page.keyboard.press('-')
  await expect.poll(async () => (await camera()).zoom).toBeLessThan(zoomed.zoom - 0.5)
  await app.waitForCameraIdle()

  await page.evaluate(() => window.__atc.mapHandle.current!.setBearing(40))
  await page.keyboard.press('n')
  await expect.poll(async () => (await camera()).bearing).toBe(0)
  await app.waitForCameraIdle()

  // H: back to the whole airfield, the camera on automatic again.
  await page.evaluate(() => window.__atc.playhead.getState().setCameraMode('manual'))
  await page.keyboard.press('h')
  await expect.poll(() => app.playhead((s) => s.cameraMode)).toBe('auto')

  // F follows a selected flight; Escape lets it go.
  await app.tapAircraft(JFK.departure.icao24)
  await expect.poll(() => app.playhead((s) => s.following)).toBe(true)
  await page.keyboard.press('f')
  await expect.poll(() => app.playhead((s) => s.following)).toBe(false)
  await page.keyboard.press('Escape')
  await expect.poll(() => app.playhead((s) => s.selectedIcao)).toBeNull()
})
