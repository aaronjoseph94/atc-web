/**
 * Radio calls are shown after the AI pass. `/api/ai` is answered here by
 * realistic `radioCleanup` results (no key is needed) and calls are injected
 * through the transcriber's `ingest()`:
 *  - a call is held back until its answer arrives, then shown cleaned, with
 *    the AI's speaker colouring the highlight from the start; instructions
 *    become a badge on the map, a handoff chip and the flight's story;
 *  - without an answer in about eight seconds the call is shown as heard,
 *    marked "unprocessed", and upgraded in place when the answer comes;
 *  - with AI not set up, or over its daily limit, nothing waits: calls are
 *    shown at once, marked, with one quiet notice.
 */
import type { Page, Route } from '@playwright/test'
import { JFK } from './support/fixtures'
import { AI_ON } from './support/stubs'
import { expect, test } from './support/test'

const AAL = JFK.departure
const ATC = 'american one hundred turn left heading two two zero climb and maintain five thousand contact new york departure one three five point niner'
const READBACK = 'american one hundred left two two zero up to five thousand'

const ins = (p: Record<string, unknown>) => ({ type: 'other', callsign: AAL.callsign, action: '', value: '', facility: '', runway: '', route: [], ...p })
const ANSWERS: Record<string, unknown> = {
  [ATC]: {
    cleaned: 'American 100, turn left heading 220, climb and maintain 5,000, contact New York Departure 135.9.',
    plain: 'American 100 should turn left to 220°, climb to 5,000 feet and switch to the departure controller on 135.9.',
    speaker: 'atc',
    speakerConfidence: 0.95,
    callsigns: [AAL.callsign],
    instructions: [ins({ type: 'heading', action: 'left', value: '220' }), ins({ type: 'altitude', action: 'climb', value: '5000' }), ins({ type: 'handoff', action: 'contact', value: '135.9', facility: 'Departure' })],
  },
  // Opens with the callsign, so the rules say controller; it is the pilot reading back.
  [READBACK]: {
    cleaned: 'American 100, left 220, up to 5,000.',
    plain: 'The pilot of American 100 repeats the turn to 220° and the climb to 5,000 feet.',
    speaker: 'pilot',
    speakerConfidence: 0.88,
    callsigns: [AAL.callsign],
    instructions: [ins({ type: 'heading', action: 'left', value: '220' }), ins({ type: 'altitude', action: 'climb', value: '5000' })],
  },
}

/**
 * Answer `/api/ai` as a server with a key would. Each answer waits for the
 * test to `release()` it, so what the page shows while it waits can be
 * checked however slowly the page runs. `refuse` answers every radio request
 * with that body instead (the daily limit).
 */
async function fakeAi(page: Page, opts: { refuse?: Record<string, unknown> } = {}) {
  const inputs: { text: string }[] = []
  let released = 0
  let wake = () => {}
  const turn = (n: number) =>
    new Promise<void>((resolve) => {
      const check = () => (released > n ? resolve() : (wake = check))
      check()
    })
  await page.route(/\/api\/ai$/, async (route: Route) => {
    const req = route.request()
    const send = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (req.method() === 'GET') return send(AI_ON)
    // The browser has no key to send, and must not invent one.
    expect(Object.keys(req.headers()).filter((h) => /key|x-atc/i.test(h))).toEqual([])
    const body = req.postDataJSON() as { task: string; input: { text: string } }
    // Other AI features (the airport briefing, alerts…) ask too; this spec is about the radio pass only.
    // (Answered with HTTP 200 so the browser logs no failed request; the body still says it failed.)
    if (body.task !== 'radioCleanup') return send({ ok: false, task: body.task, error: 'not in this test', status: 503 })
    const n = inputs.push(body.input) - 1
    if (opts.refuse) return send(opts.refuse, 429)
    await turn(n)
    const result = ANSWERS[body.input.text]
    if (!result) return send({ ok: false, error: 'unexpected' }, 500)
    return send({ ok: true, task: 'radioCleanup', provider: 'anthropic', model: 'test', result })
  })
  return {
    inputs,
    release() {
      released++
      wake()
    },
  }
}

const say = (page: Page, text: string) =>
  page.evaluate((t) => {
    const s = window.__atc.playhead.getState()
    window.__atc.ingest(t, { stationId: s.stationId, airport: s.airportIcao, kind: 'TWR', endedAt: Date.now(), durationMs: 3000 })
  }, text)

const openTranscript = (page: Page) => page.evaluate(() => window.__atc.playhead.getState().setPanel('transcripts'))

/** The calls in the radio log of the channel on screen, as the app holds them. */
const logged = (page: Page) =>
  page.evaluate(() => {
    const log = window.__atc.radio.getState().log[window.__atc.playhead.getState().stationId] ?? []
    return log.map((t) => ({ text: t.text, unprocessed: !!t.unprocessed, speaker: t.speaker }))
  })

