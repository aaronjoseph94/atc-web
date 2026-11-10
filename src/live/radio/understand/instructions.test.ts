import { describe, expect, it } from 'vitest'
import { badgeLabel, normaliseInstruction, normCallsign, normRunway, parseAltitude, parseMhz, stepText, type Instruction } from './instructions'
import type { RawInstruction } from '../../../api/ai/tasks/radioCleanup'

const raw = (p: Partial<RawInstruction>): RawInstruction => ({ type: 'other', callsign: '', action: '', value: '', facility: '', runway: '', route: [], ...p })
const JFK = ['4L', '22R', '4R', '22L', '13L', '31R', '13R', '31L']
const n = (p: Partial<RawInstruction>, runways = JFK) => normaliseInstruction(raw(p), runways)

describe('value parsers', () => {
  it('reads altitudes and flight levels', () => {
    expect(parseAltitude('5000')).toEqual({ ft: 5000, fl: false })
    expect(parseAltitude('5,000 ft')).toEqual({ ft: 5000, fl: false })
    expect(parseAltitude('FL240')).toEqual({ ft: 24000, fl: true })
    expect(parseAltitude('flight level 350')).toEqual({ ft: 35000, fl: true })
    expect(parseAltitude('5050')).toBeNull()
    expect(parseAltitude('two thousand')).toBeNull()
    expect(parseAltitude('99999')).toBeNull()
  })

  it('reads airband frequencies only', () => {
    expect(parseMhz('124.75')).toBe(124.75)
    expect(parseMhz('124,750')).toBe(124.75)
    expect(parseMhz('12475')).toBe(124.75)
    expect(parseMhz('121.9 MHz')).toBe(121.9)
    expect(parseMhz(135.05)).toBe(135.05)
    expect(parseMhz('108.5')).toBeNull()
    expect(parseMhz('')).toBeNull()
  })

  it('spells runways the way the airport does', () => {
    expect(normRunway('31 left', JFK)).toBe('31L')
    expect(normRunway('runway 04R', JFK)).toBe('4R')
    expect(normRunway('13R', JFK)).toBe('13R')
    expect(normRunway('06', ['06', '24'])).toBe('06')
    expect(normRunway('27', JFK)).toBe('27')
    expect(normRunway('41L', JFK)).toBeNull()
    expect(normRunway('alpha', JFK)).toBeNull()
  })

  it('tidies callsigns', () => {
    expect(normCallsign('dal 288')).toBe('DAL288')
    expect(normCallsign('N1818C')).toBe('N1818C')
    expect(normCallsign('CGENW')).toBe('CGENW')
    expect(normCallsign('')).toBeNull()
    expect(normCallsign('X')).toBeNull()
  })
})

