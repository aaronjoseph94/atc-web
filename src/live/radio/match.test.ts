import { describe, expect, it } from 'vitest'
import { findCallsigns } from './callsigns'
import { atOtherField, fit, matchMentions, oneEditApart, placeBonus, splitFlight } from './match'

type A = { icao24: string; callsign: string; onGround: boolean; altitudeFt: number | null; registration?: string | null }
const ac = (icao24: string, callsign: string, onGround = true, altitudeFt: number | null = null, registration: string | null = null): A => ({ icao24, callsign, onGround, altitudeFt, registration })

const traffic: A[] = [
  ac('a1', 'DAL288'),
  ac('a2', 'AAL2292', false, 2400),
  ac('a3', 'JBU1407'),
  ac('a4', 'EDV5155', false, 3000),
  ac('a5', 'N1818C', true, null, 'N1818C'),
  ac('a6', 'KLM678'),
  ac('a7', 'FLE809'),
  ac('a8', 'WJA1501'),
  ac('a9', 'CGENW', true, null, 'C-GENW'),
  ac('b1', 'BAW14K', false, 1800),
  ac('b2', 'UAL1234', false, 34000),
]
const heard = (text: string, stationKind?: 'TWR' | 'GND' | 'APP') => matchMentions(findCallsigns(text), traffic, { stationKind }).map((m) => m.icao24)

describe('splitFlight / oneEditApart', () => {
  it('splits airline callsigns', () => {
    expect(splitFlight('DAL288')).toEqual({ prefix: 'DAL', digits: '288', suffix: '' })
    expect(splitFlight('BAW14K')).toEqual({ prefix: 'BAW', digits: '14', suffix: 'K' })
    expect(splitFlight('DAL0288')).toEqual({ prefix: 'DAL', digits: '288', suffix: '' })
    expect(splitFlight('N1818C')).toBeNull()
  })
  it('measures one-character slips', () => {
    expect(oneEditApart('288', '289')).toBe(true)
    expect(oneEditApart('288', '2888')).toBe(true)
    expect(oneEditApart('2292', '292')).toBe(true)
    expect(oneEditApart('288', '288')).toBe(false)
    expect(oneEditApart('288', '199')).toBe(false)
  })
})

describe('matchMentions', () => {
  it('matches the reference calls exactly', () => {
    expect(heard('KLM 678 heavy, Tower, line up and wait runway 17R')).toEqual(['a6'])
    expect(heard('Flair 809, Clearance')).toEqual(['a7'])
    expect(heard('Ground, hello, WestJet 1501 exiting D3 for 83', 'GND')).toEqual(['a8'])
    expect(heard('Golf Echo November Whiskey, taxi via Charlie')).toEqual(['a9'])
    expect(heard('November one eight one eight Charlie, cleared for takeoff')).toEqual(['a5'])
    expect(heard('Speedbird one four kilo, contact departure')).toEqual(['b1'])
  })

  it('forgives one misheard digit, but only when nothing better fits', () => {
    expect(heard('Delta 289, taxi via Bravo', 'GND')).toEqual(['a1'])
    expect(heard('American 292, runway 31 left, cleared to land', 'TWR')).toEqual(['a2'])
    // Two digits wrong is somebody else.
    expect(heard('Delta 299')).toEqual([])
  })

  it('weighs the station role', () => {
    const [m] = matchMentions(findCallsigns('Delta 288'), traffic, { stationKind: 'GND' })
    const [n] = matchMentions(findCallsigns('Delta 288'), traffic, { stationKind: 'APP' })
    expect(m.confidence).toBeGreaterThan(n.confidence)
    // A fuzzy guess at an airborne aircraft from Ground is not good enough.
    expect(heard('American 2293', 'GND')).toEqual([])
  })

  it('refuses near-ties', () => {
    const twins = [ac('x1', 'DAL1281'), ac('x2', 'DAL1283')]
    expect(matchMentions(findCallsigns('Delta 1282'), twins)).toEqual([])
    expect(matchMentions(findCallsigns('Delta 1281'), twins).map((m) => m.icao24)).toEqual(['x1'])
  })

  it('matches short tail numbers by their ending', () => {
    expect(heard('Cessna one eight Charlie, runway 31')).toEqual(['a5'])
    const two = [ac('g1', 'N123AB', true, null, 'N123AB'), ac('g2', 'N456AB', true, null, 'N456AB')]
    expect(matchMentions(findCallsigns('Cessna alpha bravo'), two)).toEqual([])
  })

  it('finds both parties in a traffic call', () => {
    expect(heard('JetBlue 1407, follow the Delta 288, Delta 288 on your left', 'GND')).toEqual(['a3', 'a1'])
  })

  it('treats a taxiway that looks like a callsign with suspicion', () => {
    const taxi = [ac('t1', 'DAL3')]
    expect(matchMentions(findCallsigns('turn right on Delta 3'), taxi)).toEqual([])
  })

  it('falls back to a clean flight number when the airline name is misheard', () => {
    const lax = [ac('v1', 'VOI7721', true), ac('u1', 'UAL580', true), ac('s1', 'SWA2518', true)]
    const heardAt = (text: string) => matchMentions(findCallsigns(text), lax, { stationKind: 'TWR' }).map((m) => m.icao24)
    expect(heardAt('Spire 7721, contact departure, good day')).toEqual(['v1'])
    expect(heardAt('Nova Tire, runway 24 left, line up and wait, Southwist 2518')).toEqual(['s1'])
    // Numbers in the middle of an instruction are not callsigns.
    expect(heardAt('United 580, runway 25 right, wind 0804, descend and maintain 7721')).toEqual(['u1'])
    expect(heardAt('Taxi via Charlie, gate 2518')).toEqual([])
    // Two aircraft share the number: too risky.
    expect(matchMentions(findCallsigns('Spire 7721, contact departure'), [ac('a', 'VOI7721'), ac('b', 'DAL7721')])).toEqual([])
  })

  it('scores suffix letters', () => {
    const [m] = findCallsigns('Speedbird 14')
    expect(fit(m, ac('b1', 'BAW14K'))).toBeGreaterThan(0.8)
    const [k] = findCallsigns('Speedbird 14 Kilo')
    expect(fit(k, ac('b1', 'BAW14K'))).toBe(1)
  })
})

