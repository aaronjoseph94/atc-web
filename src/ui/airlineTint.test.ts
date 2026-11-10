import { describe, expect, it } from 'vitest'
import { CARD_TOP, dominantColor, hexToRgb, mixOklch, oklchToRgb, rgbToHex, rgbToOklch, tintCard, whiteContrast, type Rgb } from './airlineTint'

/** RGBA pixel data from a list of [colour, count]. */
function pixels(list: [Rgb | [number, number, number, number], number][]): Uint8ClampedArray {
  const out: number[] = []
  for (const [c, n] of list) for (let i = 0; i < n; i++) out.push(c[0], c[1], c[2], c.length > 3 ? (c as number[])[3] : 255)
  return new Uint8ClampedArray(out)
}

describe('airline tint', () => {
  it('round-trips colours through OKLCH', () => {
    for (const hex of ['#5b3df5', '#e21a32', '#00aca6', '#0f4169', '#ffffff', '#000000']) {
      const back = rgbToHex(oklchToRgb(rgbToOklch(hexToRgb(hex))))
      const [a, b] = [hexToRgb(hex), hexToRgb(back)]
      for (let i = 0; i < 3; i++) expect(Math.abs(a[i] - b[i])).toBeLessThanOrEqual(1)
    }
  })

  it('mixes hues the short way round', () => {
    expect(mixOklch([0.5, 0.1, 350], [0.5, 0.1, 10], 0.5)[2]).toBeCloseTo(0)
    expect(mixOklch([0.5, 0.1, 280], [0.5, 0.1, 200], 0.25)[2]).toBeCloseTo(260)
  })

  it('finds the brand colour and ignores white, grey, black and transparent pixels', () => {
    const red: Rgb = [226, 26, 50]
    const data = pixels([
      [[255, 255, 255], 400],
      [[20, 20, 20], 200],
      [[128, 128, 128], 200],
      [[0, 0, 255, 0], 500],
      [red, 120],
      [[0, 90, 200], 30],
    ])
    const c = dominantColor(data)!
    expect(c).not.toBeNull()
    expect(Math.abs(rgbToOklch(c)[2] - rgbToOklch(red)[2])).toBeLessThan(6)
  })

  it('leaves monochrome logos alone', () => {
    expect(dominantColor(pixels([[[240, 240, 245], 500]]))).toBeNull()
    // A sliver of colour on a white wordmark is not a brand colour.
    expect(dominantColor(pixels([[[240, 240, 245], 500], [[226, 26, 50], 10]]))).toBeNull()
    expect(dominantColor(new Uint8ClampedArray(0))).toBeNull()
  })

  it('leans the card toward the airline but stays mostly card purple', () => {
    const purple = rgbToOklch(hexToRgb(CARD_TOP))
    const red = tintCard([226, 26, 50])
    const top = rgbToOklch(hexToRgb(red.top))
    // Hue moved toward red (via magenta), but only part of the way.
    let dh = top[2] - purple[2]
    if (dh < -180) dh += 360
    expect(dh).toBeGreaterThan(5)
    expect(dh).toBeLessThanOrEqual(22.5)
  })

  it('keeps white text at 4.5:1 or better, even for pale or bright brands', () => {
    for (const brand of [[255, 214, 0], [0, 200, 255], [255, 255, 160], [226, 26, 50], [0, 172, 166]] as Rgb[]) {
      const t = tintCard(brand)
      expect(whiteContrast(hexToRgb(t.top))).toBeGreaterThanOrEqual(4.5)
      expect(whiteContrast(hexToRgb(t.bottom))).toBeGreaterThanOrEqual(4.5)
    }
  })
})
