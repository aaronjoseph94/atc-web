import { expect, test } from './support/test'

test('the channel sheet switches channel and starts its audio', async ({ app, page }) => {
  await app.open('JFK')
  const before = await app.playhead((s) => s.stationId)
  await page.getByRole('button', { name: /^Switch channel\./ }).click()
  const sheet = page.getByRole('dialog', { name: /^Channels at / })
  await expect(sheet).toBeVisible()
  // Grouped like a pilot thinks of them, the current one marked.
  await expect(sheet.getByRole('region', { name: 'Tower' })).toBeVisible()
  await expect(sheet.getByRole('region', { name: 'Ground' })).toBeVisible()
  await expect(sheet.getByRole('button', { pressed: true })).toHaveCount(1)

  // A ground channel with live audio.
  const ground = sheet.getByRole('region', { name: 'Ground' }).getByRole('button').filter({ has: page.getByLabel('Live audio') }).first()
  const position = (await ground.locator('span').first().textContent())?.trim() ?? ''
  await ground.click()
  await expect(sheet).toBeHidden()
  await expect.poll(() => app.playhead((s) => s.stationId)).not.toBe(before)
  await expect(page.getByRole('button', { name: /^Switch channel\./ })).toContainText(position)
  // Choosing a channel tunes the radio to it.
  await expect.poll(() => page.evaluate(() => window.__atc.radio.getState().on)).toBe(true)
  await expect(page.getByRole('button', { name: /^Stop listening to / })).toBeVisible()
})

test('the channel sheet closes when dragged down', async ({ app, page }) => {
  await app.open('JFK')
  await page.getByRole('button', { name: /^Switch channel\./ }).click()
  const sheet = page.getByRole('dialog', { name: /^Channels at / })
  await expect(sheet).toBeVisible()
  await app.settled(sheet)
  // Grab the header (the big airport code), not a button in it.
  const box = (await sheet.boundingBox())!
  await app.drag({ x: box.x + 40, y: box.y + 30 }, { x: box.x + 40, y: box.y + 330 })
  await expect(sheet).toBeHidden()
  await expect.poll(() => app.playhead((s) => s.panel)).toBeNull()
})
