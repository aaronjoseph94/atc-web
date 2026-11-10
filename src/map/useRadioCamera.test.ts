import { describe, expect, it } from 'vitest'
import type { LiveAircraft } from './livePositions'
import { cameraTargets, easeInOutCubic, focusZoom } from './useRadioCamera'

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

  it('eases in and out', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5)
    expect(easeInOutCubic(0.1)).toBeLessThan(0.1)
    expect(easeInOutCubic(0.9)).toBeGreaterThan(0.9)
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
