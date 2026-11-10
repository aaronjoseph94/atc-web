/**
 * Network stubs: every API the app calls is answered from recorded fixtures
 * (e2e/fixtures), so the tests see the same sky every run and never touch a
 * live feed. Requests to any host the tests don't know about are refused and
 * reported, so a new un-stubbed dependency fails loudly instead of flaking.
 *
 * Map tiles are the one exception: by default OpenFreeMap is let through (the
 * map needs a base layer and nothing asserts on its contents). Set
 * `E2E_TILES=blank` to answer tiles with empty ones and run fully offline.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page, Route } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtures = path.join(here, '..', 'fixtures')
const root = path.join(here, '..', '..')

const cache = new Map<string, Buffer>()
function file(rel: string): Buffer {
  let b = cache.get(rel)
  if (!b) {
    b = readFileSync(path.join(fixtures, rel))
    cache.set(rel, b)
  }
  return b
}
const json = <T>(rel: string): T => JSON.parse(file(rel).toString('utf8')) as T

/** Airports with recorded traffic and weather. Anywhere else gets an empty sky and no observation. */
export const RECORDED_AIRPORTS = ['JFK', 'ATL', 'YYC'] as const

export type TranscribeReply = { text: string } | { status: number; body?: unknown }

export type StubOptions = {
  /** Every live feed answers 503: aircraft, weather, flight details, health. */
  feedsDown?: boolean
  /** LiveATC answers this status instead of a stream. */
  streamStatus?: number
}

/**
 * Runs in the page. A stubbed response arrives all at once and then ends,
 * and the radio player (rightly) treats the end of a live stream as a drop.
 * So stream fetches get the fixture's bytes back as a never-ending stream:
 * a few seconds up front, then about real time, looping, until aborted.
 */
function liveStreamShim() {
  const original = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.startsWith('https://d.liveatc.net/')) return original(input, init)
    const res = await original(input, init)
    if (!res.ok) return res
    const bytes = new Uint8Array(await res.arrayBuffer())
    const signal = init?.signal
    // 16 kbit/s mono: 2 KB a second; send it a quarter second at a time.
    const step = 512
    let at = 0
    let timer = 0
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const push = (n: number) => {
          for (let i = 0; i < n; i++) {
            const end = Math.min(bytes.length, at + step)
            controller.enqueue(bytes.slice(at, end))
            at = end >= bytes.length ? 0 : end
          }
        }
        push(16)
        timer = window.setInterval(() => push(1), 250)
        signal?.addEventListener('abort', () => {
          window.clearInterval(timer)
          try {
            controller.error(new DOMException('aborted', 'AbortError'))
          } catch {
            // Already closed.
          }
        })
      },
      cancel() {
        window.clearInterval(timer)
      },
    })
    return new Response(body, { status: 200, headers: res.headers })
  }
}

/**
 * Answer a media request the way a static host does, honouring `Range`:
 * the audio element seeks by asking for byte ranges, and without them it can
 * only seek within what it has already downloaded.
 */
