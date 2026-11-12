import { describe, expect, it } from 'vitest'
import { LAYER, lightingLayers, lightOpacity, LIGHT_LAYER, nightPaint, themeHasLights } from '../mapStyle'
import { differs, formatColor, mixColor, mixValue, nightShade, parseColor } from './color'

describe('colour helpers', () => {
  it('parses the colour forms the style uses', () => {
    expect(parseColor('#1A2238')).toEqual([26, 34, 56, 1])
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1])
    expect(parseColor('rgba(5,10,22,0.75)')).toEqual([5, 10, 22, 0.75])
    expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3, 1])
    expect(parseColor('match')).toBeNull()
  })

  it('mixes and formats', () => {
    expect(formatColor(mixColor([0, 0, 0, 1], [255, 255, 255, 1], 0.5))).toBe('rgba(128,128,128,1)')
  })

  it('makes night shades darker and greyer', () => {
    const day = parseColor('#33594C')!
    const night = parseColor(nightShade('#33594C', 0.6, 0.55))!
    const lum = (c: number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
    const spread = (c: number[]) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])
    expect(lum(night)).toBeLessThan(lum(day) * 0.7)
    expect(spread(night)).toBeLessThan(spread(day) * 0.5)
  })

  it('blends whole expressions, colours and numbers only', () => {
    const day = ['interpolate', ['linear'], ['zoom'], 11, '#000000', 13.5, '#FFFFFF']
    const night = ['interpolate', ['linear'], ['zoom'], 11, '#000000', 13.5, '#000000']
    expect(mixValue(day, night, 0)).toBe(day)
    expect(mixValue(day, night, 0.5)).toEqual(['interpolate', ['linear'], ['zoom'], 11, '#000000', 13.5, 'rgba(128,128,128,1)'])
    expect(mixValue(0.82, 0.42, 0.5)).toBeCloseTo(0.62, 5)
    expect(differs(day, night)).toBe(true)
    expect(differs(day, [...day])).toBe(false)
  })
})

describe('night paint plan', () => {
  it('darkens the ground layers and leaves the aircraft alone', () => {
    const plan = nightPaint('navy', false)
    const layers = new Set(plan.map((e) => e.layer))
    for (const id of ['bg', 'water', 'landcover-grass', 'aero-apron', 'apt-surface']) expect(layers.has(id)).toBe(true)
    for (const id of Object.values(LAYER).filter((l) => l.startsWith('ac-'))) expect(layers.has(id)).toBe(false)
    // Day values are what the theme paints, so blending at 0 changes nothing.
    const water = plan.find((e) => e.layer === 'water')!
    expect(water.day).toBe('#060F27')
    expect(mixValue(water.day, water.night, 0)).toBe('#060F27')
  })

  it('keeps a desert airport’s ground slate at night', () => {
    const grass = (arid: boolean) => nightPaint('navy', arid).find((e) => e.layer === 'landcover-grass')!
    expect(grass(true).day).not.toEqual(grass(false).day)
    expect(grass(true).night).not.toEqual(grass(false).night)
  })

  it('dims aerial photos and leaves the paper chart alone', () => {
    expect(nightPaint('satellite', false).some((e) => e.layer === 'raster-satellite')).toBe(true)
    expect(nightPaint('chart', false)).toEqual([])
    expect(themeHasLights('chart')).toBe(false)
    expect(themeHasLights('navy')).toBe(true)
  })

  it('declares every light layer hidden, with an opacity that scales with the night', () => {
    const specs = lightingLayers()
    expect(specs.map((s) => s.layer.id).sort()).toEqual(Object.values(LIGHT_LAYER).sort())
    for (const { layer } of specs) expect((layer.layout as { visibility: string }).visibility).toBe('none')
    const { prop, value } = lightOpacity(LIGHT_LAYER.runwayCore, 0.5)
    expect(prop).toBe('circle-opacity')
    // Half way to night, half the layer's full strength.
    const full = lightOpacity(LIGHT_LAYER.runwayCore, 1).value
    expect(value[value.length - 1]).toBeCloseTo((full[full.length - 1] as number) / 2)
    expect(lightOpacity(LIGHT_LAYER.apronWash, 1).prop).toBe('fill-opacity')
  })

  it('keeps the lights mellow: no layer at full strength, blooms fainter than cores', () => {
    const peak = (id: string) => {
      const v = lightOpacity(id, 1).value
      return v[v.length - 1] as number
    }
    for (const id of Object.values(LIGHT_LAYER)) expect(peak(id)).toBeLessThanOrEqual(0.8)
    expect(peak(LIGHT_LAYER.runwayBloom)).toBeLessThan(peak(LIGHT_LAYER.runwayCore) / 2)
    expect(peak(LIGHT_LAYER.taxiBloom)).toBeLessThan(peak(LIGHT_LAYER.taxiCore) / 2)
    // Taxiway lights are everywhere, so they stay below the runway's.
    expect(peak(LIGHT_LAYER.taxiCore)).toBeLessThan(peak(LIGHT_LAYER.runwayCore))
  })
})
