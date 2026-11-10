import { describe, expect, it } from 'vitest'
import type { Aircraft } from '../api/types'
import { handOver, lerpAngle, LivePositionBuffer, measureTurn } from './livePositions'

const ac = (
  icao24: string,
  lat: number,
  lon: number,
  heading = 0,
  speedKt: number | null = null,
  onGround = false,
): Aircraft => ({
  icao24,
  callsign: icao24.toUpperCase(),
  lat,
  lon,
  heading,
  altitudeFt: null,
  speedKt,
  onGround,
})

describe('LivePositionBuffer', () => {
  it('is empty before any snapshot and returns the first snapshot as-is', () => {
    const b = new LivePositionBuffer()
    expect(b.sample(0)).toEqual([])
    b.push([ac('a', 1, 1)], 1000)
    expect(b.sample(1500)).toMatchObject([ac('a', 1, 1)])
  })

  it('fades aircraft in on arrival and out once they leave the feed', () => {
    const b = new LivePositionBuffer()
    b.push([ac('a', 1, 1)], 0)
    expect(b.sample(0)[0].opacity).toBeCloseTo(0.25)
    expect(b.sample(2000)[0].opacity).toBe(1)
    b.push([], 3000)
    b.push([], 4000) // second miss: starts fading
    expect(b.sample(4450)[0].opacity).toBeCloseTo(0.5)
    expect(b.sample(5000)).toEqual([])
  })

  it('keeps a trail that ends at the drawn position', () => {
    const b = new LivePositionBuffer()
    b.push([ac('a', 41, -87, 90, 300)], 0)
    b.push([ac('a', 41, -86.99, 90, 300)], 5000)
    b.push([ac('a', 41, -86.98, 90, 300)], 10_000)
    const trail = b.trail('a', 50, 10_000)
    expect(trail).toHaveLength(3)
    expect(trail[0]).toEqual([-87, 41])
    expect(trail[2][0]).toBeCloseTo(b.get('a', 10_000)!.lon, 6)
    expect(b.trail('missing')).toEqual([])
  })

  it('points a headingless aircraft the way it actually moved', () => {
    const b = new LivePositionBuffer()
    const still = { ...ac('a', 41, -87, 0, null, true), headingKnown: false }
    b.push([still], 0)
    expect(b.sample(100)[0].headingKnown).toBe(false)
    // Moves due east with no reported track or speed.
    b.push([{ ...still, lon: -86.999 }], 5000)
    const moved = b.sample(9000)[0]
    expect(moved.headingKnown).toBe(true)
    expect(moved.heading).toBeGreaterThan(80)
    expect(moved.heading).toBeLessThan(100)
  })

  it('coasts forward on speed and heading between fixes', () => {
    const b = new LivePositionBuffer()
    // 360 kt due north for 10s ≈ 0.0167° of latitude.
    b.push([ac('a', 41, -87, 0, 360)], 0)
    const later = b.sample(10_000)[0]
    expect(later.lat).toBeCloseTo(41.01667, 3)
    expect(later.lon).toBeCloseTo(-87, 3)
    expect(later.heading).toBeCloseTo(0)
  })

  it('eases onto a new fix instead of teleporting', () => {
    const b = new LivePositionBuffer()
    b.push([ac('a', 0, 0, 90, 600)], 0)
    const before = b.sample(4_000)[0]
    b.push([ac('a', 0, 0.05, 90, 600)], 4_000)
    const atUpdate = b.sample(4_000)[0]
    expect(atUpdate.lat).toBeCloseTo(before.lat, 5)
    expect(atUpdate.lon).toBeCloseTo(before.lon, 5)

    // A few seconds later the error has decayed and the aircraft is past the new fix.
    const settled = b.sample(12_000)[0]
    expect(settled.lon).toBeGreaterThan(0.06)
    expect(settled.lon).toBeLessThan(0.09)
  })

  it('holds parked aircraft still through small position jitter', () => {
    const b = new LivePositionBuffer()
    b.push([ac('a', 41.97, -87.9, 40, 0, true)], 0)
    b.push([ac('a', 41.9702, -87.9002, 200, 1, true)], 2_000)
    const held = b.sample(6_000)[0]
    expect(held.lat).toBeCloseTo(41.97, 4)
    expect(held.lon).toBeCloseTo(-87.9, 4)
  })

  it('shows new aircraft immediately and keeps vanished aircraft for one cycle', () => {
    const b = new LivePositionBuffer()
    b.push([ac('old', 0, 0)], 0)
    b.push([ac('new', 1, 1)], 1000)
    const ids = b.sample(500).map((a) => a.icao24).sort()
    expect(ids).toEqual(['new', 'old'])

    b.push([ac('new', 2, 2)], 2000)
    // 'old' has now missed two polls and is gone once its fade-out finishes.
    expect(b.sample(3500).map((a) => a.icao24)).toEqual(['new'])
  })

  it('keeps a turning aircraft turning between fixes, along an arc', () => {
    const b = new LivePositionBuffer()
    // 3°/s right turn at 200 kt: 0° then 15° five seconds apart.
    b.push([ac('a', 41, -87, 0, 200)], 0)
    b.push([ac('a', 41.0046, -87, 15, 200)], 5000)
    // At the fix the icon shows the fix heading (no jump)...
    expect(b.sample(5000)[0].heading).toBeCloseTo(0 + 0, 0)
    // ...and two seconds on it has kept turning past the reported 15°.
    const later = b.sample(9000)[0]
    expect(later.heading).toBeGreaterThan(20)
    expect(later.heading).toBeLessThan(30)
    // The arc bends east of a straight run north.
    expect(later.lon).toBeGreaterThan(-87)
    // The next fix agrees with the extrapolation, so there is almost nothing to correct.
    b.push([ac('a', 41.009, -86.9985, 30, 200)], 10_000)
    const atFix = b.sample(10_000)[0].heading
    expect(Math.abs(atFix - 30)).toBeLessThan(1)
  })

  it('stops turning about one poll after the last fix', () => {
    const b = new LivePositionBuffer()
    b.push([ac('a', 41, -87, 0, 200)], 0)
    b.push([ac('a', 41.0046, -87, 15, 200)], 5000)
    const h1 = b.sample(5000 + 15_000)[0].heading
    const h2 = b.sample(5000 + 19_000)[0].heading
    expect(h1).toBeCloseTo(h2, 5)
  })

  it('clear() forgets everything', () => {
    const b = new LivePositionBuffer()
    b.push([ac('a', 0, 0)], 0)
    b.clear()
    expect(b.sample(10)).toEqual([])
  })
})