function fulfillRange(route: Route, body: Buffer, contentType: string) {
  const range = /bytes=(\d*)-(\d*)/.exec(route.request().headers()['range'] ?? '')
  if (!range) return route.fulfill({ status: 200, contentType, headers: { 'accept-ranges': 'bytes' }, body })
  const start = range[1] ? Number(range[1]) : Math.max(0, body.length - Number(range[2]))
  const end = range[1] && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1
  return route.fulfill({
    status: 206,
    contentType,
    headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${body.length}` },
    body: body.subarray(start, end + 1),
  })
}

export class Stubs {
  /** Requests to hosts nobody stubbed (refused). Checked after every test. */
  readonly unexpected: string[] = []
  /** Every `/api/*` path the page asked for, for assertions. */
  readonly apiCalls: string[] = []
  /** Answers for the next `/api/transcribe` uploads, in order. Once empty, every call comes back as silence (no text). */
  readonly transcribeQueue: TranscribeReply[] = []
  readonly options: StubOptions

  constructor(options: StubOptions = {}) {
    this.options = { ...options }
  }

  set(options: StubOptions) {
    Object.assign(this.options, options)
  }

  async install(page: Page) {
    await page.addInitScript(liveStreamShim)
    const tiles = process.env.E2E_TILES === 'blank' ? 'blank' : 'live'
    await page.route(
      (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
      (route) => this.external(route, tiles),
    )
    await page.route(/\/api\//, (route) => this.api(route))
    await page.route(/\/clips\/[\w-]+\/audio\.mp3/, (route) => fulfillRange(route, file('audio/silence-140s.mp3'), 'audio/mpeg'))
  }

  private async external(route: Route, tiles: 'live' | 'blank') {
    const url = new URL(route.request().url())
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: file('fonts/google-fonts.css') })
    if (url.hostname === 'fonts.gstatic.com') {
      const name = url.pathname.split('/').pop() ?? ''
      try {
        return await route.fulfill({ status: 200, contentType: 'font/woff2', body: file(`fonts/${name}`) })
      } catch {
        return route.fulfill({ status: 404 })
      }
    }
    if (url.hostname === 'tiles.openfreemap.org') {
      if (tiles === 'live') return route.continue()
      // An empty body is a valid vector tile with no layers; the glyph ranges are tiny protobufs too.
      if (url.pathname === '/planet')
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tilejson: '3.0.0', tiles: ['https://tiles.openfreemap.org/planet/e2e/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 }) })
      return route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0) })
    }
    if (url.hostname === 'd.liveatc.net') {
      const status = this.options.streamStatus
      if (status) return route.fulfill({ status, headers: { 'access-control-allow-origin': '*' }, body: '' })
      return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'audio/mpeg', 'cache-control': 'no-store' }, body: file('audio/radio-stream.mp3') })
    }
    this.unexpected.push(url.href.slice(0, 200))
    return route.abort('blockedbyclient')
  }

  private async api(route: Route) {
    const req = route.request()
    const url = new URL(req.url())
    const p = url.pathname
    this.apiCalls.push(`${req.method()} ${p}${url.search}`)
    const airport = (url.searchParams.get('airport') ?? 'ORD').toUpperCase()
    const recorded = (RECORDED_AIRPORTS as readonly string[]).includes(airport)
    const down = this.options.feedsDown
    const send = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
      route.fulfill({ status, contentType: 'application/json', headers: { 'cache-control': 'no-store', ...headers }, body: JSON.stringify(body) })

    if (p === '/api/aircraft') {
      if (down) return send({ error: 'all feeds failed' }, 503)
      const list = recorded ? json(`api/aircraft-${airport}.json`) : []
      return send(list, 200, { 'X-Provider': 'adsb.fi + adsb.lol', 'X-Sources': 'adsb.fi,adsb.lol', 'Access-Control-Expose-Headers': 'X-Provider, X-Sources, X-Upstream-Error' })
    }
    if (p === '/api/weather') {
      if (down) return send({ error: 'weather unavailable' }, 503)
      if (recorded) return send(json(`api/weather-${airport}.json`))
      return send({ airport, icao: `K${airport}`, metar: null, atis: [], taf: null, fetchedAt: new Date().toISOString() })
    }
    if (p === '/api/flight') {
      if (down) return send({ error: 'flight details unavailable' }, 503)
      const callsign = (url.searchParams.get('callsign') ?? '').toUpperCase()
      const flights = json<Record<string, unknown>>('api/flights.json')
      return send(flights[callsign] ?? { callsign: callsign || null, airline: null, origin: null, destination: null, typeName: null, manufacturer: null, registration: null, owner: null })
    }
    if (p === '/api/health') {
      if (down) return send({ ok: false, provider: null, aircraft: 0, latencyMs: 0, runtime: 'e2e', error: 'all feeds failed', checkedAt: new Date().toISOString() }, 503)
      return send(json('api/health-JFK.json'))
    }
    if (p === '/api/summarize') {
      if (req.method() === 'GET') return send(json('api/summarize-status.json'))
      // The rule-based summary the server falls back to without AI: the last call, plainly.
      const body = (req.postDataJSON() ?? {}) as { transmissions?: { text?: string }[] }
      const last = body.transmissions?.at(-1)?.text ?? ''
      return send({ summary: last ? `Last call: ${last}` : 'No calls yet.', source: 'rules' })
    }
    if (p === '/api/transcribe') {
      const next = this.transcribeQueue.shift()
      if (!next) return send({ text: '', segments: [] })
      if ('text' in next) return send({ text: next.text, segments: [] })
      return send(next.body ?? {}, next.status)
    }
    const clip = /^\/api\/clips\/([\w-]+)$/.exec(p)
    if (clip) {
      try {
        return await send(JSON.parse(readFileSync(path.join(root, 'public', 'clips', clip[1], 'manifest.json'), 'utf8')))
      } catch {
        return send({ error: 'not found' }, 404)
      }
    }
    this.unexpected.push(`${req.method()} ${p}`)
    return send({ error: 'not stubbed' }, 404)
  }
}
