import { describe, expect, it } from 'vitest'
import adsbFi from './__fixtures__/adsbfi-jfk.json'
import adsbLol from './__fixtures__/adsblol-jfk.json'
import openSky from './__fixtures__/opensky-jfk.json'
import { mergeAircraft, normalizeOpenSkyStates, normalizeReadsb, type OpenSkyState, type ReadsbAircraft, type TimedAircraft } from './normalizeAircraft'

describe('normalizeReadsb', () => {
  it('returns empty for null/empty', () => {
    expect(normalizeReadsb(null)).toEqual([])
    expect(normalizeReadsb([])).toEqual([])
  })

  it('maps an airborne readsb record', () => {
    const out = normalizeReadsb([
      {
        hex: 'A56BDB',
        flight: 'UAL2099 ',
        r: 'N37502',
        t: 'B39M',
        lat: 41.98,
        lon: -87.9,
        alt_baro: 2400,
        gs: 180.4,
        track: 281.6,
        baro_rate: 1536,
        seen_pos: 1.2,
      },
    ], 1_000_000)
    expect(out).toEqual([
      {
        icao24: 'a56bdb',
        callsign: 'UAL2099',
        lat: 41.98,
        lon: -87.9,
        heading: 281.6,
        altitudeFt: 2400,
        speedKt: 180,
        onGround: false,
        type: 'B39M',
        registration: 'N37502',
        verticalRateFpm: 1536,
        positionTime: 998_800,
      },
    ])
  })

  it('treats alt_baro "ground" as on the surface at 0 ft', () => {
    const [a] = normalizeReadsb([{ hex: 'abc123', lat: 1, lon: 2, alt_baro: 'ground', gs: 12 }])
    expect(a.onGround).toBe(true)
    expect(a.altitudeFt).toBe(0)
    expect(a.callsign).toBe('ABC123') // falls back to hex
  })

  it('drops rows without a position, without hex, or with stale positions', () => {
    expect(
      normalizeReadsb([
        { hex: 'aaa', lat: 1 }, // no lon
        { lat: 1, lon: 2 }, // no hex
        { hex: 'bbb', lat: 1, lon: 2, seen_pos: 120 }, // stale
      ]),
    ).toEqual([])
  })

  it('strips the TIS-B "~" prefix from hex ids', () => {
    expect(normalizeReadsb([{ hex: '~a1b2c3', lat: 1, lon: 2 }])[0].icao24).toBe('a1b2c3')
  })
})

describe('normalizeOpenSkyStates', () => {
  it('returns empty for null/empty', () => {
    expect(normalizeOpenSkyStates(null)).toEqual([])
    expect(normalizeOpenSkyStates([])).toEqual([])
  })

  it('maps a valid OpenSky vector to Aircraft (m→ft, m/s→kt)', () => {
    const state = [
      'a1b2c3',
      'UAL2099 ',
      'United States',
      0,
      0,
      -87.9,
      41.978,
      304.8, // ~1000 ft
      false,
      128.611, // ~250 kt
      270,
      5.08, // 1000 fpm
      null,
      null,
      null,
      false,
      0,
    ]
    expect(normalizeOpenSkyStates([state])).toEqual([
      {
        icao24: 'a1b2c3',
        callsign: 'UAL2099',
        lat: 41.978,
        lon: -87.9,
        heading: 270,
        altitudeFt: 1000,
        speedKt: 250,
        onGround: false,
        verticalRateFpm: 1000,
        source: 'adsb',
      },
    ])
  })

  it('skips rows missing lat/lon or icao', () => {
    expect(
      normalizeOpenSkyStates([
        ['', 'X', null, 0, 0, -87.9, 41.9, 0, true, 0, 0, 0, null, null, null, false, 0],
        ['abc', 'X', null, 0, 0, null, 41.9, 0, true, 0, 0, 0, null, null, null, false, 0],
      ]),
    ).toEqual([])
  })
})