describe('the field the frequency belongs to', () => {
  // JFK, with LaGuardia 9 nm to the north-west inside the same feed circle.
  const jfk = { center: [-73.7781, 40.6413] as [number, number], elevationFt: 13 }
  const at = (icao24: string, callsign: string, lon: number, lat: number, onGround = true, altitudeFt: number | null = null) => ({ ...ac(icao24, callsign, onGround, altitudeFt), lon, lat })
  const atJfk = at('j1', 'DAL288', -73.785, 40.645)
  const atLga = at('l1', 'DAL287', -73.874, 40.7769)

  it('knows an aircraft on the ground at another airport', () => {
    expect(atOtherField(atJfk, jfk)).toBe(false)
    expect(atOtherField(atLga, jfk)).toBe(true)
    // In the air over LaGuardia it may well be on its way here.
    expect(atOtherField({ ...atLga, onGround: false }, jfk)).toBe(false)
    // Without a position nothing can be said.
    expect(atOtherField(ac('x', 'DAL1'), jfk)).toBe(false)
  })

  it('prefers this field\'s traffic', () => {
    expect(placeBonus(atJfk, jfk)).toBeGreaterThan(0)
    expect(placeBonus(atLga, jfk)).toBeLessThan(0)
    // Low and far out: someone else's circuit. Higher on the way in: fine.
    expect(placeBonus(at('c1', 'N1', -73.6, 40.75, false, 900), jfk)).toBeLessThan(0)
    expect(placeBonus(at('c2', 'N2', -73.6, 40.75, false, 4000), jfk)).toBe(0)
    expect(placeBonus(atJfk, undefined)).toBe(0)
  })

  it('settles a near-miss between two airports for the one being listened to', () => {
    const slip = findCallsigns('Delta 289, taxi via Alpha')
    // Without knowing where the field is, the two one-digit slips tie and nothing is matched.
    expect(matchMentions(slip, [atJfk, atLga], { stationKind: 'GND' })).toEqual([])
    expect(matchMentions(slip, [atJfk, atLga], { stationKind: 'GND', field: jfk }).map((m) => m.icao24)).toEqual(['j1'])
  })

  it('still matches an exact callsign at the other airport, but not a slip', () => {
    expect(matchMentions(findCallsigns('Delta 287, taxi via Alpha'), [atLga], { stationKind: 'GND', field: jfk }).map((m) => m.icao24)).toEqual(['l1'])
    expect(matchMentions(findCallsigns('Delta 286, taxi via Alpha'), [atLga], { stationKind: 'GND', field: jfk })).toEqual([])
  })
})
