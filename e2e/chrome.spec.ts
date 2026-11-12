/**
 * What sits on top of the map, and what deliberately doesn't: no attribution
 * button and no search button. The credits the map data needs are in the menu
 * and under Help; search is the first row of the traffic list.
 */
import { expect, test } from './support/test'

test.describe('map chrome', () => {
  test('the map carries no attribution or search button; the credits are in the menu and Help', async ({ app, page }) => {
    await app.open('JFK')
    // Nothing of MapLibre's own is drawn over the map.
    await expect(page.locator('.maplibregl-ctrl-attrib')).toHaveCount(0)
    await expect(page.locator('.maplibregl-ctrl-logo:visible')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Search traffic' })).toHaveCount(0)

    // The menu credits OpenStreetMap and leads to the full list.
    await page.getByRole('button', { name: 'Menu' }).click()
    const menu = page.getByRole('menu', { name: 'Menu' })
    await expect(menu.getByRole('link', { name: '© OpenStreetMap' })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright')
    await menu.getByRole('menuitem', { name: 'Map data and credits' }).click()
    const help = page.getByRole('dialog', { name: 'Help' })
    const credits = help.getByRole('list', { name: 'Map data and credits' })
    // Opened at the credits, not at the top of Help.
    await expect(credits.getByRole('link', { name: '© OpenStreetMap contributors' })).toBeInViewport()
    for (const name of ['© OpenStreetMap contributors', 'OpenMapTiles', 'OpenFreeMap', 'adsb.fi', 'adsb.lol (ODbL)', 'The OpenSky Network', 'FAA Aeronautical Information Services']) {
      await expect(credits.getByRole('link', { name, exact: true })).toHaveAttribute('href', /^https:\/\//)
    }
    await help.getByRole('button', { name: 'Close' }).click()

    // Plain Help still opens at the top.
    await page.getByRole('button', { name: 'Menu' }).click()
    await menu.getByRole('menuitem', { name: 'Help' }).click()
    await expect(help.getByText('Tap aircraft', { exact: true })).toBeInViewport()
  })

  test('search stays one step away: the status pill opens the traffic list and its search field', async ({ app, page }) => {
    await app.open('JFK')
    await page.getByRole('button', { name: /^Live\. \d+ aircraft\. Open traffic list$/ }).click()
    await expect(app.view('traffic', 'Traffic').getByRole('searchbox', { name: 'Search traffic' })).toBeVisible()
  })
})
