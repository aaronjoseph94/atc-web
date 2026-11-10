import { afterEach, describe, expect, it } from 'vitest'
import { logoFor, setLogoIndex } from './logos'

afterEach(() => setLogoIndex(null))

describe('logoFor', () => {
  it('uses the brand logo for regional flights, the operator logo when the brand has none', () => {
    setLogoIndex({ DAL: [60, 52], EDV: [90, 20], SKW: [100, 20] })
    expect(logoFor('EDV5394')).toMatchObject({ code: 'DAL', w: 60, h: 52, name: 'Delta' })
    expect(logoFor('EDV5394')!.url).toMatch(/airline-logos\/DAL\.webp$/)
    // SkyWest flying a number that doesn't say which brand: its own logo.
    expect(logoFor('SKW3201')?.code).toBe('SKW')
  })

  it('has none for private flights, unknown airlines, and transponder addresses standing in for a callsign', () => {
    setLogoIndex({ ACA: [60, 60] })
    expect(logoFor('N1818C')).toBeNull()
    expect(logoFor('ZZZ123')).toBeNull()
    expect(logoFor('ACA123', 'aca123')).toBeNull()
    expect(logoFor('ACA123', 'c0ffee')?.code).toBe('ACA')
    // Replayed scenes use the callsign itself as the id; that is not an address.
    expect(logoFor('ACA123', 'aca1234')?.code).toBe('ACA')
  })
})
