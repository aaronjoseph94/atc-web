import { readFileSync } from 'node:fs'
import { expect, test } from './support/test'

const fixtureCount = (code: string) => (JSON.parse(readFileSync(new URL(`./fixtures/api/aircraft-${code}.json`, import.meta.url), 'utf8')) as unknown[]).length

test('the airport picker switches airports, and remembers them', async ({ app, page, stubs }) => {
  await app.open('JFK')
  const code = page.getByRole('button', { name: /^Change airport\./ })

  // Search by city.
  await code.click()
  const picker = page.getByRole('dialog', { name: 'Airports' })
  await expect(picker).toBeVisible()
  await picker.getByRole('searchbox', { name: 'Search airports' }).fill('Calgary')
  await picker.getByRole('button', { name: /^YYC / }).click()
  await expect(picker).toBeHidden()
  await expect(code).toHaveText('YYC')
  await expect(page).toHaveURL(/#\/YYC$/)
  await app.waitForTraffic()
  await expect.poll(() => app.playhead((s) => s.liveCount)).toBe(fixtureCount('YYC'))
  expect(stubs.apiCalls).toContainEqual(expect.stringMatching(/^GET \/api\/aircraft\?airport=YYC/))
  await expect(page.getByRole('button', { name: 'Weather and ATIS' })).toContainText('VFR')

  // Search by code, Enter picks the first match.
  await code.click()
  await picker.getByRole('searchbox', { name: 'Search airports' }).fill('atl')
  await picker.getByRole('searchbox', { name: 'Search airports' }).press('Enter')
  await expect(code).toHaveText('ATL')
  await app.waitForTraffic()
  await expect.poll(() => app.playhead((s) => s.liveCount)).toBe(fixtureCount('ATL'))

  // Recent airports come first next time; one tap goes back.
  await code.click()
  await picker.getByRole('searchbox', { name: 'Search airports' }).fill('')
  const recent = picker.getByRole('button', { name: /^YYC\s*Calgary/ }).first()
  await expect(recent).toBeVisible()
  await recent.click()
  await expect(code).toHaveText('YYC')

  // Browser-style navigation: editing the address works too.
  await page.evaluate(() => (location.hash = '#/JFK'))
  await expect(code).toHaveText('JFK')
  await app.waitForTraffic()
})
