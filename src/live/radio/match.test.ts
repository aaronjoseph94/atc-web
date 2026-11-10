import { describe, expect, it } from 'vitest'
import { findCallsigns } from './callsigns'
import { fit, matchMentions, oneEditApart, splitFlight } from './match'

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

  it('scores suffix letters', () => {
    const [m] = findCallsigns('Speedbird 14')
    expect(fit(m, ac('b1', 'BAW14K'))).toBeGreaterThan(0.8)
    const [k] = findCallsigns('Speedbird 14 Kilo')
    expect(fit(k, ac('b1', 'BAW14K'))).toBe(1)
  })
})
