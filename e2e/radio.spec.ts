/**
 * Live radio, end to end: the LiveATC stream is a stubbed loop of quiet with
 * two bursts of radio-like noise (e2e/fixtures/audio/radio-stream.mp3). The
 * app's own segmenter cuts each burst out as a transmission and uploads it to
 * `/api/transcribe`, whose stub answers with the next queued transcript. The
 * app then names the aircraft, captions the call and lets soft waves in the
 * speaker's colour pulse out from it (pink for the tower, blue for the pilot),
 * while the automatic camera eases in on it.
 */
import { JFK } from './support/fixtures'
import { expect, test, type Page } from './support/test'

/** First burst: the controller to American 100, climbing out. Second: Delta 2692 calling the tower. */
const CALLS = [
  { text: 'American one hundred, turn left heading two two zero, contact New York departure', speaker: 'controller', aircraft: JFK.departure },
  { text: 'Kennedy tower, Delta twenty six ninety two, ready at three one left', speaker: 'pilot', aircraft: JFK.taxiing },
] as const

/** The owner's speaker colours (src/ui/speaker.ts): the tower talking pink, the aircraft talking blue. */
const ATC_PINK = '#F178B6'
const PILOT_BLUE = '#60A5FA'

const radio = (page: Page) =>
  page.evaluate(() => {
    const r = window.__atc.radio.getState()
    return { on: r.on, status: r.status, calls: Object.values(r.log).flat().length }
  })

/**
 * The waves around the talking aircraft: the colour they are drawn in, the
 * aircraft they are drawn on, and whether anything of the old tower-to-aircraft
 * ripple is left in the style. The glow and its rings are only ever on the
 * transmitting aircraft (`tx`); they glide from one speaker's colour to the
 * other's, so the colour is polled until it settles.
 */
const waves = (page: Page) =>
  page.evaluate(() => {
    const map = window.__atc.mapHandle.current!
    const color = String(map.getPaintProperty('ac-talk-glow', 'circle-color')).toUpperCase()
    const rings = ['ac-talk-wave-1', 'ac-talk-wave-2', 'ac-talk-wave-3'].map((id) => String(map.getPaintProperty(id, 'circle-stroke-color')).toUpperCase())
    const on = map.queryRenderedFeatures({ layers: ['ac-talk-glow'] }).map((f) => f.properties?.icao24 as string)
    const ripple = map.getStyle().layers.filter((l) => /ripple/.test(l.id)).length + (map.getSource('radio-ripple') ? 1 : 0)
    return { color, rings, on, ripple }
  })

/** The camera: its zoom, whether it is on automatic, and how far (in pixels) an aircraft is from the middle of the framed view. */
const camera = (page: Page, icao: string) =>
  page.evaluate((id) => {
    const map = window.__atc.mapHandle.current!
    const a = window.__atc.liveBuffer.sample().find((x) => x.icao24 === id)
    const c = map.project(map.getCenter())
    const p = a ? map.project([a.lon, a.lat]) : null
    return { zoom: map.getZoom(), mode: window.__atc.playhead.getState().cameraMode, off: p ? Math.hypot(p.x - c.x, p.y - c.y) : Infinity, moving: map.isMoving() }
  }, icao)

