import { describe, expect, it } from 'vitest'
import { chooseGlass, contrast, downgrade, GLASS_TINT, medianFrame, over, type Rgb } from './glass'
import { clampDockWidth, DOCK_DEFAULT, DOCK_INSET, DOCK_MAX, DOCK_MIN, dockReserve } from './layout'
import { mapStateFor } from './mapStatus'
import { fadeEdges } from './scrollFade'
import { sheetStretch } from './useSheetDrag'

describe('chooseGlass', () => {
  const strong = { supports: true, cores: 8, memoryGb: 8 }
  it('gives capable machines the full glass', () => {
    expect(chooseGlass(strong)).toBe('full')
    expect(chooseGlass({ supports: true, cores: 4, apple: true })).toBe('full')
  })
  it('keeps big surfaces solid on middling machines', () => {
    expect(chooseGlass({ supports: true, cores: 4, memoryGb: 4 })).toBe('lite')
    expect(chooseGlass({ ...strong, frameMs: 20 })).toBe('lite')
  })
  it('turns blur off where it would hurt or is unwanted', () => {
    expect(chooseGlass({ ...strong, supports: false })).toBe('off')
    expect(chooseGlass({ ...strong, reducedTransparency: true })).toBe('off')
    expect(chooseGlass({ ...strong, saveData: true })).toBe('off')
    expect(chooseGlass({ supports: true, cores: 2 })).toBe('off')
    expect(chooseGlass({ supports: true, cores: 8, memoryGb: 2 })).toBe('off')
    expect(chooseGlass({ ...strong, frameMs: 30 })).toBe('off')
  })
  it('steps down one tier at a time', () => {
    expect(downgrade('full')).toBe('lite')
    expect(downgrade('lite')).toBe('off')
    expect(downgrade('off')).toBe('off')
  })
})

describe('medianFrame', () => {
  it('needs enough samples and ignores stalls', () => {
    expect(medianFrame([16, 17])).toBeNull()
    expect(medianFrame([...Array(20).fill(16.7), 900, 1200])).toBeCloseTo(16.7)
  })
})

describe('glass tints keep text readable', () => {
  // The brightest broad colour the map puts behind chrome (light slate labels and lines, blurred together),
  // and the plain white the glass would show over the brightest possible spot.
  const brightMap: Rgb = [0x8b, 0x95, 0xae]
  const white: Rgb = [255, 255, 255]
  const text = (alpha: number, bg: Rgb) => over(white, alpha, bg)

  for (const [name, tint] of Object.entries(GLASS_TINT)) {
    it(`${name}: white and secondary text pass AA over the brightest map`, () => {
      const bg = over(tint.rgb, tint.alpha, brightMap)
      expect(contrast(white, bg)).toBeGreaterThanOrEqual(7)
      // Secondary text in panels is white at 55-65%.
      expect(contrast(text(0.65, bg), bg)).toBeGreaterThanOrEqual(4.5)
    })
    it(`${name}: still legible over pure white`, () => {
      const bg = over(tint.rgb, tint.alpha, white)
      expect(contrast(white, bg)).toBeGreaterThanOrEqual(4.5)
    })
  }
})

describe('dock width', () => {
  it('stays within its range', () => {
    expect(clampDockWidth(100, 1440)).toBe(DOCK_MIN)
    expect(clampDockWidth(9999, 1440)).toBe(DOCK_MAX)
    expect(clampDockWidth(DOCK_DEFAULT, 1440)).toBe(DOCK_DEFAULT)
  })
  it('gives the map room on narrower screens', () => {
    expect(clampDockWidth(DOCK_MAX, 1024)).toBeLessThan(DOCK_MAX)
    expect(clampDockWidth(DOCK_MAX, 1024)).toBeGreaterThanOrEqual(DOCK_MIN)
  })
  it('reserves nothing while hidden', () => {
    expect(dockReserve(false, 400, 1440)).toBe(0)
    expect(dockReserve(true, 400, 1440)).toBe(400 + DOCK_INSET)
  })
})

describe('mapStateFor', () => {
  it('says nothing in a replay or with traffic on the map', () => {
    expect(mapStateFor({ mode: 'playback', liveStatus: 'loading', liveCount: 0 })).toBeNull()
    expect(mapStateFor({ mode: 'live', liveStatus: 'error', liveCount: 12 })).toBeNull()
  })
  it('loads, goes quiet, or goes offline', () => {
    expect(mapStateFor({ mode: 'live', liveStatus: 'idle', liveCount: 0 })).toBe('loading')
    expect(mapStateFor({ mode: 'live', liveStatus: 'loading', liveCount: 0 })).toBe('loading')
    expect(mapStateFor({ mode: 'live', liveStatus: 'ok', liveCount: 0 })).toBe('quiet')
    expect(mapStateFor({ mode: 'live', liveStatus: 'error', liveCount: 0 })).toBe('offline')
  })
})

describe('fadeEdges', () => {
  it('fades only toward hidden content', () => {
    expect(fadeEdges(0, 500, 500)).toEqual({ top: false, bottom: false })
    expect(fadeEdges(0, 500, 900)).toEqual({ top: false, bottom: true })
    expect(fadeEdges(200, 500, 900)).toEqual({ top: true, bottom: true })
    expect(fadeEdges(400, 500, 900)).toEqual({ top: true, bottom: false })
  })
})

describe('sheetStretch', () => {
  it('reacts only to pulls that go nowhere', () => {
    expect(sheetStretch(-20, true, false)).toBeGreaterThan(0)
    expect(sheetStretch(-20, true, true)).toBe(0)
    expect(sheetStretch(30, true, false)).toBe(0)
    expect(sheetStretch(30, false, false)).toBeGreaterThan(0)
    expect(sheetStretch(-500, true, false)).toBe(1)
  })
})
