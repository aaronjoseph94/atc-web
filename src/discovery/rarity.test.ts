import { describe, expect, it } from 'vitest'
import { militaryInfo } from './military'
import { directionText, fallbackLine, spotDirection, spotName } from './notes'
import { airportClass, NOTABLE_SCORE, RARE_SCORE, scoreRarity, typeTier } from './rarity'

const ac = (over: Partial<Parameters<typeof scoreRarity>[0]> = {}) => ({ icao24: 'a1b2c3', callsign: 'UAL123', type: 'B738', registration: 'N12345', category: 'A3', ...over })

describe('militaryInfo', () => {
  it('reads military callsign prefixes followed by a number', () => {
    expect(militaryInfo({ callsign: 'RCH871' })).toMatchObject({ by: 'callsign', operator: 'US Air Mobility Command (Reach)', vip: false })
    expect(militaryInfo({ callsign: 'CNV4521' })?.operator).toBe('US Navy (Convoy)')
    expect(militaryInfo({ callsign: 'PAT21' })?.operator).toBe('US Army (Patriot)')
    expect(militaryInfo({ callsign: 'SAM44' })).toMatchObject({ vip: true })
    expect(militaryInfo({ callsign: 'VENUS21' })).toMatchObject({ vip: true, operator: 'US Air Force VIP transport' })
    expect(militaryInfo({ callsign: 'AF1' })).toMatchObject({ operator: 'Air Force One', vip: true })
  })

  it('does not mistake airline or private callsigns for military ones', () => {
    expect(militaryInfo({ callsign: 'SAMBA' })).toBeNull()
    expect(militaryInfo({ callsign: 'PATRIOT' })).toBeNull()
    expect(militaryInfo({ callsign: 'DAL227', icao24: 'a1b2c3', registration: 'N123DL', type: 'A321' })).toBeNull()
    expect(militaryInfo({ callsign: 'N1818C', icao24: 'a12345' })).toBeNull()
  })

  it('uses the US and UK military address blocks', () => {
    expect(militaryInfo({ callsign: 'XYZ', icao24: 'ae1234' })).toMatchObject({ by: 'address', operator: 'US military' })
    expect(militaryInfo({ icao24: 'adf7c8' })?.by).toBe('address')
    expect(militaryInfo({ icao24: 'adf7c7' })).toBeNull()
    expect(militaryInfo({ icao24: '43c0ff' })?.operator).toBe('UK military')
  })

  it('falls back to serial-style registrations and military-only types', () => {
    expect(militaryInfo({ registration: '05-5140' })?.by).toBe('registration')
    expect(militaryInfo({ type: 'C17' })?.by).toBe('type')
    expect(militaryInfo({ type: 'k35r' })?.by).toBe('type')
    expect(militaryInfo({ type: 'B752' })).toBeNull()
  })
})

