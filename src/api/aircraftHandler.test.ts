import { afterEach, describe, expect, it, vi } from 'vitest'
import adsbFiFixture from './__fixtures__/adsbfi-jfk.json'
import adsbLolFixture from './__fixtures__/adsblol-jfk.json'
import airplanesLive403 from './__fixtures__/airplaneslive-403.json'
import {
  adsbFi,
  adsbLol,
  airplanesLive,
  fetchAircraftForAirport,
  handleAircraftRequest,
  jsonResponse,
  openSky,
  providersFor,
  type AircraftProvider,
  type FetchAircraftOptions,
} from './aircraftHandler'
import type { TimedAircraft } from './normalizeAircraft'
import { memoryCache, SourceHealth, sourceHealth, UpstreamError } from './sourceHealth'

const plane = (icao24: string, positionTime = 0, extra: Partial<TimedAircraft> = {}): TimedAircraft => ({
  icao24,
  callsign: 'X',
  lat: 0,
  lon: 0,
  heading: 0,
  altitudeFt: null,
  speedKt: null,
  onGround: false,
  positionTime,
  ...extra,
})

const ok = (name: string, n = 1, extra: Partial<AircraftProvider> = {}): AircraftProvider => ({
  name,
  fetch: async () => Array.from({ length: n }, (_, i) => plane(`${name}${i}`)),
  ...extra,
})
const fail = (name: string, status = 522, extra: Partial<AircraftProvider> = {}): AircraftProvider => ({
  name,
  fetch: async () => {
    throw new UpstreamError(`HTTP ${status}`, status)
  },
  ...extra,
})
const never = (name: string, onAbort?: () => void): AircraftProvider => ({
  name,
  fetch: (_apt, signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        onAbort?.()
        reject(new Error('aborted'))
      })
    }),
})

/** Fresh breaker per test so one test's failures don't reorder the next. */
const run = (providers: AircraftProvider[], o: FetchAircraftOptions = {}) =>
  fetchAircraftForAirport('ORD', { merge: false, health: new SourceHealth(), providers, ...o })

describe('fetchAircraftForAirport: failover', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the first provider when it succeeds', async () => {
    const r = await run([ok('a', 3), ok('b')])
    expect(r.provider).toBe('a')
    expect(r.aircraft).toHaveLength(3)
    expect(r.sources).toEqual(['a'])
  })

  it('falls through to the next provider on failure', async () => {
    const r = await run([fail('a'), fail('b'), ok('c', 2)])
    expect(r.provider).toBe('c')
    expect(r.aircraft).toHaveLength(2)
    expect(r.failures).toEqual(['a: HTTP 522', 'b: HTTP 522'])
  })

  it('throws with every cause when all providers fail', async () => {
    await expect(run([fail('a'), fail('b')])).rejects.toThrow(/a: HTTP 522; b: HTTP 522/)
  })

  it('starts the next provider when the first is slow, and the first answer wins', async () => {
    let aborted = false
    const r = await run([never('slow', () => (aborted = true)), ok('fast', 2)], { hedgeMs: 5 })
    expect(r.provider).toBe('fast')
    expect(aborted).toBe(true)
  })

  it('prefers the first provider when it answers inside the hedge window', async () => {
    const second = vi.fn(ok('b').fetch)
    const r = await run([ok('a'), { name: 'b', fetch: second }], { hedgeMs: 50 })
    expect(r.provider).toBe('a')
    expect(second).not.toHaveBeenCalled()
  })

  it('treats a timeout as a failure and moves on', async () => {
    const r = await run([never('hung'), ok('b')], { hedgeMs: 10_000, timeoutMs: 20 })
    expect(r.provider).toBe('b')
    expect(r.failures[0]).toMatch(/^hung: /)
  })

  it('double-checks an empty answer with one more feed', async () => {
    const r = await run([ok('a', 0), ok('b', 2), ok('c', 5)])
    expect(r.provider).toBe('b')
    expect(r.aircraft).toHaveLength(2)
  })

  it('returns an empty sky when two feeds agree it is empty, without asking a third', async () => {
    const third = vi.fn(ok('c').fetch)
    const r = await run([ok('a', 0), ok('b', 0), { name: 'c', fetch: third }])
    expect(r.aircraft).toEqual([])
    expect(r.provider).toBe('a')
    expect(third).not.toHaveBeenCalled()
  })

  it('uses a last-resort feed only when every regular feed errored', async () => {
    const last = vi.fn(ok('opensky', 1).fetch)
    const lr = { name: 'opensky', lastResort: true, fetch: last }
    // Listed first, still only reached after the others fail.
    const r = await run([lr, fail('a'), fail('b')])
    expect(r.provider).toBe('opensky')
    expect(last).toHaveBeenCalledOnce()

    last.mockClear()
    await run([lr, ok('a', 0), ok('b', 0)])
    expect(last).not.toHaveBeenCalled()
  })

  it('never hedges into a last-resort feed', async () => {
    const last = vi.fn(ok('opensky').fetch)
    const r = await run([never('slow'), { name: 'opensky', lastResort: true, fetch: last }], { hedgeMs: 5, timeoutMs: 60 })
    expect(last).toHaveBeenCalledOnce() // only after `slow` timed out
    expect(r.failures[0]).toMatch(/^slow: /)
  })
})

