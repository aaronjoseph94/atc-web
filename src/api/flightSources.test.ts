import { afterEach, describe, expect, it, vi } from 'vitest'
import adsbdbAircraft from './__fixtures__/adsbdb-aircraft-a0b169.json'
import adsbdbCallsign from './__fixtures__/adsbdb-callsign-dal2917.json'
import feedHex from './__fixtures__/adsbfi-hex-a0b169.json'
import hexdbAircraft from './__fixtures__/hexdb-aircraft-a0b169.json'
import hexdbRoute from './__fixtures__/hexdb-route-dal2917.json'
import {
  fetchFlightDetails,
  mergeFlightInfo,
  normalizeFeedAirframe,
  normalizeHexdbAircraft,
  normalizeHexdbRoute,
  pickByConfidence,
} from './flightSources'
import { memoryCache, sourceHealth } from './sourceHealth'
import type { FlightInfo } from './types'

const emptyInfo: FlightInfo = {
  callsign: null,
  airline: null,
  origin: null,
  destination: null,
  typeName: null,
  manufacturer: null,
  registration: null,
  owner: null,
  photo: null,
}

describe('normalizers (real captures)', () => {
  it('hexdb aircraft', () => {
    expect(normalizeHexdbAircraft(hexdbAircraft)).toEqual({ registration: 'N1439A', typeName: '767 33AERBDSF', manufacturer: 'Boeing', owner: 'Prime Air' })
    expect(normalizeHexdbAircraft({})).toBeNull()
  })

  it('hexdb route: used while recent, ignored once old', () => {
    // Captured route was last updated in 2019: too old to trust today.
    expect(normalizeHexdbRoute(hexdbRoute, Date.parse('2026-11-10'))).toBeNull()
    const recent = normalizeHexdbRoute(hexdbRoute, Date.parse('2019-07-01'))
    expect(recent?.origin).toMatchObject({ icao: 'KORD', iata: 'ORD', lat: 41.9786 })
    expect(recent?.destination).toMatchObject({ icao: 'KSLC' })
  })

  it('ADS-B feed hex lookup', () => {
    expect(normalizeFeedAirframe(feedHex.ac)).toEqual({ registration: 'N1439A', typeName: 'BOEING 767-300', manufacturer: null, owner: 'ANDROMEDA LEASING I LLC' })
    expect(normalizeFeedAirframe([])).toBeNull()
  })
})

describe('pickByConfidence', () => {
  it('lets two agreeing weaker sources outvote one stronger source', () => {
    const r = pickByConfidence([
      { source: 'adsbdb', value: 'N1' },
      { source: 'hexdb', value: 'N2' },
      { source: 'feed', value: 'n-2' },
    ])
    expect(r).toEqual({ value: 'N2', sources: ['hexdb', 'feed'] })
  })

  it('breaks a tie by the single most trusted source and skips nulls', () => {
    expect(pickByConfidence([{ source: 'feed', value: 'X' }, { source: 'adsbdb', value: null }]).value).toBe('X')
    expect(
      pickByConfidence([
        { source: 'hexdb', value: 'A' },
        { source: 'adsbdb', value: 'B' },
      ]).value,
    ).toBe('B')
  })
})

describe('mergeFlightInfo', () => {
  it('fills an unknown airframe from hexdb, then the feed', () => {
    const m = mergeFlightInfo({ ...emptyInfo, callsign: 'ATN3321' }, { hexdb: normalizeHexdbAircraft(hexdbAircraft), feed: normalizeFeedAirframe(feedHex.ac) })
    expect(m).toMatchObject({ registration: 'N1439A', typeName: '767 33AERBDSF', owner: 'Prime Air', callsign: 'ATN3321' })
    expect(m.sources).toEqual(['hexdb', 'feed'])
  })

  it('keeps adsbdb’s route over an older hexdb one, and leaves the photo alone', () => {
    const photo = { thumbnail: 'https://airport-data.com/x.jpg', link: null, photographer: null }
    const base = { ...emptyInfo, origin: { iata: 'MSP', icao: 'KMSP', name: null, city: null, lat: null, lon: null }, destination: null, photo }
    const m = mergeFlightInfo(base, { hexdbRoute: normalizeHexdbRoute(hexdbRoute, Date.parse('2019-07-01')) })
    expect(m.origin?.iata).toBe('MSP')
    expect(m.photo).toBe(photo)
  })

  it('uses a recent hexdb route when adsbdb has none', () => {
    const m = mergeFlightInfo(emptyInfo, { hexdbRoute: normalizeHexdbRoute(hexdbRoute, Date.parse('2019-07-01')) })
    expect(m.origin?.icao).toBe('KORD')
    expect(m.sources).toEqual(['hexdb'])
  })
})

describe('fetchFlightDetails', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    sourceHealth.reset()
  })

  const route = (url: string): Response => {
    if (url.includes('adsbdb.com/v0/aircraft/a0b169')) return new Response(JSON.stringify(adsbdbAircraft))
    if (url.includes('adsbdb.com/v0/callsign/DAL2917')) return new Response(JSON.stringify(adsbdbCallsign))
    if (url.includes('hexdb.io/api/v2/aircraft/a0b169')) return new Response(JSON.stringify(hexdbAircraft))
    if (url.includes('hexdb.io/api/v2/routes/DAL2917')) return new Response(JSON.stringify(hexdbRoute))
    if (url.includes('/v2/hex/')) return new Response(JSON.stringify(feedHex))
    return new Response(JSON.stringify({ response: 'unknown' }), { status: 404 })
  }

  it('merges adsbdb and hexdb, credits both, and skips the feed when the databases know the airframe', async () => {
    const fetchMock = vi.fn(async (url: string) => route(url))
    vi.stubGlobal('fetch', fetchMock)
    const info = await fetchFlightDetails('a0b169', 'ATN3321')
    expect(info).toMatchObject({ registration: 'N1439A', typeName: '767 33AERBDSF', airline: 'Air Transport International' })
    expect(info.origin?.iata).toBe('AFW')
    expect(info.sources).toEqual(['adsbdb', 'hexdb'])
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/v2/hex/'))).toBe(false)
  })

  it('falls back to hexdb and the feed when adsbdb is down, and caches the sub-lookups', async () => {
    const fetchMock = vi.fn(async (url: string) => (url.includes('adsbdb') ? new Response('', { status: 502 }) : url.includes('hexdb') ? new Response('', { status: 503 }) : route(url)))
    vi.stubGlobal('fetch', fetchMock)
    const cache = memoryCache()
    const info = await fetchFlightDetails('a0b169', null, cache)
    expect(info).toMatchObject({ registration: 'N1439A', typeName: 'BOEING 767-300' })
    expect(info.sources).toEqual(['feed'])
    const feedCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/v2/hex/')).length
    await fetchFlightDetails('a0b169', null, cache)
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/v2/hex/')).length).toBe(feedCalls)
  })
})