describe('scoreRarity', () => {
  it('classes airports', () => {
    expect(airportClass('JFK')).toBe('gateway')
    expect(airportClass('las')).toBe('hub')
    expect(airportClass('LGA')).toBe('slot')
  })

  it('ignores everyday traffic, even the first of a type', () => {
    const r = scoreRarity(ac(), 'ORD', 0)
    expect(r.score).toBe(0)
    expect(r.notable).toBe(false)
    expect(r.reasons).toEqual([])
    expect(scoreRarity(ac({ type: 'GLF6', callsign: 'N650GD' }), 'LGA', 0).notable).toBe(false)
  })

  it('treats wide-bodies by airport kind', () => {
    expect(typeTier('B789', 'gateway')).toBe('regular')
    expect(typeTier('B789', 'hub')).toBe('occasional')
    expect(typeTier('B789', 'slot')).toBe('rare')
    expect(scoreRarity(ac({ type: 'B789' }), 'JFK', 0).notable).toBe(false)
    expect(scoreRarity(ac({ type: 'B789' }), 'LGA', 0).rare).toBe(true)
  })

  it('flags an An-124 as rare everywhere, very rare away from gateways', () => {
    const ord = scoreRarity(ac({ type: 'A124', callsign: 'ADB3402' }), 'ORD', 0)
    expect(ord.rare).toBe(true)
    expect(ord.tier).toBe('rare')
    expect(ord.reasons.map((r) => r.kind)).toEqual(['type', 'first-seen'])
    expect(scoreRarity(ac({ type: 'A124' }), 'LAS', 0).tier).toBe('very-rare')
  })

  it('makes the A380 notable at a gateway the first time and rare at a hub', () => {
    const jfk = scoreRarity(ac({ type: 'A388', callsign: 'UAE201' }), 'JFK', 0)
    expect(jfk.score).toBeGreaterThanOrEqual(NOTABLE_SCORE)
    expect(jfk.rare).toBe(false)
    // The fourth one this session isn't news any more.
    expect(scoreRarity(ac({ type: 'A388' }), 'JFK', 3).notable).toBe(false)
    expect(scoreRarity(ac({ type: 'A388' }), 'CLT', 0).rare).toBe(true)
  })

  it('adds military and VIP bonuses', () => {
    const c17 = scoreRarity(ac({ type: 'C17', callsign: 'RCH871', icao24: 'ae07e1', registration: null }), 'ORD', 0)
    expect(c17.military?.operator).toContain('Air Mobility')
    expect(c17.reasons.map((r) => r.kind)).toEqual(['type', 'military', 'first-seen'])
    expect(c17.score).toBe(Math.min(100, 60 + 25 + 8))
    // A VIP 757 (C-32) is only special because of who flies it.
    const sam = scoreRarity(ac({ type: 'B752', callsign: 'SAM44', icao24: 'ae4ae7' }), 'JFK', 0)
    expect(sam.rare).toBe(true)
    expect(sam.reasons.map((r) => r.kind)).toContain('vip')
    // A Black Hawk is military but routine near some airports.
    expect(scoreRarity(ac({ type: 'H60', callsign: 'PAT45', category: 'A7' }), 'JFK', 0).notable).toBe(false)
  })

  it('notes classics and freighters away from cargo gateways', () => {
    const dc10 = scoreRarity(ac({ type: 'DC10', callsign: 'XYZ10' }), 'DEN', 2)
    expect(dc10.reasons.some((r) => r.kind === 'classic' && r.label.includes('1970'))).toBe(true)
    const lga = scoreRarity(ac({ type: 'B77L', callsign: 'FDX1234' }), 'LGA', 0)
    expect(lga.reasons.some((r) => r.kind === 'freighter')).toBe(true)
    expect(scoreRarity(ac({ type: 'B77L', callsign: 'FDX1234' }), 'ORD', 0).reasons.some((r) => r.kind === 'freighter')).toBe(false)
  })

  it('reads unusual emitter categories when the type says nothing', () => {
    const glider = scoreRarity(ac({ type: null, category: 'B1', callsign: 'N123GL' }), 'DEN', 0)
    expect(glider.reasons[0]).toMatchObject({ kind: 'category', label: 'Glider' })
    expect(glider.rare).toBe(true)
  })

  it('is deterministic and capped at 100', () => {
    const a = ac({ type: 'B52', callsign: 'RCH1', icao24: 'ae0001' })
    expect(scoreRarity(a, 'LGA', 0)).toEqual(scoreRarity(a, 'LGA', 0))
    expect(scoreRarity(a, 'LGA', 0).score).toBe(100)
    expect(RARE_SCORE).toBeGreaterThan(NOTABLE_SCORE)
  })
})

describe('notes', () => {
  it('names types from the facts table, then the extra names, then the code', () => {
    expect(spotName('A124')).toBe('Antonov An-124 Ruslan')
    expect(spotName('B52')).toBe('Boeing B-52 Stratofortress')
    expect(spotName('ZZ99')).toBe('ZZ99')
    expect(spotName(null)).toBe('Unknown type')
  })

  it('writes a fallback line from the notes, the military info or the facts', () => {
    expect(fallbackLine('BLCF', { military: null, reasons: [] })).toContain('787')
    expect(fallbackLine('B752', { military: { by: 'callsign', operator: 'US Air Force Special Air Mission', vip: true }, reasons: [] })).toBe('A government VIP flight (US Air Force Special Air Mission).')
    expect(fallbackLine('B789', { military: null, reasons: [{ kind: 'type', label: 'Rare here', points: 60 }] })).toBe('Wide-body airliner first flown in 2013, rare here.')
  })

  it('says which way it is going', () => {
    expect(spotDirection({ onGround: false, altitudeFt: 2600, verticalRateFpm: -800, speedKt: 150 }, 600)).toBe('inbound')
    expect(spotDirection({ onGround: false, altitudeFt: 4000, verticalRateFpm: 2000, speedKt: 200 }, 600)).toBe('departing')
    expect(spotDirection({ onGround: true, altitudeFt: null, verticalRateFpm: null, speedKt: 0 }, 600)).toBe('ground')
    expect(directionText('inbound', 'ORD')).toBe('inbound to ORD')
  })
})
