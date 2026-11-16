/**
 * The owner's optional browser check (Cloudflare Turnstile) switched on.
 * Turnstile's script and `/api/session` are stubbed: the widget passes at
 * once, and the page must swap its token for a session token and send that
 * with paid requests (`x-atc-session`), renewing it when the server says no.
 * With the check off (every other spec) none of this happens.
 */
import type { Page, Route } from '@playwright/test'
import { JFK } from './support/fixtures'
import { AI_ON } from './support/stubs'
import { expect, test } from './support/test'

const AAL = JFK.departure
const ATC = 'american one hundred turn left heading two two zero climb and maintain five thousand contact new york departure one three five point niner'
const GATE = { required: true, siteKey: 'e2e-site-key' }

/** Stands in for https://challenges.cloudflare.com/turnstile/v0/api.js: renders nothing, passes at once. */
const FAKE_TURNSTILE = `
window.__turnstileRenders = []
window.turnstile = {
  render(el, opts) {
    window.__turnstileRenders.push({ sitekey: opts.sitekey, appearance: opts.appearance, inPage: document.body.contains(el) })
    setTimeout(() => opts.callback('e2e-widget-token-' + window.__turnstileRenders.length), 20)
    return 'w' + window.__turnstileRenders.length
  },
  remove() {},
}`

async function gateOn(page: Page) {
  const scripts: string[] = []
  const sessions: unknown[] = []
  const aiHeaders: (string | undefined)[] = []
  let issued = 0
  // Registered after the shared stubs, so these win for the routes they match.
  await page.route(/^https:\/\/challenges\.cloudflare\.com\/turnstile\//, (route: Route) => {
    scripts.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_TURNSTILE })
  })
  await page.route(/\/api\/session$/, (route: Route) => {
    sessions.push(route.request().postDataJSON())
    issued++
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, token: `v1.e2e-${issued}`, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), ttlS: 1800 }) })
  })
  await page.route(/\/api\/ai$/, (route: Route) => {
    const req = route.request()
    const send = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (req.method() === 'GET') return send({ ...AI_ON, session: GATE })
    const token = req.headers()['x-atc-session']
    aiHeaders.push(token)
    const body = req.postDataJSON() as { task: string; input: { text: string } }
    // The first session is "from another network": refused, so the page must fetch a new one and try again.
    if (token !== 'v1.e2e-2') return send({ ok: false, task: body.task, error: 'check needed', status: 401, code: 'session', siteKey: GATE.siteKey }, 401)
    if (body.task !== 'radioCleanup') return send({ ok: false, task: body.task, error: 'not in this test', status: 503 })
    return send({ ok: true, task: 'radioCleanup', provider: 'anthropic', model: 'test', result: { cleaned: 'American 100, turn left heading 220.', plain: '', speaker: 'atc', speakerConfidence: 0.9, callsigns: [AAL.callsign], instructions: [] } })
  })
  return { scripts, sessions, aiHeaders }
}

// The refused first session (on purpose, below) is a 401 the browser reports as a failed resource.
test.use({ allowedErrors: [/status of 401/] })

test('with the browser check on, the page gets a session from Turnstile and sends it with AI requests', async ({ app, page }) => {
  test.slow()
  const gate = await gateOn(page)
  await app.open('JFK')

  // The status says the check is on: Turnstile's script (explicit render) is loaded and the widget run once, invisibly.
  await expect.poll(() => gate.sessions.length).toBeGreaterThanOrEqual(1)
  expect(gate.scripts).toEqual(['https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'])
  expect(gate.sessions[0]).toEqual({ token: 'e2e-widget-token-1' })
  const renders = await page.evaluate(() => (window as unknown as { __turnstileRenders: unknown[] }).__turnstileRenders)
  expect(renders[0]).toEqual({ sitekey: 'e2e-site-key', appearance: 'interaction-only', inPage: true })

  // A radio call goes to the AI with the session; refused once, the page renews it and the call is processed.
  await page.evaluate(() => window.__atc.playhead.getState().setPanel('transcripts'))
  await page.evaluate((t) => {
    const s = window.__atc.playhead.getState()
    window.__atc.ingest(t, { stationId: s.stationId, airport: s.airportIcao, kind: 'TWR', endedAt: Date.now(), durationMs: 3000 })
  }, ATC)
  const transcript = app.view('transcripts', 'Transcripts')
  await expect(transcript.getByRole('listitem').filter({ hasText: 'American 100, turn left heading 220.' })).toBeVisible()
  expect(gate.aiHeaders.filter((h) => h === 'v1.e2e-1').length).toBeGreaterThanOrEqual(1)
  expect(gate.aiHeaders).toContain('v1.e2e-2')
  expect(gate.aiHeaders).not.toContain(undefined)
  // The widget is taken down again once it has answered.
  await expect(page.locator('[data-atc-turnstile]')).toHaveCount(0)
})
