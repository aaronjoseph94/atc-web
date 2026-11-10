/** The Map sheet's switches change what MapLibre draws; checked on the map itself. */
import { expect, test, type Page } from './support/test'

const visibility = (page: Page, layer: string) => page.evaluate((id) => window.__atc.mapHandle.current?.getLayoutProperty(id, 'visibility') ?? 'visible', layer)

/** Procedure lines drawn anywhere on the map. */
const procedureFeatures = (page: Page) =>
  page.evaluate(() => {
    const map = window.__atc.mapHandle.current!
    const layers = ['proc-star', 'proc-sid', 'proc-final'].filter((id) => map.getLayer(id))
    return map.queryRenderedFeatures({ layers }).length
  })

test('the map sheet toggles procedures, lighting and style', async ({ app, page }) => {
  await app.open('JFK')
  // Procedures fan out for miles; look from further out.
  await page.evaluate(() => {
    window.__atc.playhead.getState().setCameraMode('manual')
    window.__atc.mapHandle.current!.jumpTo({ zoom: 9.5 })
  })
  await app.waitForCameraIdle()

  await page.getByRole('button', { name: 'Map layers' }).click()
  const sheet = page.getByRole('dialog', { name: 'Map' })
  await expect(sheet).toBeVisible()

  // Procedures: off by default, drawn when switched on, gone again when off.
  const procedures = sheet.getByRole('switch', { name: 'Arrival, departure and approach procedures' })
  await expect(procedures).toHaveAttribute('aria-checked', 'false')
  expect(await page.evaluate(() => !!window.__atc.mapHandle.current!.getLayer('proc-star'))).toBe(true)
  expect(await procedureFeatures(page)).toBe(0)
  await procedures.click()
  await expect.poll(() => procedureFeatures(page), { timeout: 30_000 }).toBeGreaterThan(0)
  await procedures.click()
  await expect.poll(() => procedureFeatures(page)).toBe(0)

  // Lighting: night switches the airfield lights on, day off.
  const lighting = sheet.getByRole('radiogroup', { name: 'Lighting' })
  await expect(lighting.getByRole('radio', { name: 'Day' })).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => visibility(page, 'lights-runway-core')).toBe('none')
  await lighting.getByRole('radio', { name: 'Night' }).click()
  await expect.poll(() => visibility(page, 'lights-runway-core')).toBe('visible')
  await expect.poll(() => visibility(page, 'lights-taxi-core')).toBe('visible')
  await lighting.getByRole('radio', { name: 'Day' }).click()
  await expect.poll(() => visibility(page, 'lights-runway-core')).toBe('none')

  // Approach paths and trails hide their layers.
  await expect.poll(() => visibility(page, 'apt-approach')).toBe('visible')
  await sheet.getByRole('switch', { name: 'Approach paths' }).click()
  await expect.poll(() => visibility(page, 'apt-approach')).toBe('none')

  // Map style: the ground colour changes.
  const ground = () => page.evaluate(() => JSON.stringify(window.__atc.mapHandle.current!.getPaintProperty('bg', 'background-color')))
  const navy = await ground()
  await sheet.getByRole('radiogroup', { name: 'Map style' }).getByRole('radio', { name: /Graphite/ }).click()
  await expect.poll(() => app.settings((s) => s.mapTheme)).toBe('graphite')
  await expect.poll(ground).not.toBe(navy)
})
