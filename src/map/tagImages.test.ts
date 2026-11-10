import { describe, expect, it } from 'vitest'
import { decodeTag, encodeTag, TAG, tagLayout } from './tagImages'

describe('tag ids', () => {
  it('round-trip everything drawn on the tag', () => {
    const spec = { active: true, logo: 'DAL', callsign: 'EDV5394', sub: '045↑ CRJ9' }
    expect(decodeTag(encodeTag(spec))).toEqual(spec)
    const bare = { active: false, logo: null, callsign: 'N1818C', sub: '' }
    expect(decodeTag(encodeTag(bare))).toEqual(bare)
  })

  it('carries the rare-aircraft star only when there is one', () => {
    const star = { active: false, logo: 'GTI', callsign: 'GTI8401', sub: '', star: true }
    expect(encodeTag(star)).toBe('tag|n*|GTI|GTI8401|')
    expect(decodeTag(encodeTag(star))).toEqual(star)
    expect(decodeTag(encodeTag({ ...star, active: true }))).toEqual({ ...star, active: true })
    expect(encodeTag({ ...star, star: false })).toBe('tag|n|GTI|GTI8401|')
  })

  it('ignores other images', () => {
    expect(decodeTag('ac-jet')).toBeNull()
    expect(decodeTag('tag-active')).toBeNull()
  })
})

describe('tagLayout', () => {
  it('makes room for the star after the callsign', () => {
    const plain = tagLayout({ textW: 40, capH: 8.4 })
    const L = tagLayout({ textW: 40, capH: 8.4, star: true })
    expect(plain.star).toBeNull()
    expect(Math.abs(L.width - plain.width - (TAG.starGap + TAG.starR * 2))).toBeLessThan(1)
    expect(L.star!.x).toBeCloseTo(L.textX + 40 + TAG.starGap + TAG.starR)
    expect(L.star!.x + TAG.starR).toBeLessThanOrEqual(L.width - TAG.padText + 1)
  })


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
