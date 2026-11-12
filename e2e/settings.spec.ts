import { JFK } from './support/fixtures'
import { AI_ON, aiOnBoth } from './support/stubs'
import { expect, test } from './support/test'

test('settings persist across a reload', async ({ app, page }) => {
  await app.open('JFK')
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  const sheet = page.getByRole('dialog', { name: 'Settings' })
  await expect(sheet).toBeVisible()

  const reduce = sheet.getByRole('switch', { name: 'Reduce motion' })
  await expect(reduce).toHaveAttribute('aria-checked', 'false')
  await reduce.click()
  await expect(reduce).toHaveAttribute('aria-checked', 'true')
  await sheet.getByRole('radiogroup', { name: 'Altitude unit' }).getByRole('radio', { name: 'Metres' }).click()
  await sheet.getByRole('radiogroup', { name: 'Speed unit' }).getByRole('radio', { name: 'km/h' }).click()
  await sheet.getByRole('combobox', { name: 'Airport shown when the app opens' }).selectOption('YYC')
  await expect.poll(() => app.settings((s) => [s.reduceMotion, s.altitudeUnit, s.speedUnit, s.defaultAirport])).toEqual([true, 'm', 'kmh', 'YYC'])

  // The URL still says JFK, so the reload stays there; everything else comes back as set.
  await page.reload()
  await app.waitForMap()
  await app.waitForTraffic()
  await expect(page.locator('.reduce-motion')).toHaveCount(1)
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  await expect(sheet.getByRole('switch', { name: 'Reduce motion' })).toHaveAttribute('aria-checked', 'true')
  await expect(sheet.getByRole('radiogroup', { name: 'Altitude unit' }).getByRole('radio', { name: 'Metres' })).toHaveAttribute('aria-checked', 'true')
  await expect(sheet.getByRole('combobox', { name: 'Airport shown when the app opens' })).toHaveValue('YYC')
  await sheet.getByRole('button', { name: 'Close' }).click()

  // And they apply: the flight shows metres and km/h.
  await app.tapAircraft(JFK.arrival.icao24)
  const flight = app.docked ? app.flightDetail() : app.flightCard(JFK.arrival.callsign)
  await expect(flight).toContainText('396 m')
  await expect(flight).toContainText('269 km/h')

  // Without an airport in the URL the app opens at the chosen default.
  await page.goto('/')
  await app.waitForMap()
  await expect(page.getByRole('button', { name: /^Change airport\./ })).toHaveText('YYC')
})

