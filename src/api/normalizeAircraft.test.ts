import { describe, expect, it } from 'vitest'
import { normalizeOpenSkyStates, normalizeReadsb } from './normalizeAircraft'

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
    ])
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
