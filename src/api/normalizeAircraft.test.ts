import { describe, expect, it } from 'vitest'
import { normalizeOpenSkyStates } from './normalizeAircraft'

describe('normalizeOpenSkyStates', () => {
  it('returns empty for null/empty', () => {
    expect(normalizeOpenSkyStates(null)).toEqual([])
    expect(normalizeOpenSkyStates([])).toEqual([])
  })

  it('maps a valid OpenSky vector to Aircraft', () => {
    // Indices per OpenSky docs; values chosen so ft/kt are exact integers
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
      0,
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
