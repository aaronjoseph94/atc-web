/**
 * What sits on top of the map, and what deliberately doesn't: no attribution
 * button and no search button. The credits the map data needs are in the menu
 * and under Help; search is the first row of the traffic list.
 */
import { expect, test } from './support/test'

test.describe('map chrome', () => {
  test('the map carries no attribution or search button; the menu carries the short credit and Help the full list', async ({ app, page }) => {
    await app.open('JFK')
    // Nothing of MapLibre's own is drawn over the map.
    await expect(page.locator('.maplibregl-ctrl-attrib')).toHaveCount(0)
    await expect(page.locator('.maplibregl-ctrl-logo:visible')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Search traffic' })).toHaveCount(0)

    // The menu keeps the short OpenStreetMap credit, and no longer lists Help, feedback or credits.
    await page.getByRole('button', { name: 'Menu' }).click()
    const menu = page.getByRole('menu', { name: 'Menu' })
    await expect(menu.getByRole('link', { name: '© OpenStreetMap' })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright')
    for (const name of ['Help', 'Send feedback', 'Map data and credits']) await expect(menu.getByRole('menuitem', { name })).toHaveCount(0)
    await page.keyboard.press('Escape')

    // Help (the ? key) still carries the full credits list.
    await page.keyboard.press('?')
    const help = page.getByRole('dialog', { name: 'Help' })
    const credits = help.getByRole('list', { name: 'Map data and credits' })
    for (const name of ['© OpenStreetMap contributors', 'OpenMapTiles', 'OpenFreeMap', 'adsb.fi', 'adsb.lol (ODbL)', 'The OpenSky Network', 'FAA Aeronautical Information Services']) {
      await expect(credits.getByRole('link', { name, exact: true })).toHaveAttribute('href', /^https:\/\//)
    }
  })

  test('search stays one step away: the status pill opens the traffic list and its search field', async ({ app, page }) => {
    await app.open('JFK')
    await page.getByRole('button', { name: /^Live\. \d+ aircraft\. Open traffic list$/ }).click()
    await expect(app.view('traffic', 'Traffic').getByRole('searchbox', { name: 'Search traffic' })).toBeVisible()
  })
})
