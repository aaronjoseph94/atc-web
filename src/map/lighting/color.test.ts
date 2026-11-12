import { describe, expect, it } from 'vitest'
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
