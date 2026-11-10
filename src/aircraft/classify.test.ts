import { describe, expect, it } from 'vitest'
import { shapeFor, shapeForCategory, shapeForType } from './classify'

const expectAll = (codes: string, shape: string) => {
  for (const c of codes.split(' ')) expect([c, shapeForType(c)]).toEqual([c, shape])
}

describe('shapeForType', () => {
  it('maps airliners by body', () => {
    expectAll('A20N A21N A319 A320 A321 B737 B738 B739 B38M B39M B3XM B752', 'ac-jet')
    expectAll('A332 A333 A339 A359 A35K B763 B764 B772 B77W B788 B789 B78X', 'ac-heavy')
    expectAll('B744 B748 A388 A346', 'ac-quad')
  })

  it('separates rear-engined regional jets from under-wing small twins', () => {
    expectAll('CRJ2 CRJ7 CRJ9 E135 E145 B712 MD88', 'ac-regional')
    expectAll('E170 E175 E190 E195 E75L E75S E290 BCS1 BCS3', 'ac-ejet')
  })

  it('knows turboprops, business jets, light aircraft and helicopters', () => {
    expectAll('DH8A DH8B DH8C DH8D AT72 AT76 AT45', 'ac-turboprop')
    expectAll('C25A C25B C56X CL30 CL35 CL60 GLF4 GLF5 GLF6 GLEX GL5T GL7T LJ35 LJ45 E55P PC24', 'ac-bizjet')
    expectAll('C150 C152 C172 C182 C206 C208 P28A P28R PA32 SR20 SR22 DA40 BE35 BE36 M20P', 'ac-light')
    expectAll('BE58 PA34 C310 DA42', 'ac-twin-piston')
    expectAll('R22 R44 R66 EC35 EC45 EC30 AS50 AS55 B06 B407 B429 S76 S92 AW09 A109 A139 H125 H135 H145 H160', 'ac-heli')
  })

  it('falls back on families for designators not in the table', () => {
    expect(shapeForType('B78Y')).toBe('ac-heavy')
    expect(shapeForType('GLF7')).toBe('ac-bizjet')
    expect(shapeForType('CRJ5')).toBe('ac-regional')
  })

  it('does not confuse a Cessna 172 with a C-17', () => {
    expect(shapeForType('C172')).toBe('ac-light')
    expect(shapeForType('C17')).toBe('ac-quad')
  })

  it('returns null for unknown or empty codes', () => {
    expect(shapeForType('ZZZZ')).toBeNull()
    expect(shapeForType('')).toBeNull()
    expect(shapeForType(null)).toBeNull()
    expect(shapeForType(' b738 ')).toBe('ac-jet')
  })
})

describe('shapeForCategory', () => {
  it('reads the ADS-B emitter category', () => {
    expect(shapeForCategory('A1')).toBe('ac-light')
    expect(shapeForCategory('A2')).toBe('ac-bizjet')
    expect(shapeForCategory('A3')).toBe('ac-jet')
    expect(shapeForCategory('A5')).toBe('ac-heavy')
    expect(shapeForCategory('A7')).toBe('ac-heli')
    expect(shapeForCategory('C2')).toBe('ac-vehicle')
    expect(shapeForCategory('A0')).toBeNull()
  })
})

describe('shapeFor', () => {
  const moving = { onGround: true, speedKt: 12, headingKnown: true }
  it('uses the type first, then the category, then an airliner', () => {
    expect(shapeFor({ ...moving, type: 'C172', category: 'A3' })).toBe('ac-light')
    expect(shapeFor({ ...moving, type: null, category: 'A1' })).toBe('ac-light')
    expect(shapeFor({ ...moving, type: null, category: null })).toBe('ac-jet')
  })

  it('trusts a rotorcraft category over the type', () => {
    expect(shapeFor({ ...moving, type: 'ZZZZ', category: 'A7' })).toBe('ac-heli')
  })

  it('draws vehicles and heading-less parked aircraft as plain markers', () => {
    expect(shapeFor({ ...moving, type: 'B738', category: 'C1' })).toBe('ac-vehicle')
    expect(shapeFor({ onGround: true, speedKt: 0, headingKnown: false, type: 'B738' })).toBe('ac-dot')
    expect(shapeFor({ onGround: false, speedKt: 0, headingKnown: false, type: 'B738' })).toBe('ac-jet')
  })
})