describe('fetchAircraftForAirport: health-aware order and circuit breaking', () => {
  it('skips a feed whose breaker opened and comes back to it after the cool-down', async () => {
    let now = 0
    const health = new SourceHealth({ failureThreshold: 2, cooldownMs: 1000, now: () => now })
    let aCalls = 0
    let aBroken = true
    const a: AircraftProvider = {
      name: 'a',
      fetch: async () => {
        aCalls++
        if (aBroken) throw new Error('HTTP 500')
        return [plane('a0')]
      },
    }
    const b = ok('b')
    const opts = { health, merge: false, providers: [a, b] }

    await expect(fetchAircraftForAirport('ORD', { ...opts, providers: [a] })).rejects.toThrow()
    expect(health.state('a')).toBe('closed') // one failure is a blip
    await expect(fetchAircraftForAirport('ORD', { ...opts, providers: [a] })).rejects.toThrow()
    expect(aCalls).toBe(2)
    expect(health.state('a')).toBe('open')

    // Breaker open: b goes first and answers, a is not called.
    const r = await fetchAircraftForAirport('ORD', opts)
    expect(r.provider).toBe('b')
    expect(aCalls).toBe(2)

    // Cool-down over: a is due a trial; b (healthy) still leads, so a recovers on its next turn.
    now = 1500
    aBroken = false
    expect(health.state('a')).toBe('half-open')
    const r2 = await fetchAircraftForAirport('ORD', { ...opts, providers: [a, fail('b')] })
    expect(r2.provider).toBe('a')
    expect(health.state('a')).toBe('closed')
  })

  it('puts the healthiest feed first: a feed that just failed yields the lead', async () => {
    const health = new SourceHealth()
    let aFails = true
    const a: AircraftProvider = { name: 'a', fetch: async () => (aFails ? Promise.reject(new Error('HTTP 500')) : [plane('a0')]) }
    const bFetch = vi.fn(ok('b').fetch)
    const opts = { health, merge: false, providers: [a, { name: 'b', fetch: bFetch }] }
    expect((await fetchAircraftForAirport('ORD', opts)).provider).toBe('b')
    aFails = false
    // a has a failure on record, so b now leads even though a is listed first.
    expect((await fetchAircraftForAirport('ORD', opts)).provider).toBe('b')
    expect(health.order(opts.providers).map((p) => p.name)).toEqual(['b', 'a'])
  })

  it('backs off for longer after a rate-limit answer', async () => {
    let now = 0
    const health = new SourceHealth({ failureThreshold: 3, cooldownMs: 1000, maxCooldownMs: 60_000, now: () => now })
    await fetchAircraftForAirport('ORD', { health, merge: false, providers: [fail('a', 429), ok('b')] })
    expect(health.state('a')).toBe('open')
    now = 30_000
    expect(health.state('a')).toBe('open')
    now = 61_000
    expect(health.state('a')).toBe('half-open')
  })
})

