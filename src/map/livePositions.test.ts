import { describe, expect, it } from 'vitest'
import type { Aircraft } from '../api/types'
import { lerpAngle, LivePositionBuffer } from './livePositions'

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
