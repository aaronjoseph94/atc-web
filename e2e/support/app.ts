/**
 * Drives the app the way a person would (taps, drags, keys), using the
 * `window.__atc` debug handles only to find things on the map and to wait for
 * the app to settle. Every wait is on app state, never a fixed sleep: the map
 * renders in software here and its speed varies a lot between machines.
 */
import { expect, type Locator, type Page } from '@playwright/test'

/** Settings every test starts from: fixed daylight (not the real sun) and no first-run hint. */
export const defaultSettings = { lighting: 'day', hintSeen: true }

type Point = { x: number; y: number }

export class App {
  readonly page: Page
  constructor(page: Page) {
    this.page = page
  }

  get isMobile(): boolean {
    return (this.page.viewportSize()?.width ?? 1280) < 768
  }

  /** Wide screens (≥ 1024 px) dock the flight, radio transcript, traffic and weather in a side panel instead of sheets. */
  get docked(): boolean {
    return (this.page.viewportSize()?.width ?? 1280) >= 1024
  }

  /** The docked side panel (desktop). */
  sidePanel() {
    return this.page.getByRole('complementary', { name: 'Side panel' })
  }

  /**
   * Where the transcript, traffic or weather view shows: the side panel's Radio,
   * Traffic or Weather tab on a wide screen, otherwise a sheet with that title.
   * (`kind` documents which.)
   */
  view(_kind: 'transcripts' | 'traffic' | 'weather', title: string | RegExp) {
    return this.docked ? this.sidePanel() : this.page.getByRole('dialog', { name: title })
  }

  /** One of the side panel's tabs: Now, Radio, Traffic, Weather (its name may carry a count: "Traffic, 26 aircraft"). */
  dockTab(name: string | RegExp) {
    return this.sidePanel().getByRole('tab', { name })
  }

  /** The slim rail the side panel leaves behind when it is tucked away. */
  dockRail() {
    return this.page.getByRole('navigation', { name: 'Side panel, collapsed' })
  }

  /** Open an airport and wait until its traffic is on the map. */
  async open(airport = 'JFK', { traffic = true }: { traffic?: boolean } = {}) {
    await this.page.goto(`/#/${airport}`)
    await this.waitForMap()
    if (traffic) await this.waitForTraffic()
  }

  async waitForMap() {
    await this.page.waitForFunction(() => {
      // The app's own layers exist once the style has loaded. (Not `isStyleLoaded()`: that also waits
      // for every source to be idle, and the aircraft source is updated every frame.)
      const map = window.__atc?.mapHandle.current
      return !!map && !!map.getLayer('ac-hit')
    }, undefined, { timeout: 60_000 })
  }

  async waitForTraffic() {
    await this.page.waitForFunction(() => {
      const s = window.__atc.playhead.getState()
      return s.liveStatus === 'ok' && s.liveCount > 0 && window.__atc.liveBuffer.sample().length > 0
    }, undefined, { timeout: 45_000 })
  }

  /** Wait for the camera to stop moving (flights to an aircraft, the opening framing). */
  async waitForCameraIdle() {
    await this.page.waitForFunction(() => {
      const map = window.__atc.mapHandle.current
      return !!map && !map.isMoving() && !map.isZooming() && !map.isRotating()
    }, undefined, { timeout: 30_000 })
  }

  /** A slice of the app state, read once. */
  playhead<T>(fn: (s: ReturnType<Window['__atc']['playhead']['getState']>) => T): Promise<T> {
    return this.page.evaluate(`(${fn.toString()})(window.__atc.playhead.getState())`) as Promise<T>
  }

  settings<T>(fn: (s: ReturnType<Window['__atc']['settings']['getState']>) => T): Promise<T> {
    return this.page.evaluate(`(${fn.toString()})(window.__atc.settings.getState())`) as Promise<T>
  }

  /** Poll the app state until `fn` returns `expected`. */
  async expectPlayhead<T>(fn: (s: ReturnType<Window['__atc']['playhead']['getState']>) => T, expected: T, message?: string) {
    await expect.poll(() => this.playhead(fn), { message, timeout: 20_000 }).toEqual(expected)
  }