describe('normaliseInstruction', () => {
  it('normalises each kind', () => {
    expect(n({ type: 'altitude', action: 'Climb', value: '5,000', callsign: 'dal288' })).toEqual({ kind: 'altitude', callsign: 'DAL288', action: 'climb', ft: 5000, fl: false })
    expect(n({ type: 'altitude', action: 'descend and maintain', value: 'FL240' })).toMatchObject({ kind: 'altitude', action: 'descend', ft: 24000, fl: true })
    expect(n({ type: 'heading', action: 'turn left', value: '270' })).toMatchObject({ kind: 'heading', action: 'left', deg: 270 })
    expect(n({ type: 'heading', action: 'fly', value: '90°' })).toMatchObject({ kind: 'heading', action: 'fly', deg: 90 })
    expect(n({ type: 'speed', action: 'reduce', value: '210 knots' })).toMatchObject({ kind: 'speed', kt: 210 })
    expect(n({ type: 'squawk', value: '4721' })).toMatchObject({ kind: 'squawk', code: '4721' })
    expect(n({ type: 'handoff', action: 'contact', facility: 'Departure', value: '124.75' })).toMatchObject({ kind: 'handoff', action: 'contact', facility: 'Departure', mhz: 124.75 })
    expect(n({ type: 'handoff', action: 'monitor', facility: 'Ground', value: '' })).toMatchObject({ kind: 'handoff', action: 'monitor', facility: 'Ground', mhz: null })
    expect(n({ type: 'runway', action: 'line up and wait', runway: '31 left' })).toMatchObject({ kind: 'runway', action: 'luaw', runway: '31L' })
    expect(n({ type: 'runway', action: 'hold short', runway: '4L' })).toMatchObject({ kind: 'runway', action: 'hold_short', runway: '4L' })
    expect(n({ type: 'runway', action: 'go_around' })).toMatchObject({ kind: 'runway', action: 'go_around', runway: null })
    expect(n({ type: 'taxi', action: 'taxi', route: ['alpha?', 'B', 'k-a', 'Kilo 4'], runway: '31L' })).toMatchObject({ kind: 'taxi', via: ['A', 'B', 'KA', 'K4'], runway: '31L' })
    expect(n({ type: 'pushback', action: 'pushback' })).toEqual({ kind: 'pushback', callsign: null })
  })

  it('drops instructions that do not add up', () => {
    expect(n({ type: 'heading', value: '400' })).toBeNull()
    expect(n({ type: 'speed', value: '20' })).toBeNull()
    expect(n({ type: 'squawk', value: '7891' })).toBeNull()
    expect(n({ type: 'handoff', value: '99.1' })).toBeNull()
    expect(n({ type: 'runway', action: 'land', runway: '' })).toBeNull()
    expect(n({ type: 'runway', action: 'dance', runway: '4L' })).toBeNull()
    expect(n({ type: 'taxi', route: [] })).toBeNull()
    expect(n({ type: 'other', action: 'report the marker' })).toBeNull()
    expect(normaliseInstruction(null)).toBeNull()
    expect(normaliseInstruction({ type: 'nonsense' } as unknown as RawInstruction)).toBeNull()
  })
})

describe('labels', () => {
  const cases: [Instruction, string, string][] = [
    [{ kind: 'altitude', callsign: null, action: 'climb', ft: 5000, fl: false }, '↑5,000', 'climb 5,000'],
    [{ kind: 'altitude', callsign: null, action: 'descend', ft: 24000, fl: true }, '↓FL240', 'descend FL240'],
    [{ kind: 'altitude', callsign: null, action: 'maintain', ft: 3000, fl: false }, 'ALT 3,000', 'maintain 3,000'],
    [{ kind: 'heading', callsign: null, action: 'left', deg: 90 }, 'HDG 090', 'turn left 090'],
    [{ kind: 'speed', callsign: null, action: 'reduce', kt: 180 }, 'SPD 180', 'speed 180'],
    [{ kind: 'squawk', callsign: null, code: '4721' }, 'SQK 4721', 'squawk 4721'],
    [{ kind: 'handoff', callsign: null, action: 'contact', facility: 'Departure', mhz: 124.75 }, '→124.75', 'contact Departure 124.75'],
    [{ kind: 'handoff', callsign: null, action: 'contact', facility: 'Ground', mhz: 121.875 }, '→121.875', 'contact Ground 121.875'],
    [{ kind: 'handoff', callsign: null, action: 'monitor', facility: 'Tower', mhz: null }, '→TOWER', 'monitor Tower'],
    [{ kind: 'runway', callsign: null, action: 'takeoff', runway: '31L' }, 'TAKEOFF 31L', 'cleared for takeoff 31L'],
    [{ kind: 'runway', callsign: null, action: 'hold_short', runway: '4L' }, 'HOLD SHORT 4L', 'hold short 4L'],
    [{ kind: 'runway', callsign: null, action: 'go_around', runway: '4R' }, 'GO AROUND', 'go around'],
    [{ kind: 'taxi', callsign: null, runway: '31L', via: ['A', 'B'] }, 'TAXI 31L', 'taxi via A, B to 31L'],
    [{ kind: 'taxi', callsign: null, runway: null, via: ['K', 'KA', 'B', 'C'] }, 'TAXI K KA B', 'taxi via K, KA, B, C'],
    [{ kind: 'pushback', callsign: null }, 'PUSHBACK', 'pushback'],
  ]
  it.each(cases)('%o', (i, badge, step) => {
    expect(badgeLabel(i)).toBe(badge)
    expect(stepText(i)).toBe(step)
  })
})
