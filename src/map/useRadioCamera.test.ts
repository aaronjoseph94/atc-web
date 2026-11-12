import { describe, expect, it } from 'vitest'
import type { LiveAircraft } from './livePositions'
import { alreadyFramed, cameraEase, cameraTargets, flyDuration, FLY_MAX_MS, FLY_MIN_MS, focusZoom, FRAMED_OFFSET, FRAMED_ZOOM_IN, FRAMED_ZOOM_OUT } from './useRadioCamera'

const airport = { zoom: 12.2, elevationFt: 13 }

describe('radio camera', () => {
  it('comes in close on the ground and stays wider for traffic in the air', () => {
    const ground = focusZoom({ onGround: true, altitudeFt: null }, airport)
    const final = focusZoom({ onGround: false, altitudeFt: 1200 }, airport)
    const approach = focusZoom({ onGround: false, altitudeFt: 4000 }, airport)
    const high = focusZoom({ onGround: false, altitudeFt: 11000 }, airport)
    expect(ground).toBeGreaterThan(final)
    expect(final).toBeGreaterThan(approach)
    expect(approach).toBeGreaterThan(high)
    // Never further out than a little inside the airfield overview.
    expect(high).toBeGreaterThanOrEqual(airport.zoom + 0.8)
    expect(focusZoom({ onGround: true, altitudeFt: null }, { zoom: 15.9, elevationFt: 0 })).toBeLessThanOrEqual(16)
  })

  it('zooms modestly: a taxiing aircraft keeps a kilometre or so of airfield around it', () => {
    const ground = focusZoom({ onGround: true, altitudeFt: null }, airport)
    // Ground metres across a 430 px phone at this zoom, at JFK's latitude.
    const across = (430 * 78271.5 * Math.cos((40.64 * Math.PI) / 180)) / 2 ** ground
    expect(across).toBeGreaterThan(700)
    expect(across).toBeLessThan(1600)
  })

  it('eases softly at both ends and never rushes the middle', () => {
    expect(cameraEase(0)).toBe(0)
    expect(cameraEase(1)).toBe(1)
    expect(cameraEase(0.5)).toBeCloseTo(0.5)
    expect(cameraEase(0.1)).toBeLessThan(0.02)
    expect(cameraEase(0.9)).toBeGreaterThan(0.98)
    let top = 0
    let last = 0
    for (let i = 1; i <= 1000; i++) {
      const v = cameraEase(i / 1000)
      expect(v).toBeGreaterThanOrEqual(last)
      top = Math.max(top, (v - last) * 1000)
      last = v
    }
    // Peak speed under twice the average speed of the move.
    expect(top).toBeLessThan(2)
  })

  it('takes 1.6 to 2.2 seconds, longer for a bigger move', () => {
    expect(flyDuration(0, 0)).toBe(FLY_MIN_MS)
    expect(flyDuration(0.3, 0)).toBeGreaterThan(FLY_MIN_MS)
    expect(flyDuration(0.2, 2.6)).toBe(FLY_MAX_MS)
    expect(flyDuration(5, -4)).toBe(FLY_MAX_MS)
    expect(flyDuration(0.3, 1.5)).toBeGreaterThan(flyDuration(0.3, 0.5))
    expect(FLY_MIN_MS).toBeGreaterThanOrEqual(400)
    expect(FLY_MAX_MS).toBeLessThanOrEqual(1000)
  })

  it('leaves the camera alone when the aircraft is already framed', () => {
    const want = 14.8
    expect(alreadyFramed(0.05, want, want)).toBe(true)
    expect(alreadyFramed(FRAMED_OFFSET, want - FRAMED_ZOOM_OUT, want)).toBe(true)
    expect(alreadyFramed(0.1, want + FRAMED_ZOOM_IN, want)).toBe(true)
    // Too far from the middle, too far out, or so close in that nothing around it shows.
    expect(alreadyFramed(FRAMED_OFFSET + 0.05, want, want)).toBe(false)
    expect(alreadyFramed(0.05, 12.4, want)).toBe(false)
    expect(alreadyFramed(0.05, 17, want)).toBe(false)
  })
})

describe('cameraTargets', () => {
  const jfk = { center: [-73.7781, 40.6413] as [number, number], elevationFt: 13 }
  const plane = (icao24: string, lon: number, lat: number, onGround: boolean) => ({ icao24, callsign: icao24, lon, lat, onGround, altitudeFt: onGround ? null : 3000, heading: 0, speedKt: 0, opacity: 1 }) as unknown as LiveAircraft
  const list = [plane('jfk', -73.785, 40.645, true), plane('lga', -73.874, 40.7769, true), plane('air', -73.874, 40.7769, false)]

  it('leaves out aircraft on the ground at another airport', () => {
    expect(cameraTargets(list, ['jfk', 'lga'], jfk).map((a) => a.icao24)).toEqual(['jfk'])
    expect(cameraTargets(list, ['lga'], jfk)).toEqual([])
    // Overhead the other field but in the air: still worth a look.
    expect(cameraTargets(list, ['air', 'gone'], jfk).map((a) => a.icao24)).toEqual(['air'])
  })
})