test.describe('AI in Settings', () => {
  test('no key fields; keys saved by an older version are deleted on startup; the status says it is not set up', async ({ app, page, stubs }) => {
    // What a browser that used the old "paste your key" settings has stored.
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('e2e-ai-seeded')) {
        sessionStorage.setItem('e2e-ai-seeded', '1')
        localStorage.setItem('atc-web.ai.v1', JSON.stringify({ state: { provider: 'anthropic', model: 'claude-opus-5-5', anthropicKey: 'sk-ant-LEFTOVER', openrouterKey: 'sk-or-LEFTOVER', enabled: true }, version: 0 }))
      }
    })
    await app.open('JFK')
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }))
    expect(stored).not.toContain('LEFTOVER')
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('atc-web.ai.v1')!).state)).toEqual({ enabled: true })

    await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('menuitem', { name: 'Settings' }).click()
    const sheet = page.getByRole('dialog', { name: 'Settings' })
    await expect(sheet.getByRole('status', { name: 'AI status' })).toContainText('AI is not set up')
    await expect(sheet.getByRole('status', { name: 'AI status' })).toContainText('add the secret ANTHROPIC_API_KEY')
    await expect(sheet.getByRole('switch', { name: 'AI features' })).toHaveAttribute('aria-checked', 'true')
    await expect(sheet.getByRole('textbox')).toHaveCount(0)
    await expect(sheet.getByText(/API key/)).toHaveCount(0)
    await expect(sheet.getByRole('radiogroup', { name: 'AI provider' })).toHaveCount(0)
    await expect(sheet.getByRole('radiogroup', { name: 'AI model' })).toHaveCount(0)
    await expect(sheet.getByRole('list', { name: 'AI providers set up in Cloudflare' })).toHaveText(/Claude: not set up.*OpenRouter: not set up/)
    // Nothing the page sends carries a key.
    expect(stubs.apiCalls.filter((c) => /key/i.test(c))).toEqual([])
  })

  test.describe('with AI and AirNav set up in Cloudflare', () => {
    test.use({ stubOptions: { airnav: { configured: true, used: 4, today: 1, credits: 100, cap: 90, dailyCap: 3, storage: 'kv' } } })

    test('the status names the model, and diagnostics show today’s usage and the AirNav credits', async ({ app, page }) => {
      await page.route(/\/api\/ai$/, (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AI_ON) })
          : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'not in this test', status: 503 }) }),
      )
      await app.open('JFK')
      await page.getByRole('button', { name: 'Menu' }).click()
      await page.getByRole('menuitem', { name: 'Settings' }).click()
      const sheet = page.getByRole('dialog', { name: 'Settings' })
      await expect(sheet.getByRole('status', { name: 'AI status' })).toHaveText('AI: on (Claude Haiku 5.5)')
      // One key: the model can be picked, the provider cannot.
      await expect(sheet.getByRole('radiogroup', { name: 'AI model' }).getByRole('radio', { name: 'Haiku' })).toHaveAttribute('aria-checked', 'true')
      await expect(sheet.getByRole('radiogroup', { name: 'AI provider' })).toHaveCount(0)
      await expect(sheet.getByRole('list', { name: 'AI providers set up in Cloudflare' })).toHaveText(/Claude: set up.*OpenRouter: not set up/)

      await sheet.getByRole('button', { name: 'Data and diagnostics' }).click()
      await expect(sheet.getByText('412 of 3000')).toBeVisible()
      await expect(sheet.getByText('300 of 2100')).toBeVisible()
      await expect(sheet.getByText('AirNav credits used: 4 of 100 (today 1 of 3)')).toBeVisible()

      // Switching AI off on this device is remembered; no key is ever stored.
      await sheet.getByRole('switch', { name: 'AI features' }).click()
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('atc-web.ai.v1')!).state)).toEqual({ enabled: false, model: null, provider: null })
    })
  })

  test('with both keys, the model and provider are picked here, remembered, and sent with each request', async ({ app, page }) => {
    const statusAsks: Record<string, string>[] = []
    await page.route(/\/api\/ai$/, (route) => {
      const req = route.request()
      if (req.method() !== 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'not in this test', status: 503 }) })
      statusAsks.push(req.headers())
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(aiOnBoth(req.headers())) })
    })
    await app.open('JFK')
    await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('menuitem', { name: 'Settings' }).click()
    const sheet = page.getByRole('dialog', { name: 'Settings' })
    const status = sheet.getByRole('status', { name: 'AI status' })
    await expect(status).toHaveText('AI: on (Claude Haiku 5.5 via Claude)')
    await expect(sheet.getByRole('list', { name: 'AI providers set up in Cloudflare' })).toHaveText(/Claude: set up.*OpenRouter: set up/)
    const model = sheet.getByRole('radiogroup', { name: 'AI model' })
    const provider = sheet.getByRole('radiogroup', { name: 'AI provider' })
    await expect(model.getByRole('radio', { name: 'Haiku' })).toHaveAttribute('aria-checked', 'true')
    await expect(provider.getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true')

    await model.getByRole('radio', { name: 'Sonnet' }).click()
    await provider.getByRole('radio', { name: 'OpenRouter' }).click()
    await expect(status).toHaveText('AI: on (Claude Sonnet 5.5 via OpenRouter)')
    expect(statusAsks.at(-1)).toMatchObject({ 'x-atc-ai-model': 'claude-sonnet-5-5', 'x-atc-ai-provider': 'openrouter' })
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('atc-web.ai.v1')!).state)).toEqual({ enabled: true, model: 'claude-sonnet-5-5', provider: 'openrouter' })
    // Nothing the page stores or sends carries a key.
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toMatch(/sk-|apiKey|anthropicKey|openrouterKey/i)

    await page.reload()
    await app.waitForMap()
    await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('menuitem', { name: 'Settings' }).click()
    await expect(sheet.getByRole('radiogroup', { name: 'AI model' }).getByRole('radio', { name: 'Sonnet' })).toHaveAttribute('aria-checked', 'true')
    await expect(sheet.getByRole('status', { name: 'AI status' })).toHaveText('AI: on (Claude Sonnet 5.5 via OpenRouter)')
  })
})