  /** Where an aircraft is on screen right now, or null when it is off the map. */
  async aircraftPoint(icao: string): Promise<Point | null> {
    return this.page.evaluate((id) => {
      const map = window.__atc.mapHandle.current
      const a = window.__atc.liveBuffer.sample().find((x) => x.icao24 === id)
      if (!map || !a) return null
      const p = map.project([a.lon, a.lat])
      const rect = map.getCanvas().getBoundingClientRect()
      // A tap picks the topmost aircraft under the finger, and parked jets can sit nose to tail:
      // look around the aircraft for a spot where it is the one on top.
      for (const [dx, dy] of [[0, 0], [8, 0], [-8, 0], [0, 8], [0, -8], [12, 12], [-12, -12], [12, -12], [-12, 12]]) {
        const x = rect.left + p.x + dx
        const y = rect.top + p.y + dy
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue
        const top = map.queryRenderedFeatures([p.x + dx, p.y + dy], { layers: ['ac-hit'] })[0]
        if (top?.properties?.icao24 === id) return { x, y }
      }
      return null
    }, icao)
  }

  /** Bring an aircraft into view, above the bottom sheet, without the automatic camera fighting back. */
  async showAircraft(icao: string, zoom = 14) {
    await this.page.evaluate(
      ([id, z]) => {
        const s = window.__atc.playhead.getState()
        s.setCameraMode('manual')
        const a = window.__atc.liveBuffer.sample().find((x) => x.icao24 === id)
        const map = window.__atc.mapHandle.current
        if (a && map) map.jumpTo({ center: [a.lon, a.lat], zoom: z, bearing: 0, pitch: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 } })
      },
      [icao, zoom] as const,
    )
    await this.waitForCameraIdle()
  }

  /** Tap (phone) or click (desktop) an aircraft on the map until it is selected. */
  async tapAircraft(icao: string) {
    await this.showAircraft(icao)
    await expect(async () => {
      const p = await this.aircraftPoint(icao)
      expect(p, `${icao} is drawn on the map`).not.toBeNull()
      if (this.isMobile) await this.page.touchscreen.tap(p!.x, p!.y)
      else await this.page.mouse.click(p!.x, p!.y)
      await expect.poll(() => this.playhead((s) => s.selectedIcao), { timeout: 4000 }).toBe(icao)
    }).toPass({ timeout: 40_000 })
  }

  /**
   * Drag from one point to another. With `touch`, real touch events (as a
   * finger would), otherwise the mouse. Steps keep it slow enough not to count as a flick.
   */
  async drag(from: Point, to: Point, { touch = this.isMobile, steps = 12 } = {}) {
    if (!touch) {
      await this.page.mouse.move(from.x, from.y)
      await this.page.mouse.down()
      for (let i = 1; i <= steps; i++) await this.page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps)
      await this.page.mouse.up()
      return
    }
    const cdp = await this.page.context().newCDPSession(this.page)
    const point = (x: number, y: number) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }]
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from.x, from.y) })
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps) })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await cdp.detach()
  }

  /** Wait for a sheet or card to finish sliding in: its own animations done and its box holding still. */
  async settled(locator: Locator) {
    await locator.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => null))))
    let last = ''
    await expect(async () => {
      const box = JSON.stringify(await locator.boundingBox())
      const same = box === last
      last = box
      expect(same, 'element has stopped moving').toBe(true)
    }).toPass({ intervals: [100, 150, 200], timeout: 10_000 })
  }

  /** Centre of an element's box. */
  async center(locator: Locator): Promise<Point> {
    const box = await locator.boundingBox()
    if (!box) throw new Error('element has no box')
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }

  /**
   * Hide the map (for screenshots of the UI alone: tiles and software WebGL differ between machines).
   * Transparent rather than hidden, so taps still reach it.
   */
  async hideMap() {
    await this.page.addStyleTag({ content: '.maplibregl-canvas, .maplibregl-control-container { opacity: 0 !important; }' })
  }

  /** The flight card (the purple sheet over the station bar). */
  flightCard(callsign?: string) {
    return this.page.locator('section[aria-label^="Flight "]').filter(callsign ? { hasText: callsign } : {})
  }

  /** The full flight view: a sheet on phones, a page over the side panel's tabs on wide screens. */
  flightDetail() {
    // (Callsign only: "Flight timeline" is a section inside it.)
    const name = /^Flight [A-Z0-9]+$/
    return this.docked ? this.sidePanel().getByRole('region', { name }) : this.page.getByRole('dialog', { name })
  }

  /** Open the full flight view of the selected aircraft (on a wide screen it already is). */
  async openFlightDetail() {
    if (!this.docked) await this.flightCard().getByRole('button', { name: 'Open full flight details' }).click()
    await expect(this.flightDetail()).toBeVisible()
  }

  stationBar() {
    return this.page.locator('div.on-yellow', { has: this.page.getByRole('button', { name: /^Change airport\./ }) })
  }
}