// Captured at JFK on 2026-11-10 from each feed (trimmed to a few rows).
describe('real feed captures', () => {
  it('adsb.fi: parses every row and dates positions from the payload clock', () => {
    const out = normalizeReadsb(adsbFi.ac as ReadsbAircraft[], adsbFi.now)
    expect(out).toHaveLength(4)
    const ground = out.find((a) => a.icao24 === 'a0e7f4')!
    expect(ground.onGround).toBe(true)
    expect(ground.altitudeFt).toBe(0)
    const air = out.find((a) => a.icao24 === 'a8d845')!
    expect(air).toMatchObject({ onGround: false, altitudeFt: 6900 })
    expect(air.callsign).toMatch(/^[A-Z0-9]+$/)
    expect(air.positionTime).toBe(Math.round(adsbFi.now - 0.379 * 1000))
  })

  it('adsb.lol: same wire format, same output shape', () => {
    const out = normalizeReadsb(adsbLol.ac as ReadsbAircraft[], adsbLol.now)
    expect(out.map((a) => a.icao24)).toEqual(['a0b821', 'a8d845', 'a009a4', 'a35b81'])
    for (const a of out) {
      expect(typeof a.lat).toBe('number')
      expect(typeof a.heading).toBe('number')
    }
  })

  it('OpenSky: converts units and keeps the position time', () => {
    const out = normalizeOpenSkyStates(openSky.states as OpenSkyState[], openSky.time)
    expect(out.map((a) => a.icao24)).toEqual(['a4c592', 'a8d845', 'a8b8ba'])
    expect(out[0]).toMatchObject({ callsign: 'JBU816', onGround: true })
    expect(out[0].positionTime).toBe((openSky.states[0][3] as number) * 1000)
  })

  it('OpenSky: drops positions older than a minute', () => {
    const s = [...(openSky.states[0] as OpenSkyState)]
    s[3] = openSky.time - 120
    expect(normalizeOpenSkyStates([s], openSky.time)).toEqual([])
  })

  it('the same aircraft looks the same from adsb.fi and adsb.lol', () => {
    const a = normalizeReadsb(adsbFi.ac as ReadsbAircraft[], adsbFi.now).find((x) => x.icao24 === 'a8d845')!
    const b = normalizeReadsb(adsbLol.ac as ReadsbAircraft[], adsbLol.now).find((x) => x.icao24 === 'a8d845')!
    expect(a).toMatchObject({ callsign: b.callsign, type: b.type, registration: b.registration, altitudeFt: b.altitudeFt })
    // Each copy keeps when its position was measured: the map dates reports by it.
    expect(typeof a.positionTime).toBe('number')
  })
})

describe('mergeAircraft', () => {
  const ac = (icao24: string, positionTime: number, extra: Partial<TimedAircraft> = {}): TimedAircraft => ({
    icao24,
    callsign: icao24.toUpperCase(),
    lat: 0,
    lon: 0,
    heading: 0,
    altitudeFt: null,
    speedKt: null,
    onGround: false,
    positionTime,
    ...extra,
  })

  it('keeps the freshest position and fills gaps from the other feed', () => {
    const { aircraft, contributions } = mergeAircraft([
      { source: 'a', aircraft: [ac('abc', 100, { lat: 1, type: 'A320', callsign: 'DAL1', heading: 90 }), ac('aaa', 100)] },
      { source: 'b', aircraft: [ac('abc', 200, { lat: 2, registration: 'N1', headingKnown: false })] },
    ])
    const abc = aircraft.find((x) => x.icao24 === 'abc')!
    expect(abc).toMatchObject({ lat: 2, type: 'A320', registration: 'N1', callsign: 'DAL1', heading: 90, positionTime: 200 })
    expect(abc.headingKnown).toBeUndefined() // a knew the heading
    expect(contributions).toEqual({ a: 1, b: 1 })
  })

  it('ties go to the earlier (healthier) feed', () => {
    const { aircraft } = mergeAircraft([
      { source: 'a', aircraft: [ac('abc', 100, { lat: 1 })] },
      { source: 'b', aircraft: [ac('abc', 100, { lat: 2 })] },
    ])
    expect(aircraft[0].lat).toBe(1)
  })

  it('does not mutate its inputs', () => {
    const row = ac('abc', 100)
    mergeAircraft([
      { source: 'a', aircraft: [row] },
      { source: 'b', aircraft: [ac('abc', 50, { type: 'B738' })] },
    ])
    expect(row.type).toBeUndefined()
  })
})
