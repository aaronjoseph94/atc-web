import { describe, expect, it } from 'vitest'
import { easeInOutCubic, focusZoom } from './useRadioCamera'

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
