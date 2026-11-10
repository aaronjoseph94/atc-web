import { describe, expect, it } from 'vitest'
import { nightFactor, sunElevation, sunPhase } from './sun'

const JFK = { lat: 40.6413, lon: -73.7781 }
const YYC = { lat: 51.1215, lon: -114.0076 }

describe('sunElevation', () => {
  it('puts the summer-solstice noon sun at 90° − latitude + 23.44° over JFK', () => {
    // Solar noon in New York on 21 June 2024 is about 12:57 EDT.
    const e = sunElevation(Date.UTC(2024, 5, 21, 16, 57), JFK.lat, JFK.lon)
    expect(e).toBeCloseTo(90 - JFK.lat + 23.44, 0)
  })

  it('sits the winter-solstice noon sun low over Calgary', () => {
    // Solar noon in Calgary on 21 December 2024 is about 12:34 MST (19:34 UTC).
    const e = sunElevation(Date.UTC(2024, 11, 21, 19, 34), YYC.lat, YYC.lon)
    expect(e).toBeCloseTo(90 - YYC.lat - 23.44, 0)
  })

  it('finds the published sunset times (sun 0.833° down)', () => {
    // New York, 21 June 2024: sunset 20:31 EDT. Calgary, 21 December 2024: sunset 16:31 MST.
    expect(sunElevation(Date.UTC(2024, 5, 22, 0, 31), JFK.lat, JFK.lon)).toBeCloseTo(-0.833, 0)
    expect(sunElevation(Date.UTC(2024, 11, 21, 23, 31), YYC.lat, YYC.lon)).toBeCloseTo(-0.833, 0)
  })

  it('is deep below the horizon at local midnight', () => {
    expect(sunElevation(Date.UTC(2024, 2, 20, 5, 0), JFK.lat, JFK.lon)).toBeLessThan(-40)
  })

  it('is overhead at the equinox subsolar point', () => {
    expect(sunElevation(Date.UTC(2024, 2, 20, 12, 7), 0, 0)).toBeGreaterThan(89)
  })
})

describe('sunPhase and nightFactor', () => {
  it('names the phases at the civil-twilight boundaries', () => {
    expect(sunPhase(10)).toBe('day')
    expect(sunPhase(-0.5)).toBe('day')
    expect(sunPhase(-3)).toBe('twilight')
    expect(sunPhase(-7)).toBe('night')
  })

  it('ramps smoothly from 0 at sunset to 1 at civil dusk', () => {
    expect(nightFactor(5)).toBe(0)
    expect(nightFactor(-0.833)).toBe(0)
    expect(nightFactor(-6)).toBe(1)
    expect(nightFactor(-20)).toBe(1)
    const mid = nightFactor((-0.833 - 6) / 2)
    expect(mid).toBeCloseTo(0.5, 5)
    // Monotonic through the twilight.
    let last = 0
    for (let e = 0; e >= -7; e -= 0.25) {
      const f = nightFactor(e)
      expect(f).toBeGreaterThanOrEqual(last)
      last = f
    }
  })
})
