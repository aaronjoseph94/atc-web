import { describe, expect, it } from 'vitest'
import { formatDistance, greatCircleNm, initialBearingDeg, routeProgress, timeToGoMs } from './route'

const ATL = { lat: 33.6367, lon: -84.4281 }
const JFK = { lat: 40.6398, lon: -73.7789 }
const LHR = { lat: 51.47, lon: -0.4543 }

describe('greatCircleNm', () => {
  it('matches published great-circle distances', () => {
    // ATL–JFK is 661 nm, JFK–LHR 2,991 nm.
    expect(greatCircleNm(ATL, JFK)).toBeCloseTo(661, -1)
    expect(greatCircleNm(JFK, LHR)).toBeGreaterThan(2970)
    expect(greatCircleNm(JFK, LHR)).toBeLessThan(3010)
    expect(greatCircleNm(JFK, JFK)).toBe(0)
  })
})

describe('initialBearingDeg', () => {
  it('points along the great circle', () => {
    expect(initialBearingDeg({ lat: 0, lon: 0 }, { lat: 10, lon: 0 })).toBeCloseTo(0, 5)
    expect(initialBearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 10 })).toBeCloseTo(90, 5)
    expect(initialBearingDeg({ lat: 10, lon: 0 }, { lat: 0, lon: 0 })).toBeCloseTo(180, 5)
    // New York to London leaves heading northeast (about 51°), not due east.
    expect(initialBearingDeg(JFK, LHR)).toBeGreaterThan(45)
    expect(initialBearingDeg(JFK, LHR)).toBeLessThan(56)
  })
})

describe('routeProgress', () => {
  it('is 0 at the origin, 1 at the destination, and about half way in the middle', () => {
    expect(routeProgress(ATL, JFK, ATL)!.fraction).toBeCloseTo(0, 5)
    expect(routeProgress(ATL, JFK, JFK)!.fraction).toBeCloseTo(1, 5)
    const mid = routeProgress(ATL, JFK, { lat: (ATL.lat + JFK.lat) / 2, lon: (ATL.lon + JFK.lon) / 2 })!
    expect(mid.fraction).toBeGreaterThan(0.45)
    expect(mid.fraction).toBeLessThan(0.55)
    expect(mid.flownNm + mid.remainingNm).toBeCloseTo(mid.totalNm, -1)
  })

  it('stays within 0..1 off the direct line, and says nothing without coordinates', () => {
    // Behind the origin (a departure turning the long way round).
    const behind = routeProgress(ATL, JFK, { lat: 33, lon: -85.5 })!
    expect(behind.fraction).toBeGreaterThanOrEqual(0)
    expect(behind.fraction).toBeLessThan(0.2)
    // Past the destination.
    expect(routeProgress(ATL, JFK, { lat: 41.5, lon: -72 })!.fraction).toBeLessThanOrEqual(1)
    expect(routeProgress({ lat: null, lon: null }, JFK, ATL)).toBeNull()
    expect(routeProgress(ATL, null, ATL)).toBeNull()
    expect(routeProgress(ATL, JFK, null)).toBeNull()
    // Origin and destination the same airport (a local flight): no route to show.
    expect(routeProgress(ATL, ATL, JFK)).toBeNull()
  })
})

describe('timeToGoMs', () => {
  it('divides distance by groundspeed', () => {
    expect(timeToGoMs(300, 450)).toBe(40 * 60_000)
    expect(timeToGoMs(0, 200)).toBe(0)
  })
  it('gives up when too slow or unknown', () => {
    expect(timeToGoMs(100, 20)).toBeNull()
    expect(timeToGoMs(100, null)).toBeNull()
    expect(timeToGoMs(Number.NaN, 300)).toBeNull()
  })
})

describe('formatDistance', () => {
  it('follows the speed unit', () => {
    expect(formatDistance(312, 'kt')).toBe('312 nm')
    expect(formatDistance(312, 'kmh')).toBe('578 km')
    expect(formatDistance(312, 'mph')).toBe('359 mi')
    expect(formatDistance(1234.4, 'kt')).toBe('1,234 nm')
    expect(formatDistance(4.26, 'kt')).toBe('4.3 nm')
  })
})