describe('fetchAircraftForAirport: merging', () => {
  it('asks the two healthiest feeds at once and keeps the freshest position per aircraft', async () => {
    const a: AircraftProvider = { name: 'a', fetch: async () => [plane('abc', 1000, { lat: 1, type: 'B738' }), plane('only-a', 1000)] }
    const b: AircraftProvider = { name: 'b', fetch: async () => [plane('abc', 2000, { lat: 2 }), plane('only-b', 1000)] }
    const c = vi.fn(ok('c').fetch)
    const r = await fetchAircraftForAirport('ORD', { health: new SourceHealth(), providers: [a, b, { name: 'c', fetch: c }] })
    expect(r.provider).toBe('a + b')
    expect(r.sources).toEqual(['a', 'b'])
    expect(c).not.toHaveBeenCalled()
    const abc = r.aircraft.find((x) => x.icao24 === 'abc')!
    expect(abc.lat).toBe(2) // b's fix is newer
    expect(abc.type).toBe('B738') // filled from a
    expect(r.aircraft.map((x) => x.icao24).sort()).toEqual(['abc', 'only-a', 'only-b'])
    // Each aircraft keeps when its position was measured: the map dates reports by it.
    expect(r.aircraft.every((x) => typeof x.positionTime === 'number')).toBe(true)
  })

  it('leaves a feed inside its request spacing out of the next round', async () => {
    const health = new SourceHealth()
    const fiFetch = vi.fn(ok('fi', 2).fetch)
    const fi: AircraftProvider = { name: 'fi', minIntervalMs: 60_000, fetch: fiFetch }
    const opts = { health, providers: [fi, ok('lol', 3)] }
    expect((await fetchAircraftForAirport('ORD', opts)).provider).toBe('fi + lol')
    // Called a moment ago: lol answers alone instead of fi earning a 429.
    expect((await fetchAircraftForAirport('JFK', opts)).provider).toBe('lol')
    expect(fiFetch).toHaveBeenCalledOnce()
  })

  it('does not wait forever for a slow merge partner', async () => {
    const r = await fetchAircraftForAirport('ORD', { health: new SourceHealth(), providers: [ok('a', 2), never('slow')], mergeWaitMs: 10 })
    expect(r.provider).toBe('a')
  })

  it('merges real adsb.fi and adsb.lol answers for the same airport', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('adsb.fi') ? adsbFiFixture : adsbLolFixture))),
    )
    const r = await fetchAircraftForAirport('JFK', { health: new SourceHealth(), providers: [adsbFi, adsbLol] })
    vi.unstubAllGlobals()
    // a8d845 is in both captures, the other six are unique to one feed.
    const hexes = r.aircraft.map((a) => a.icao24)
    expect(hexes.filter((h) => h === 'a8d845')).toHaveLength(1)
    expect(new Set(hexes).size).toBe(7)
    expect(hexes).toHaveLength(7)
    expect(r.credits.map((c) => c.url)).toEqual(['https://adsb.fi', 'https://adsb.lol'])
  })
})

describe('provider endpoints', () => {
  afterEach(() => vi.unstubAllGlobals())
  const health = () => new SourceHealth()

  it('adsb.fi uses the current v3 area endpoint', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://opendata.adsb.fi/api/v3/lat/41.9742/lon/-87.9073/dist/12')
      return new Response(JSON.stringify({ ac: [] }))
    })
    vi.stubGlobal('fetch', fetchMock)
    await fetchAircraftForAirport('ORD', { providers: [adsbFi], health: health() })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('adsb.lol uses the documented /v2/point endpoint and parses `ac`', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.adsb.lol/v2/point/41.9742/-87.9073/12')
      return new Response(JSON.stringify({ ac: [{ hex: 'abc', lat: 41.9, lon: -87.9 }] }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const r = await fetchAircraftForAirport('ORD', { providers: [adsbLol], health: health() })
    expect(r.aircraft[0].icao24).toBe('abc')
  })

  it('airplanes.live uses /v2/point and reports its refusal as a 403 (opens the breaker for long)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toBe('https://api.airplanes.live/v2/point/41.9742/-87.9073/12')
        return new Response(JSON.stringify(airplanesLive403), { status: 403 })
      }),
    )
    const h = health()
    await expect(fetchAircraftForAirport('ORD', { providers: [airplanesLive], health: h })).rejects.toThrow(/airplanes.live: HTTP 403/)
    expect(h.state('airplanes.live')).toBe('open')
  })

  it('OpenSky builds a bbox URL and surfaces HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toMatch(/opensky-network\.org\/api\/states\/all\?lamin=.*&lomin=.*&lamax=.*&lomax=/)
        return new Response('nope', { status: 522 })
      }),
    )
    await expect(fetchAircraftForAirport('ORD', { providers: [openSky], health: health() })).rejects.toThrow(/opensky: HTTP 522/)
  })
})

