/**
 * The AI pass over live radio calls, with `/api/ai` answered here by
 * realistic `radioCleanup` results (no key is needed): calls are injected
 * through the transcriber's `ingest()`, shown raw at once, then swapped for
 * the cleaned words; a confident speaker re-colours the highlight while the
 * call is still on the air; instructions become a badge on the map, a
 * handoff chip and the flight's story. Without AI, nothing is sent and the
 * transcript only says, once, that a key would help.
 */
import type { Page, Route } from '@playwright/test'
import { JFK } from './support/fixtures'
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
 * test to `release()` it, so the raw transcript can be seen first however
 * slowly the page runs.
 */
async function fakeAi(page: Page) {
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
    if (req.method() === 'GET') return send({ configured: true, provider: 'anthropic', model: 'test', keySource: 'server', server: { anthropic: true, openrouter: false } })
    const body = req.postDataJSON() as { task: string; input: { text: string } }
    // Other AI features (the airport briefing, alerts…) ask too; this spec is about the radio pass only.
    if (body.task !== 'radioCleanup') return send({ ok: false, task: body.task, error: 'not in this test', status: 503 })
    const n = inputs.push(body.input) - 1
    await turn(n)
    const result = ANSWERS[body.input.text]
    if (body.task !== 'radioCleanup' || !result) return send({ ok: false, error: 'unexpected' }, 500)
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

/** The badges drawn this frame (from the source's data: the aircraft may be off screen). */
const badges = (page: Page) =>
  page.evaluate(() => {
    const src = window.__atc.mapHandle.current!.getSource('instruction-badges') as unknown as { serialize: () => { data: { features?: { properties: { img: string } }[] } } }
    return (src.serialize().data.features ?? []).map((f) => f.properties.img)
  })

test.describe('radio AI', () => {
  test('cleans, explains, re-attributes and turns instructions into data', async ({ app, page }) => {
    // Many steps, each waiting on software-rendered frames.
    test.slow()
    const ai = await fakeAi(page)
    const inputs = ai.inputs
    await app.open('JFK')
    // Watch the transcript (the caption line fades after a few seconds, and software rendering is slow).
    await openTranscript(page)
    const transcript = app.view('transcripts', 'Transcripts')
    const calls = transcript.getByRole('listitem')

    // Raw words at once, cleaned ones a moment later.
    await say(page, ATC)
    await expect(calls.filter({ hasText: ATC })).toBeVisible()
    await expect.poll(() => inputs.length).toBe(1)
    ai.release()
    await expect(calls.filter({ hasText: 'turn left heading 220, climb and maintain 5,000, contact New York Departure 135.9.' })).toBeVisible()
    expect(inputs[0]).toMatchObject({ text: ATC, station: { airport: 'JFK', role: 'TWR' } })
    expect(JSON.stringify(inputs[0]).length).toBeLessThanOrEqual(2000)
    await expect.poll(() => badges(page), { timeout: 20_000 }).toContain('ib:HDG 220 · ↑5,000')

    // The read-back: the rules call it ATC (purple); the model is sure it is the pilot, so the highlight turns blue.
    await say(page, READBACK)
    await expect.poll(() => app.playhead((s) => [s.activeCallsign, s.activeSpeaker])).toEqual([AAL.icao24, 'controller'])
    await expect.poll(() => inputs.length).toBe(2)
    ai.release()
    await expect.poll(() => app.playhead((s) => s.activeSpeaker)).toBe('pilot')
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

  test('without a key, nothing is sent and calls stay as heard', async ({ app, page, stubs }) => {
    await app.open('JFK')
    await say(page, ATC)
    const caption = page.getByRole('button', { name: 'Open the radio transcript' })
    await expect(caption).toContainText(ATC)
    await openTranscript(page)
    const transcript = app.view('transcripts', 'Transcripts')
    await expect(transcript.getByText('Add an AI key in Settings to clean up and explain calls')).toBeVisible()
    await expect(transcript.getByRole('switch', { name: 'Explain calls' })).toHaveCount(0)
    await expect(transcript.getByRole('listitem').filter({ hasText: ATC })).toBeVisible()
    expect(stubs.apiCalls.filter((c) => c.startsWith('POST /api/ai'))).toEqual([])
  })
})