describe('lerpAngle', () => {
  it('takes the shortest path across 0/360', () => {
    expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(0)
    expect(lerpAngle(10, 350, 0.5)).toBeCloseTo(0)
    expect(lerpAngle(90, 180, 0.5)).toBeCloseTo(135)
  })
})

describe('measureTurn', () => {
  it('reads a turn rate from two headings, ignoring noise and capping silly values', () => {
    expect(measureTurn(350, 5, 5000, false)).toBeCloseTo(3)
    expect(measureTurn(90, 90.5, 5000, false)).toBe(0)
    expect(measureTurn(0, 90, 5000, false)).toBe(4)
    expect(measureTurn(0, 90, 10_000, true)).toBe(9)
    expect(measureTurn(0, 10, 200, false)).toBe(0)
    // Agreeing estimates are smoothed; a reversal is believed straight away.
    expect(measureTurn(0, 10, 5000, false, 3)).toBeCloseTo(2.35)
    expect(measureTurn(10, 0, 5000, false, 3)).toBeCloseTo(-2)
  })
})

describe('handOver', () => {
  it('starts and ends flat', () => {
    expect(handOver(0)).toBe(0)
    expect(handOver(30)).toBeLessThan(0.001)
    expect(handOver(1000)).toBeCloseTo(0.5)
    expect(handOver(1970)).toBeGreaterThan(0.999)
    expect(handOver(5000)).toBe(1)
  })
})

describe('smooth motion through a new fix', () => {
  // A jet at 150 kt heading east; the next report puts it a little off the forecast, on a new heading.
  const ac = (lon: number, heading: number) => ({ icao24: 'abc', callsign: 'TST1', lat: 40, lon, heading, altitudeFt: 2000, speedKt: 150, onGround: false }) as never
  const at = (b: LivePositionBuffer, t: number) => b.get('abc', t)!

  it('keeps position and velocity continuous when a fix lands', () => {
    const b = new LivePositionBuffer()
    b.push([ac(-74, 90)], 0)
    b.push([ac(-73.995, 100)], 5000)
    const before = at(b, 4999.9)
    const after = at(b, 5000.1)
    expect(Math.abs(after.lon - before.lon)).toBeLessThan(1e-6)
    expect(Math.abs(after.lat - before.lat)).toBeLessThan(1e-6)
    // Velocity just before and just after the fix (degrees per ms) match closely.
    const v = (t0: number, t1: number) => [(at(b, t1).lon - at(b, t0).lon) / (t1 - t0), (at(b, t1).lat - at(b, t0).lat) / (t1 - t0)]
    const vBefore = v(4980, 4999)
    const vAfter = v(5001, 5020)
    const speed = Math.hypot(...vBefore)
    expect(Math.hypot(vAfter[0] - vBefore[0], vAfter[1] - vBefore[1])).toBeLessThan(speed * 0.05)
  })

  it('ends up on the new forecast once the hand-over is done', () => {
    const b = new LivePositionBuffer()
    b.push([ac(-74, 90)], 0)
    b.push([ac(-73.99, 90)], 5000)
    const later = at(b, 9000)
    const fresh = new LivePositionBuffer()
    fresh.push([ac(-73.99, 90)], 5000)
    expect(later.lon).toBeCloseTo(at(fresh, 9000).lon, 7)
  })
})