describe('providersFor', () => {
  it('uses airplanes.live unless switched off, with OpenSky last', () => {
    expect(providersFor().map((p) => p.name)).toEqual(['adsb.fi', 'adsb.lol', 'airplanes.live', 'opensky'])
    expect(providersFor({ ATC_ENABLE_AIRPLANES_LIVE: '0' }).map((p) => p.name)).toEqual(['adsb.fi', 'adsb.lol', 'opensky'])
  })

  it('points rehearsed failures at a dead URL', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    vi.stubGlobal('fetch', fetchMock)
    const broken = providersFor({ ATC_FAIL_SOURCES: 'adsb.fi' }).find((p) => p.name === 'adsb.fi')!
    await expect(broken.fetch(providersFor()[0] as never, AbortSignal.timeout(1000))).rejects.toThrow()
    expect(fetchMock.mock.calls[0]).toEqual([expect.stringContaining('invalid.invalid'), expect.anything()])
    vi.unstubAllGlobals()
  })
})

describe('handleAircraftRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    sourceHealth.reset()
  })

  const stubFeeds = (fi: () => Response, lol: () => Response, os: () => Response = () => new Response('{}', { status: 500 })) => {
    const fetchMock = vi.fn(async (url: string) => (url.includes('adsb.fi') ? fi() : url.includes('adsb.lol') ? lol() : os()))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('credits the feeds that answered in headers and serves repeats from the cache', async () => {
    const fetchMock = stubFeeds(
      () => new Response(JSON.stringify(adsbFiFixture)),
      () => new Response(JSON.stringify(adsbLolFixture)),
    )
    const cache = memoryCache()
    const res = await handleAircraftRequest('JFK', cache)
    expect(res.headers.get('X-Provider')).toMatch(/adsb\.(fi|lol) \+ adsb\.(fi|lol)/)
    expect(res.headers.get('X-Attribution')).toContain('<https://adsb.fi>')
    const body = (await res.json()) as unknown[]
    expect(body.length).toBeGreaterThan(3)
    const calls = fetchMock.mock.calls.length
    await handleAircraftRequest('JFK', cache)
    expect(fetchMock.mock.calls.length).toBe(calls)
  })

  it('serves the last good list, marked stale, when every feed fails', async () => {
    let up = true
    stubFeeds(
      () => (up ? new Response(JSON.stringify(adsbFiFixture)) : new Response('', { status: 503 })),
      () => (up ? new Response(JSON.stringify(adsbLolFixture)) : new Response('', { status: 503 })),
    )
    const now = Date.now()
    const cache = memoryCache(100, () => now + (up ? 0 : 10_000)) // fresh entry (4 s) expired, stale (90 s) not
    await handleAircraftRequest('LGA', cache)
    up = false
    const res = await handleAircraftRequest('LGA', cache)
    expect(res.headers.get('X-Stale')).not.toBeNull()
    expect(res.headers.get('X-Upstream-Error')).toMatch(/All providers failed/)
    expect(((await res.json()) as unknown[]).length).toBeGreaterThan(0)
  })

  it('shares one upstream round between concurrent requests', async () => {
    const fetchMock = stubFeeds(
      () => new Response(JSON.stringify(adsbFiFixture)),
      () => new Response(JSON.stringify(adsbLolFixture)),
    )
    const cache = memoryCache()
    await Promise.all([handleAircraftRequest('EWR', cache), handleAircraftRequest('EWR', cache), handleAircraftRequest('EWR', cache)])
    expect(fetchMock.mock.calls.length).toBe(2) // adsb.fi + adsb.lol, once
  })
})

describe('jsonResponse', () => {
  it('sets JSON, cache and CORS headers', async () => {
    const r = jsonResponse({ a: 1 }, 201, 'no-store')
    expect(r.status).toBe(201)
    expect(r.headers.get('Content-Type')).toBe('application/json')
    expect(r.headers.get('Cache-Control')).toBe('no-store')
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await r.json()).toEqual({ a: 1 })
  })
})
