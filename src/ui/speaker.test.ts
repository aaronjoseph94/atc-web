import { describe, expect, it } from 'vitest'
import { parseColor } from '../map/lighting/color'
import { contrast, GLASS_TINT, over, type Rgb } from './glass'
import { ATC_COLORS, PILOT_COLORS, speakerColors } from './speaker'

/** Hue in degrees and saturation (0..1) of a hex colour. */
function hueSat(hex: string): [number, number] {
  const [r, g, b] = parseColor(hex)!.map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [(h * 60 + 360) % 360, max ? d / max : 0]
}

describe('speaker colours', () => {
  it('pulses pink while ATC talks to the aircraft', () => {
    expect(speakerColors('controller')).toBe(ATC_COLORS)
    const [hue] = hueSat(ATC_COLORS.base)
    expect(hue).toBeGreaterThan(315)
    expect(hue).toBeLessThan(340)
  })

  it('pulses blue while the aircraft talks to ATC', () => {
    expect(speakerColors('pilot')).toBe(PILOT_COLORS)
    const [hue] = hueSat(PILOT_COLORS.base)
    expect(hue).toBeGreaterThan(205)
    expect(hue).toBeLessThan(225)
  })

  it('keeps both mellow: tints, not saturated signal colours', () => {
    for (const c of [ATC_COLORS, PILOT_COLORS]) {
      expect(hueSat(c.base)[1]).toBeLessThan(0.65)
      expect(hueSat(c.light)[1]).toBeLessThan(hueSat(c.base)[1])
    }
  })

  it('treats an unattributed call as ATC', () => {
    expect(speakerColors(null)).toBe(ATC_COLORS)
    expect(speakerColors(undefined)).toBe(ATC_COLORS)
  })

  it('has a light tint that reads as text on the panels', () => {
    // The transcript's speaker labels: over the sheet tint with the brightest map behind it.
    const sheet = over(GLASS_TINT.sheet.rgb, GLASS_TINT.sheet.alpha, [0x8b, 0x95, 0xae])
    for (const c of [ATC_COLORS, PILOT_COLORS]) expect(contrast(parseColor(c.light)!.slice(0, 3) as Rgb, sheet)).toBeGreaterThanOrEqual(7)
  })
})
