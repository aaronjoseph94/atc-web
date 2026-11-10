import { describe, expect, it } from 'vitest'
import { bankOfImage, ICON_SCALE, iconFor, iconImage, maskToSdf, shapeOfImage } from './mapImages'
import { artImage, artTierPx, artTiersFor, iconZoomFactor } from './mapStyle'

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

describe('iconZoomFactor', () => {
  it('matches the style stops and grows smoothly between them', () => {
    expect(iconZoomFactor(5)).toBe(0.5)
    expect(iconZoomFactor(14)).toBeCloseTo(0.9)
    expect(iconZoomFactor(16)).toBeCloseTo(1.8)
    expect(iconZoomFactor(25)).toBe(14.4)
    expect(iconZoomFactor(14.5)).toBeGreaterThan(0.9)
    expect(iconZoomFactor(14.5)).toBeLessThan(1.2)
  })
})

describe('reduced artwork copies', () => {
  it('are sized to the drawn size on the screen, never above full size', () => {
    expect(artTierPx(14.6, 1, 1)).toBe(64)
    expect(artTierPx(14.6, 1, 3)).toBeGreaterThan(artTierPx(14.6, 1, 2))
    expect(artTierPx(16.2, 1.5, 3)).toBe(384)
  })

  it('leave out a tier that would be about full size anyway', () => {
    expect(artTiersFor(1).map((t) => t.suffix)).toEqual(['~s', '~m'])
    expect(artTiersFor(3).map((t) => t.suffix)).toEqual(['~s'])
  })

  it('pick the copy by zoom in the style', () => {
    expect(JSON.stringify(artImage(['get', 'icon']))).toContain('"step",["zoom"],["concat",["get","icon"],"~s"]')
  })

  it('still name their class and bank', () => {
    expect(shapeOfImage('ac-jet-hi~s')).toBe('ac-jet')
    expect(shapeOfImage('ac-heli-r2~m')).toBe('ac-heli')
    expect(shapeOfImage('ac-jet-bL2-hi~s')).toBe('ac-jet')
    expect(bankOfImage('ac-jet-bL2-hi~s')).toEqual({ dir: 'L', level: 2 })
  })
})