/** The badges drawn this frame (from the source's data: the aircraft may be off screen). */
const badges = (page: Page) =>
  page.evaluate(() => {
    const src = window.__atc.mapHandle.current!.getSource('instruction-badges') as unknown as { serialize: () => { data: { features?: { properties: { img: string } }[] } } }
    return (src.serialize().data.features ?? []).map((f) => f.properties.img)
  })

test.describe('radio AI', () => {
  test('a call is shown only once processed: cleaned, explained, attributed, its instructions as data', async ({ app, page }) => {
    // Many steps, each waiting on software-rendered frames.
    test.slow()
    const ai = await fakeAi(page)
    const inputs = ai.inputs
    await app.open('JFK')
    // Watch the transcript (the caption line fades after a few seconds, and software rendering is slow).
    await openTranscript(page)
    const transcript = app.view('transcripts', 'Transcripts')
    const calls = transcript.getByRole('listitem')

    // Held back while the AI works: nothing in the log, the transcript or on the map yet.
    await say(page, ATC)
    await expect.poll(() => inputs.length).toBe(1)
    expect(await logged(page)).toEqual([])
    await expect(calls.filter({ hasText: 'american one hundred' })).toHaveCount(0)
    expect(await app.playhead((s) => s.activeCallsign)).toBeNull()
    // The caption line says a call is on its way.
    await expect.poll(() => page.evaluate(() => window.__atc.radio.getState().pending)).toBe(1)

    // The answer: the cleaned words are the first words anyone sees, and nothing is marked.
    ai.release()
    await expect(calls.filter({ hasText: 'turn left heading 220, climb and maintain 5,000, contact New York Departure 135.9.' })).toBeVisible()
    await expect(transcript.locator('[data-unprocessed]')).toHaveCount(0)
    expect(inputs[0]).toMatchObject({ text: ATC, station: { airport: 'JFK', role: 'TWR' } })
    expect(JSON.stringify(inputs[0]).length).toBeLessThanOrEqual(2000)
    await expect.poll(() => badges(page), { timeout: 20_000 }).toContain('ib:HDG 220 · ↑5,000')

    // The read-back: the rules would call it ATC; the model is sure it is the pilot. The highlight starts
    // when the call is published, so it is the pilot's colour from the first frame, never the wrong one.
    const speakers: (string | null)[] = []
    await page.exposeFunction('__noteSpeaker', (s: string | null) => void speakers.push(s))
    await page.evaluate(() => {
      const note = (window as unknown as { __noteSpeaker: (s: string | null) => void }).__noteSpeaker
      window.__atc.playhead.subscribe((s, prev) => {
        if (s.activeSpeaker !== prev.activeSpeaker && s.activeSpeaker) note(s.activeSpeaker)
      })
    })
    await say(page, READBACK)
    await expect.poll(() => inputs.length).toBe(2)
    expect(await logged(page)).toHaveLength(1)
    ai.release()
    await expect.poll(() => app.playhead((s) => [s.activeCallsign, s.activeSpeaker])).toEqual([AAL.icao24, 'pilot'])
    expect(speakers).toEqual(['pilot'])
    const readback = calls.filter({ hasText: 'American 100, left 220, up to 5,000.' })
    await expect(readback.getByText('Pilot', { exact: true })).toBeVisible()

    // The plain-English line, a handoff chip; the raw words still searchable.
    await expect(transcript.getByText('American 100 should turn left')).toHaveCount(0)
    await transcript.getByRole('switch', { name: 'Explain calls' }).click()
    await expect(transcript.getByText('American 100 should turn left to 220°')).toBeVisible()
    const search = transcript.getByRole('searchbox', { name: 'Search transcripts' })
    await search.fill('niner')
    await expect(transcript.getByText(/^1 match\b/)).toBeVisible()
    await expect(transcript.locator('mark').first()).toHaveText(/^niner$/i)
    await search.fill('')
    await transcript.getByRole('switch', { name: 'Explain calls' }).click()

    // Following the handoff tunes Departure.
    await transcript.getByRole('button', { name: 'Switch to Departure 135.9' }).click()
    await expect.poll(() => app.playhead((s) => s.stationId)).toMatch(/dep/i)

    // The flight's story, from the extracted instructions.
    if (!app.docked) await page.evaluate(() => window.__atc.playhead.getState().setPanel(null))
    await page.evaluate((id) => window.__atc.playhead.getState().select(id), AAL.icao24)
    await app.openFlightDetail()
    await expect(app.flightDetail().getByRole('region', { name: 'Live radio calls' })).toContainText('Turn left 220 → climb 5,000 → contact Departure 135.9')
    expect(inputs).toHaveLength(2)
  })

  test('a slow answer: the call is shown as heard after about eight seconds, marked, then upgraded in place', async ({ app, page }) => {
    test.slow()
    const ai = await fakeAi(page)
    await app.open('JFK')
    await openTranscript(page)
    const transcript = app.view('transcripts', 'Transcripts')
    const calls = transcript.getByRole('listitem')

    // Timed inside the page (the test's own clock includes however long the browser took to answer it).
    await page.evaluate(() => {
      const w = window as unknown as { __heardAt: number; __shownAfterMs: number | null }
      w.__shownAfterMs = null
      window.__atc.radio.subscribe((s) => {
        if (w.__shownAfterMs == null && Object.values(s.log).some((l) => l.length)) w.__shownAfterMs = Date.now() - w.__heardAt
      })
      w.__heardAt = Date.now()
    })
    await say(page, ATC)
    await expect.poll(() => ai.inputs.length).toBe(1)
    // Not before the wait is over...
    await page.waitForTimeout(4000)
    expect(await logged(page)).toEqual([])
    // ...then as heard, with the quiet mark, in the transcript and in the app's log.
    const raw = calls.filter({ hasText: ATC })
    await expect(raw).toBeVisible({ timeout: 15_000 })
    const waited = await page.evaluate(() => (window as unknown as { __shownAfterMs: number }).__shownAfterMs)
    expect(waited).toBeGreaterThanOrEqual(7900)
    expect(waited).toBeLessThan(12_000)
    await expect(raw.locator('[data-unprocessed]')).toHaveText('unprocessed')
    expect(await logged(page)).toEqual([{ text: ATC, unprocessed: true, speaker: 'controller' }])

    // The late answer replaces the words where they stand: still one call, no longer marked.
    ai.release()
    await expect(calls.filter({ hasText: 'turn left heading 220, climb and maintain 5,000' })).toBeVisible()
    await expect(transcript.locator('[data-unprocessed]')).toHaveCount(0)
    await expect(calls).toHaveCount(1)
    expect(await logged(page)).toMatchObject([{ unprocessed: false, speaker: 'controller' }])
  })

  test('AI not set up: nothing is sent, nothing waits, calls are shown as heard and marked', async ({ app, page, stubs }) => {
    await app.open('JFK')
    await say(page, ATC)
    const caption = page.getByRole('button', { name: 'Open the radio transcript' })
    await expect(caption).toContainText(ATC, { timeout: 5000 })
    await expect(caption.locator('[data-unprocessed]')).toBeVisible()
    // Once it is known that AI is unavailable, a call is published in the same tick it is heard.
    const immediate = await page.evaluate((t) => {
      const s = window.__atc.playhead.getState()
      window.__atc.ingest(t, { stationId: s.stationId, airport: s.airportIcao, kind: 'TWR', endedAt: Date.now(), durationMs: 3000 })
      return (window.__atc.radio.getState().log[s.stationId] ?? []).map((x) => [x.text, x.unprocessed])
    }, READBACK)
    expect(immediate).toEqual([
      [ATC, true],
      [READBACK, true],
    ])
    await openTranscript(page)
    const transcript = app.view('transcripts', 'Transcripts')
    await expect(transcript.getByText('AI clean-up is off: calls are shown as heard')).toBeVisible()
    await expect(transcript.getByRole('switch', { name: 'Explain calls' })).toHaveCount(0)
    await expect(transcript.getByRole('listitem').filter({ hasText: ATC }).locator('[data-unprocessed]')).toBeVisible()
    expect(stubs.apiCalls.filter((c) => c.startsWith('POST /api/ai'))).toEqual([])
  })

  test.describe('at the daily limit', () => {
    // The refusal is a real 429, which the browser reports in its console.
    test.use({ allowedErrors: [/status of 429/] })

    test('the daily limit: one quiet notice, then calls are shown at once without asking again', async ({ app, page }) => {
      const ai = await fakeAi(page, { refuse: { ok: false, task: 'radioCleanup', error: 'AI daily limit reached', status: 429, code: 'daily_cap', retryAfterS: 3600 } })
      await app.open('JFK')
      await say(page, ATC)
      await expect.poll(() => logged(page)).toEqual([{ text: ATC, unprocessed: true, speaker: 'controller' }])
      await expect(page.getByText('AI daily limit reached. Radio calls are shown as heard until tomorrow.')).toBeVisible()
      // The next call does not wait and does not ask.
      await say(page, READBACK)
      expect(await logged(page)).toHaveLength(2)
      expect(ai.inputs).toHaveLength(1)
      await openTranscript(page)
      await expect(app.view('transcripts', 'Transcripts').getByText('AI daily limit reached: calls are shown as heard until tomorrow')).toBeVisible()
    })
  })
})
