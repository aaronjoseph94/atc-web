import { afterEach, describe, expect, it, vi } from 'vitest'
import { adsbFi, adsbLol, fetchAircraftForAirport, jsonResponse, openSky, type AircraftProvider } from './aircraftHandler'

const ok = (name: string, n = 1): AircraftProvider => ({
  name,
  fetch: async () =>
    Array.from({ length: n }, (_, i) => ({
      icao24: `${name}${i}`,
      callsign: 'X',
      lat: 0,
      lon: 0,
      heading: 0,
      altitudeFt: null,
      speedKt: null,
      onGround: false,
    })),
})
const fail = (name: string): AircraftProvider => ({
  name,
  fetch: async () => {
    throw new Error('HTTP 522')
  },
})

describe('fetchAircraftForAirport', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the first provider when it succeeds', async () => {
    const r = await fetchAircraftForAirport('ORD', [ok('a', 3), ok('b')])
    expect(r.provider).toBe('a')
    expect(r.aircraft).toHaveLength(3)
  })

  it('falls through to the next provider on failure', async () => {
    const r = await fetchAircraftForAirport('ORD', [fail('a'), fail('b'), ok('c', 2)])
    expect(r.provider).toBe('c')
    expect(r.aircraft).toHaveLength(2)
  })

  it('throws with every cause when all providers fail', async () => {
    await expect(fetchAircraftForAirport('ORD', [fail('a'), fail('b')])).rejects.toThrow(/a: HTTP 522; b: HTTP 522/)
  })

  it('starts the next provider when the first is slow, and the first answer wins', async () => {
    let aborted = false
    const slow: AircraftProvider = {
      name: 'slow',
      fetch: (_apt, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true
            reject(new Error('aborted'))
          })
        }),
    }
    const r = await fetchAircraftForAirport('ORD', [slow, ok('fast', 2)], 5)
    expect(r.provider).toBe('fast')
    expect(aborted).toBe(true)
  })

  it('prefers the first provider when it answers inside the hedge window', async () => {
    const second = vi.fn(ok('b').fetch)
    const r = await fetchAircraftForAirport('ORD', [ok('a'), { name: 'b', fetch: second }], 50)
    expect(r.provider).toBe('a')
    expect(second).not.toHaveBeenCalled()
  })

  it('adsb.fi uses the current v3 area endpoint', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://opendata.adsb.fi/api/v3/lat/41.9742/lon/-87.9073/dist/12')
      return new Response(JSON.stringify({ ac: [] }))
    })
    vi.stubGlobal('fetch', fetchMock)
    await fetchAircraftForAirport('ORD', [adsbFi])
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('adsb.lol builds a point/radius URL from the airport and parses `ac`', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.adsb.lol/v2/lat/41.9742/lon/-87.9073/dist/12')
      return new Response(JSON.stringify({ ac: [{ hex: 'abc', lat: 41.9, lon: -87.9 }] }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const r = await fetchAircraftForAirport('ORD', [adsbLol])
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(r.aircraft[0].icao24).toBe('abc')
  })

  it('OpenSky builds a bbox URL and surfaces HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toMatch(/opensky-network\.org\/api\/states\/all\?lamin=.*&lomin=.*&lamax=.*&lomax=/)
        return new Response('nope', { status: 522 })
      }),
    )
    await expect(fetchAircraftForAirport('ORD', [openSky])).rejects.toThrow(/opensky: HTTP 522/)
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
