import { describe, expect, it } from 'vitest'
import { decodeTag, encodeTag, TAG, tagLayout } from './tagImages'

describe('tag ids', () => {
  it('round-trip everything drawn on the tag', () => {
    const spec = { active: true, logo: 'DAL', callsign: 'EDV5394', sub: '045↑ CRJ9' }
    expect(decodeTag(encodeTag(spec))).toEqual(spec)
    const bare = { active: false, logo: null, callsign: 'N1818C', sub: '' }
    expect(decodeTag(encodeTag(bare))).toEqual(bare)
  })

  it('ignores other images', () => {
    expect(decodeTag('ac-jet')).toBeNull()
    expect(decodeTag('tag-active')).toBeNull()
  })
})

describe('tagLayout', () => {
  it('is a 26 px plate with the text padded both sides when there is no logo', () => {
    const L = tagLayout({ textW: 40, capH: 8.4 })
    expect(L.height).toBe(TAG.height)
    expect(L.logo).toBeNull()
    expect(L.textX).toBe(TAG.padText)
    expect(L.width).toBe(Math.ceil(TAG.padText * 2 + 40))
    // Capitals centred on the plate.
    expect(L.baseline - 8.4 / 2).toBeCloseTo(TAG.height / 2)
  })

  it('fits a square mark into the logo box and centres it on the callsign row', () => {
    const L = tagLayout({ textW: 40, capH: 8.4, logo: { w: 64, h: 64 } })
    expect(L.logo!.h).toBeCloseTo(TAG.logoH)
    expect(L.logo!.w).toBeCloseTo(TAG.logoH)
    expect(L.logo!.y + L.logo!.h / 2).toBeCloseTo(TAG.height / 2)
    expect(L.textX).toBeCloseTo(TAG.padLogo + TAG.logoW + TAG.gap)
  })

  it('gives a wordmark the full logo width', () => {
    const L = tagLayout({ textW: 40, capH: 8.4, logo: { w: 120, h: 40 } })
    expect(L.logo!.w).toBeCloseTo(TAG.logoW)
    expect(L.logo!.h).toBeCloseTo(TAG.logoW / 3)
  })

  it('lets a very long wordmark run a little wider instead of shrinking to a hairline', () => {
    const L = tagLayout({ textW: 40, capH: 8.4, logo: { w: 128, h: 12 } })
    expect(L.logo!.w).toBeGreaterThan(TAG.logoW)
    expect(L.logo!.w).toBeLessThanOrEqual(TAG.logoMaxW + 1e-9)
    expect(L.textX).toBeCloseTo(TAG.padLogo + L.logo!.w + TAG.gap)
  })

  it('grows for the data block line and keeps both lines inside the plate', () => {
    const L = tagLayout({ textW: 40, capH: 8.4, subW: 60, subCapH: 7 })
    expect(L.height).toBe(TAG.height + TAG.subLine)
    expect(L.width).toBe(Math.ceil(TAG.padText * 2 + 60))
    expect(L.subBaseline).toBeGreaterThan(L.baseline + 7)
    expect(L.subBaseline).toBeLessThan(L.height)
  })
})
