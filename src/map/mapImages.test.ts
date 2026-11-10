import { describe, expect, it } from 'vitest'
import { ICON_SCALE, iconFor, iconImage, maskToSdf } from './mapImages'

describe('ICON_SCALE', () => {
  it('sizes classes by real size, compressed, with a floor for small aircraft', () => {
    expect(ICON_SCALE['ac-jet']).toBe(1)
    expect(ICON_SCALE['ac-quad']).toBeGreaterThan(ICON_SCALE['ac-heavy'])
    expect(ICON_SCALE['ac-heavy']).toBeGreaterThan(ICON_SCALE['ac-jet'])
    expect(ICON_SCALE['ac-jet']).toBeGreaterThan(ICON_SCALE['ac-regional'])
    expect(ICON_SCALE['ac-regional']).toBeGreaterThan(ICON_SCALE['ac-light'])
    expect(ICON_SCALE['ac-light']).toBeGreaterThanOrEqual(0.6)
    expect(ICON_SCALE['ac-heli']).toBeGreaterThan(ICON_SCALE['ac-light'])
    expect(ICON_SCALE['ac-quad']).toBeLessThan(1.6)
  })
})

describe('iconFor', () => {
  it('reads the type, then the category', () => {
    expect(iconFor({ type: 'B77W', onGround: false, speedKt: 300 })).toBe('ac-heavy')
    expect(iconFor({ type: null, category: 'A7', onGround: false, speedKt: 90 })).toBe('ac-heli')
    expect(iconFor({ type: 'GLF6', onGround: true, speedKt: 10 })).toBe('ac-bizjet')
  })
})

describe('iconImage', () => {
  it('spins the rotor only for helicopters in the air, and not with reduced motion', () => {
    const frames = new Set([0, 70, 140, 210].map((t) => iconImage('ac-heli', true, t, false)))
    expect(frames.size).toBe(3)
    expect(iconImage('ac-heli', false, 70, false)).toBe('ac-heli')
    expect(iconImage('ac-heli', true, 70, true)).toBe('ac-heli')
    expect(iconImage('ac-jet', true, 70, false)).toBe('ac-jet')
  })
})

describe('maskToSdf', () => {
  it('puts the edge at 0.75 and falls off outside', () => {
    const w = 16
    const mask = new Uint8ClampedArray(w * w * 4)
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) mask[(y * w + x) * 4 + 3] = 255
    const sdf = maskToSdf(mask, w, w, 4)
    const at = (x: number, y: number) => sdf[(y * w + x) * 4 + 3] / 255
    expect(at(8, 8)).toBe(1)
    expect(at(0, 0)).toBe(0)
    expect(at(13, 8)).toBeLessThan(0.75)
    expect(at(13, 8)).toBeCloseTo(0.25, 1)
  })
})
