import { describe, expect, it } from 'vitest'
import { shapeForType } from './classify'
import { formatCruise, formatLength, formatRange } from './format'
import { aircraftProfile, describeEngines, typeFacts, TYPES } from './types'

describe('TYPES', () => {
  it('covers the common types', () => {
    expect(Object.keys(TYPES).length).toBeGreaterThanOrEqual(60)
    for (const c of 'A320 A20N A321 A21N B738 B38M B739 B752 B763 B772 B77W B789 A333 A359 B744 A388 CRJ9 E75L DH8D AT76 GLEX C172 EC35'.split(' ')) expect(typeFacts(c), c).not.toBeNull()
  })

  it('has plausible figures', () => {
    for (const [code, f] of Object.entries(TYPES)) {
      expect(f.engines.count, code).toBeGreaterThanOrEqual(1)
      expect(f.engines.count, code).toBeLessThanOrEqual(4)
      if (f.spanM != null) expect(f.spanM, code).toBeGreaterThan(5)
      if (f.spanM != null) expect(f.spanM, code).toBeLessThan(85)
      if (f.lengthM != null) expect(f.lengthM, code).toBeGreaterThan(5)
      if (f.lengthM != null) expect(f.lengthM, code).toBeLessThan(85)
      if (f.rangeNm != null) expect(f.rangeNm, code).toBeLessThan(9000)
      if (f.firstFlight != null) expect(f.firstFlight, code).toBeGreaterThan(1940)
      if (f.cruise && 'mach' in f.cruise) expect(f.cruise.mach, code).toBeLessThan(1)
      // Every type in the table has a drawing of its own class.
      expect(shapeForType(code), code).not.toBeNull()
    }
  })

  it('agrees with the drawing on what kind of engine it has', () => {
    for (const [code, f] of Object.entries(TYPES)) {
      const shape = shapeForType(code)
      if (shape === 'ac-heli') expect(['turboshaft', 'piston'], code).toContain(f.engines.type)
      if (shape === 'ac-turboprop') expect(f.engines.type, code).toBe('turboprop')
      if (shape === 'ac-jet' || shape === 'ac-heavy' || shape === 'ac-quad' || shape === 'ac-bizjet') expect(f.engines.type, code).toBe('turbofan')
    }
  })
})

describe('aircraftProfile', () => {
  it('names a known type and picks its drawing', () => {
    const p = aircraftProfile({ type: 'b38m' })
    expect(p.title).toBe('Boeing 737 MAX 8')
    expect(p.shape).toBe('ac-jet')
    expect(p.facts?.firstFlight).toBe(2016)
  })

  it('falls back to the database name without numbers', () => {
    const p = aircraftProfile({ type: 'XYZ1', dbName: 'Widget 9', dbManufacturer: 'Acme' })
    expect(p.facts).toBeNull()
    expect(p.title).toBe('Acme Widget 9')
    expect(aircraftProfile({ type: 'XYZ1', dbName: 'Airbus A321', dbManufacturer: 'Airbus' }).title).toBe('Airbus A321')
  })

  it('draws an unknown aircraft by its category', () => {
    expect(aircraftProfile({ type: null, category: 'A7' }).shape).toBe('ac-heli')
    expect(aircraftProfile({ type: 'ZZZZ', category: 'A1' })).toMatchObject({ shape: 'ac-light', facts: null, title: null })
    expect(aircraftProfile({}).shape).toBe('ac-jet')
  })
})

describe('formatting', () => {
  it('describes engines', () => {
    expect(describeEngines({ count: 2, type: 'turbofan' })).toBe('2 × turbofan')
  })

  it('follows the unit settings', () => {
    expect(formatLength(35.8, 'm')).toBe('35.8 m')
    expect(formatLength(35.8, 'ft')).toBe('117 ft')
    expect(formatRange(3500, 'kt')).toBe('3,500 nm')
    expect(formatRange(3500, 'kmh')).toBe('6,500 km')
    expect(formatRange(3500, 'mph')).toBe('4,050 mi')
    expect(formatCruise({ mach: 0.78 }, 'kt')).toBe('Mach 0.78')
    expect(formatCruise({ kt: 124 }, 'kmh')).toBe('230 km/h')
  })
})
