import { describe, expect, it } from 'vitest'
import { ICON_REACH_PX, ICON_SCALE } from './mapImages'
import { iconZoomFactor, TAG_OFFSET, TAG_SIZE_BANDS } from './mapStyle'

describe('tag spacing', () => {
  it('lifts the tag further for bigger aircraft and closer zooms', () => {
    let last = [0, 0, 0]
    for (const [, light, airliner, heavy] of TAG_OFFSET) {
      expect(light).toBeLessThan(airliner)
      expect(airliner).toBeLessThan(heavy)
      expect(light).toBeGreaterThan(last[0])
      expect(airliner).toBeGreaterThan(last[1])
      expect(heavy).toBeGreaterThan(last[2])
      last = [light, airliner, heavy]
    }
  })

  it('puts the classes in the bands they are drawn at', () => {
    const [airliner, heavy] = TAG_SIZE_BANDS
    expect(ICON_SCALE['ac-light']).toBeLessThan(airliner)
    expect(ICON_SCALE['ac-jet']).toBeGreaterThanOrEqual(airliner)
    expect(ICON_SCALE['ac-jet']).toBeLessThan(heavy)
    expect(ICON_SCALE['ac-heavy']).toBeGreaterThanOrEqual(heavy)
    // An aircraft fading in is drawn at 85% for a moment; an airliner stays an airliner through it.
    expect(ICON_SCALE['ac-jet'] * 0.85).toBeGreaterThanOrEqual(airliner)
  })

  it('keeps each tag near the top of its own aircraft up to the gate zooms', () => {
    // Half the drawing's length on screen for a typical member of each band.
    const reach = (zoom: number, scale: number) => ICON_REACH_PX * iconZoomFactor(zoom) * scale
    for (const [zoom, light, airliner, heavy] of TAG_OFFSET.filter(([z]) => z <= 16)) {
      for (const [offset, scale] of [
        [light, ICON_SCALE['ac-light']],
        [airliner, ICON_SCALE['ac-jet']],
        [heavy, ICON_SCALE['ac-heavy']],
      ]) {
        const ratio = offset / reach(zoom, scale)
        // Never deep into the fuselage, never floating a whole aircraft away (wide views excepted: there the icons are tiny and the tag needs air).
        expect(ratio).toBeGreaterThan(0.72)
        if (zoom >= 14) expect(ratio).toBeLessThan(1.45)
      }
    }
  })
})
