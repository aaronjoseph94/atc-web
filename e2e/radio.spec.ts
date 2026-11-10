/**
 * Live radio, end to end: the LiveATC stream is a stubbed loop of quiet with
 * two bursts of radio-like noise (e2e/fixtures/audio/radio-stream.mp3). The
 * app's own segmenter cuts each burst out as a transmission and uploads it to
 * `/api/transcribe`, whose stub answers with the next queued transcript. The
 * app then names the aircraft, captions the call and highlights the aircraft
 * in the speaker's colour.
 */
import { JFK } from './support/fixtures'
import { expect, test, type Page } from './support/test'

/** First burst: the controller to American 100, climbing out. Second: Delta 2692 calling the tower. */
const CALLS = [
  { text: 'American one hundred, turn left heading two two zero, contact New York departure', speaker: 'controller', aircraft: JFK.departure },
  { text: 'Kennedy tower, Delta twenty six ninety two, ready at three one left', speaker: 'pilot', aircraft: JFK.taxiing },
] as const

/** The owner's speaker colours (src/ui/speaker.ts): ATC talking purple, the aircraft talking blue. */
const ATC_PURPLE = '#7C5CFC'
const PILOT_BLUE = '#3B9BFF'

const radio = (page: Page) =>
  page.evaluate(() => {
    const r = window.__atc.radio.getState()
    return { on: r.on, status: r.status, calls: Object.values(r.log).flat().length }
  })

/**
 * The halo around the talking aircraft: the colour it is drawn in and the
 * aircraft it is drawn on. The halo paints the transmitting aircraft (`tx`)
 * in the speaker's colour, anything else highlighted in plain purple.
 */
const halo = (page: Page) =>
  page.evaluate(() => {
    const map = window.__atc.mapHandle.current!
    const paint = map.getPaintProperty('ac-halo', 'circle-color') as unknown
    const talking = Array.isArray(paint) && paint[0] === 'case' ? paint[2] : paint
    const on = map.queryRenderedFeatures({ layers: ['ac-halo'] }).map((f) => f.properties?.icao24 as string)
    return { color: String(talking).toUpperCase(), on }
  })