test.describe('live radio', () => {
  test('play, hear a call, see it captioned, highlighted and in the transcript', async ({ app, page, stubs }) => {
    stubs.transcribeQueue.push(...CALLS.map((c) => ({ text: c.text })))
    await app.open('JFK')
    await page.getByRole('button', { name: /^Listen live to / }).click()
    await expect(page.getByRole('status').filter({ hasText: /Connecting|Live/i }).first()).toBeVisible()
    await expect.poll(async () => (await radio(page)).status, { timeout: 30_000 }).toBe('live')
    await expect(page.getByRole('button', { name: /^Stop listening to / })).toBeVisible()

    // The first burst: transcribed, captioned, attributed to the controller, the aircraft pulsing ATC pink.
    const caption = page.getByRole('button', { name: 'Open the radio transcript' })
    await expect(caption).toContainText(CALLS[0].text, { timeout: 45_000 })
    await expect.poll(() => app.playhead((s) => [s.activeCallsign, s.activeSpeaker])).toEqual([CALLS[0].aircraft.icao24, 'controller'])
    // (The colour first: it is set at once, while the aircraft is only drawn with its waves once the camera has reached it.)
    await expect.poll(async () => (await waves(page)).color).toBe(ATC_PINK)
    expect(stubs.apiCalls).toContainEqual(expect.stringMatching(/^POST \/api\/transcribe\?facility=New\+York\+JFK\+Tower/))

    // The second: the pilot of another aircraft, pulsing blue.
    await expect(caption).toContainText(CALLS[1].text, { timeout: 45_000 })
    await expect.poll(() => app.playhead((s) => [s.activeCallsign, s.activeSpeaker])).toEqual([CALLS[1].aircraft.icao24, 'pilot'])
    await expect.poll(async () => (await waves(page)).color).toBe(PILOT_BLUE)

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
    // Only radio here: takeoffs and landings are listed under Recent activity in the traffic panel.
    const filters = transcript.getByRole('toolbar', { name: 'Filters' })
    await expect(filters.getByRole('button', { name: 'Tower log' })).toHaveCount(0)
    await filters.getByRole('button', { name: 'Only calls on this channel' }).click()
    await expect(transcript.getByRole('listitem').filter({ hasText: CALLS[0].text })).toBeVisible()
    await filters.getByRole('button', { name: 'Only calls on this channel' }).click()

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

  // Through the same function the transcriber calls, so no audio is needed.
  const say = (page: Page, text: string) =>
    page.evaluate((t) => {
      const s = window.__atc.playhead.getState()
      window.__atc.ingest(t, { stationId: s.stationId, airport: s.airportIcao, kind: 'TWR', endedAt: Date.now(), durationMs: 2500 })
    }, text)

  test('an injected call pulses waves from the aircraft in the speaker colour', async ({ app, page }) => {
    await app.open('JFK')
    await say(page, CALLS[0].text)
    await expect.poll(() => app.playhead((s) => [s.activeCallsign, s.activeSpeaker])).toEqual([CALLS[0].aircraft.icao24, 'controller'])
    await expect.poll(async () => (await waves(page)).color).toBe(ATC_PINK)
    await expect(page.getByRole('button', { name: 'Open the radio transcript' })).toContainText(CALLS[0].text)
    // The rings share the glow's colour, and nothing is drawn between tower and aircraft any more.
    const first = await waves(page)
    expect(new Set(first.rings)).toEqual(new Set([ATC_PINK]))
    expect(first.ripple).toBe(0)
    // Once the camera has it in view, that aircraft and only that one wears the waves.
    await expect.poll(async () => (await waves(page)).on, { timeout: 30_000 }).toEqual([CALLS[0].aircraft.icao24])

    await say(page, CALLS[1].text)
    await expect.poll(() => app.playhead((s) => [s.activeCallsign, s.activeSpeaker])).toEqual([CALLS[1].aircraft.icao24, 'pilot'])
    await expect.poll(async () => (await waves(page)).color).toBe(PILOT_BLUE)
    await expect.poll(async () => (await waves(page)).on, { timeout: 30_000 }).toContain(CALLS[1].aircraft.icao24)
  })

  test('the automatic camera eases in on the aircraft and a touch on the map hands it back', async ({ app, page }) => {
    await app.open('JFK')
    await app.waitForCameraIdle()
    const id = JFK.taxiing.icao24
    const home = await camera(page, id)
    expect(home.mode).toBe('auto')

    // The tower calls the taxiing Delta: the camera comes in on it, and stays on automatic.
    await say(page, 'Delta twenty six ninety two, runway three one left, line up and wait')
    await expect.poll(() => app.playhead((s) => s.activeCallsign)).toBe(id)
    await expect.poll(async () => (await camera(page, id)).zoom, { timeout: 30_000 }).toBeGreaterThan(home.zoom + 1.5)
    await app.waitForCameraIdle()
    const framed = await camera(page, id)
    expect(framed.mode).toBe('auto')
    expect(framed.off).toBeLessThan(60)
    // A modest zoom: the airfield around the aircraft stays in view.
    expect(framed.zoom).toBeLessThan(15.2)

    // The pilot reads back: the same aircraft is already framed, so the camera stays put.
    await say(page, 'Three one left, line up and wait, Delta twenty six ninety two')
    await expect.poll(() => app.playhead((s) => s.activeSpeaker)).toBe('pilot')
    await page.waitForTimeout(1200)
    expect((await camera(page, id)).zoom).toBeCloseTo(framed.zoom, 1)

    // A touch on the map while it holds on the aircraft: the map is the person's until they hand it back.
    const box = (await page.locator('.maplibregl-canvas').boundingBox())!
    const at = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 }
    if (app.isMobile) await page.touchscreen.tap(at.x, at.y)
    else await page.mouse.click(at.x, at.y)
    await expect.poll(() => app.playhead((s) => s.cameraMode)).toBe('manual')
    await expect(page.getByRole('button', { name: 'Back to automatic map' })).toBeVisible()
    // It does not pull back out by itself once the exchange ends.
    await expect.poll(() => page.evaluate(() => window.__atc.radio.getState().focus), { timeout: 20_000 }).toBeNull()
    await page.waitForTimeout(3500)
    expect((await camera(page, id)).zoom).toBeCloseTo(framed.zoom, 1)

    // Handing it back: the camera eases out to the airfield again.
    await page.getByRole('button', { name: 'Back to automatic map' }).click()
    await expect.poll(async () => (await camera(page, id)).zoom, { timeout: 30_000 }).toBeLessThan(home.zoom + 0.5)
  })
})