test.describe('live radio', () => {
  test('play, hear a call, see it captioned, highlighted and in the transcript', async ({ app, page, stubs }) => {
    stubs.transcribeQueue.push(...CALLS.map((c) => ({ text: c.text })))
    await app.open('JFK')
    await page.getByRole('button', { name: /^Listen live to / }).click()
    await expect(page.getByRole('status').filter({ hasText: /Connecting|Live/i }).first()).toBeVisible()
    await expect.poll(async () => (await radio(page)).status, { timeout: 30_000 }).toBe('live')
    await expect(page.getByRole('button', { name: /^Stop listening to / })).toBeVisible()

    // The first burst: transcribed, captioned, attributed to the controller, the aircraft ringed in ATC purple.
    const caption = page.getByRole('button', { name: 'Open the radio transcript' })
    await expect(caption).toContainText(CALLS[0].text, { timeout: 45_000 })
    await expect.poll(() => app.playhead((s) => [s.activeCallsign, s.activeSpeaker])).toEqual([CALLS[0].aircraft.icao24, 'controller'])
    await expect.poll(async () => (await halo(page)).on, { timeout: 30_000 }).toContain(CALLS[0].aircraft.icao24)
    await expect.poll(async () => (await halo(page)).color).toBe(ATC_PURPLE)
    expect(stubs.apiCalls).toContainEqual(expect.stringMatching(/^POST \/api\/transcribe\?facility=New\+York\+JFK\+Tower/))

    // The second: the pilot of another aircraft, ringed in blue.
    await expect(caption).toContainText(CALLS[1].text, { timeout: 45_000 })
    await expect.poll(() => app.playhead((s) => [s.activeCallsign, s.activeSpeaker])).toEqual([CALLS[1].aircraft.icao24, 'pilot'])
    await expect.poll(async () => (await halo(page)).color).toBe(PILOT_BLUE)

    // The transcript: both calls, searchable, filterable to radio calls.
    await caption.click()
    const transcript = app.view('transcripts', 'Transcripts')
    await expect(transcript).toBeVisible()
    for (const c of CALLS) await expect(transcript.getByRole('listitem').filter({ hasText: c.text })).toBeVisible()
    const search = transcript.getByRole('searchbox', { name: 'Search transcripts' })
    await search.fill('heading')
    await expect(transcript.getByText(/^1 match\b/)).toBeVisible()
    await expect(transcript.getByRole('listitem')).toHaveCount(1)
    await expect(transcript.locator('mark').first()).toHaveText(/^heading$/i)
    await search.fill('')
    const filters = transcript.getByRole('toolbar', { name: 'Filters' })
    await filters.getByRole('button', { name: 'Tower log' }).click()
    await expect(transcript.getByRole('listitem').filter({ hasText: CALLS[0].text })).toHaveCount(0)
    await filters.getByRole('button', { name: 'Tower log' }).click()
    await filters.getByRole('button', { name: 'Radio' }).click()
    await expect(transcript.getByRole('listitem').filter({ hasText: CALLS[0].text })).toBeVisible()

    // Tapping a call points at its aircraft: it replays the call's recorded audio and lights the
    // aircraft up, or (with no audio kept) selects it.
    const id = CALLS[0].aircraft.icao24
    // Wait for the live highlight to let go first: the transcriber's hold timer from the last call
    // would otherwise also end the highlight this tap starts.
    await expect.poll(() => page.evaluate(() => window.__atc.radio.getState().focus), { timeout: 20_000 }).toBeNull()
    await transcript.getByRole('listitem').filter({ hasText: CALLS[0].text }).getByRole('button').click()
    await expect.poll(() => app.playhead((s) => [s.activeCallsign, s.selectedIcao]), { timeout: 10_000 }).toContainEqual(id)

    // The aircraft's full view lists the call.
    if (!app.docked) await expect(transcript).toBeHidden()
    if ((await app.playhead((s) => s.selectedIcao)) !== id) await app.tapAircraft(id)
    await app.openFlightDetail()
    await expect(app.flightDetail().getByRole('region', { name: 'Live radio calls' })).toContainText(CALLS[0].text)

    // Stop.
    await app.flightDetail().getByRole('button', { name: 'Close flight' }).click()
    await page.getByRole('button', { name: /^Stop listening to / }).click()
    await expect.poll(async () => (await radio(page)).status).toBe('off')
  })

  test('an injected call highlights the aircraft in the speaker colour', async ({ app, page }) => {
    await app.open('JFK')
    // Through the same function the transcriber calls, so no audio is needed.
    const say = (text: string) =>
      page.evaluate((t) => {
        const s = window.__atc.playhead.getState()
        window.__atc.ingest(t, { stationId: s.stationId, airport: s.airportIcao, kind: 'TWR', endedAt: Date.now(), durationMs: 2500 })
      }, text)
    await say(CALLS[0].text)
    await expect.poll(() => app.playhead((s) => [s.activeCallsign, s.activeSpeaker])).toEqual([CALLS[0].aircraft.icao24, 'controller'])
    await expect.poll(async () => (await halo(page)).color).toBe(ATC_PURPLE)
    await expect.poll(async () => (await halo(page)).on, { timeout: 30_000 }).toContain(CALLS[0].aircraft.icao24)
    await expect(page.getByRole('button', { name: 'Open the radio transcript' })).toContainText(CALLS[0].text)

    await say(CALLS[1].text)
    await expect.poll(() => app.playhead((s) => [s.activeCallsign, s.activeSpeaker])).toEqual([CALLS[1].aircraft.icao24, 'pilot'])
    await expect.poll(async () => (await halo(page)).color).toBe(PILOT_BLUE)
    await expect.poll(async () => (await halo(page)).on, { timeout: 30_000 }).toContain(CALLS[1].aircraft.icao24)
  })
})
