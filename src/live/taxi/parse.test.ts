import { describe, expect, it } from 'vitest'
import { describeTaxi, normalizeRunway, parseTaxi } from './parse'

const rw = (ref: string) => ({ kind: 'runway' as const, ref })
const tw = (ref: string) => ({ kind: 'taxiway' as const, ref })

describe('parseTaxi', () => {
  it('reads the textbook form with bare letters', () => {
    const c = parseTaxi('taxi to runway 31L via A, B, hold short of 4L')!
    expect(c.runway).toBe('31L')
    expect(c.via).toEqual(['A', 'B'])
    expect(c.holdShort).toEqual([rw('4L')])
    expect(c.pairs).toEqual([])
  })

  it('reads runway first, then the route, with phonetic words and the callsign left out', () => {
    const c = parseTaxi('JetBlue 1407, runway 31 left, taxi via Alpha, Bravo, hold short of runway 4 left.')!
    expect(c.runway).toBe('31L')
    expect(c.via).toEqual(['A', 'B'])
    expect(c.holdShort).toEqual([rw('4L')])
  })

  it('does not read an airline name as a taxiway', () => {
    const c = parseTaxi('Delta 288, runway two seven right, taxi via Bravo Kilo Foxtrot')!
    expect(c.runway).toBe('27R')
    expect(c.via).toEqual(['B', 'K', 'F'])
    // Said without pauses: the router may merge letters into double-letter names.
    expect(c.pairs).toEqual([0, 1])
  })

  it('reads number-word runways and numbered taxiways', () => {
    const c = parseTaxi('American 123 heavy, runway four left, taxi via Kilo, Kilo Alpha, cross runway three one left, hold short of Bravo')!
    expect(c.runway).toBe('4L')
    expect(c.via).toEqual(['K', 'K', 'A'])
    expect(c.pairs).toEqual([1])
    expect(c.cross).toEqual(['31L'])
    expect(c.holdShort).toEqual([tw('B')])
  })

  it('reads taxiways with numbers in several spellings', () => {
    expect(parseTaxi('taxi via Bravo one, Bravo, right on Kilo, hold short runway three one left')).toMatchObject({ via: ['B1', 'B', 'K'], holdShort: [rw('31L')] })
    expect(parseTaxi('runway 10L, taxi via M, M5, hold short of runway 10 right')).toMatchObject({ runway: '10L', via: ['M', 'M5'], holdShort: [rw('10R')] })
    expect(parseTaxi('taxi via K4, Kilo 3 and Alpha 12')).toMatchObject({ via: ['K4', 'K3', 'A12'] })
  })

  it('reads "follow the Delta" as traffic to follow', () => {
    const c = parseTaxi('United 5, follow the Delta, taxi via Alpha to runway 10 left')!
    expect(c.follow).toBe('Delta')
    expect(c.via).toEqual(['A'])
    expect(c.runway).toBe('10L')
  })

  it('reads "follow the company" without a taxiway', () => {
    const c = parseTaxi('Southwest 22, follow the company Boeing, runway one seven right, taxi via Charlie')!
    expect(c.follow).toBe('company')
    expect(c.via).toEqual(['C'])
    expect(c.runway).toBe('17R')
  })

  it('reads "continue on Alpha"', () => {
    const c = parseTaxi('continue on Alpha, hold short of Bravo')!
    expect(c.kind).toBe('continue')
    expect(c.via).toEqual(['A'])
    expect(c.holdShort).toEqual([tw('B')])
  })

  it('reads a Calgary-style clearance with a plain runway number', () => {
    const c = parseTaxi('Flair 809, taxi to runway 29 via Charlie, hold short of runway 35L')!
    expect(c.runway).toBe('29')
    expect(c.via).toEqual(['C'])
    expect(c.holdShort).toEqual([rw('35L')])
  })

  it('reads double-letter hold-short taxiways', () => {
    expect(parseTaxi('WestJet 1501, taxi via Golf Bravo, Delta, hold short of Kilo Echo')).toMatchObject({ via: ['G', 'B', 'D'], pairs: [0], holdShort: [tw('KE')] })
  })

  it('reads a destination that is not a runway', () => {
    expect(parseTaxi('taxi to the ramp via Kilo, Alpha')).toMatchObject({ destination: 'ramp', via: ['K', 'A'], runway: null })
    expect(parseTaxi('Endeavor 5245, taxi to spot 5 via Bravo')).toMatchObject({ destination: 'spot 5', via: ['B'] })
  })

  it('reads a pilot readback', () => {
    const c = parseTaxi('Taxi via Alpha Bravo hold short 4 left, JetBlue 1407')!
    expect(c.via).toEqual(['A', 'B'])
    expect(c.pairs).toEqual([0])
    expect(c.holdShort).toEqual([rw('4L')])
  })

  it('reads letters said without a pause', () => {
    const c = parseTaxi('taxi to runway 31 left via A B, hold short of 4L')!
    expect(c.via).toEqual(['A', 'B'])
    expect(c.pairs).toEqual([0])
    expect(c.runway).toBe('31L')
  })

  it('reads Atlanta-style names and "then"', () => {
    expect(parseTaxi('Delta 1234, runway 8 left, taxi via Lima, then Victor, hold short of 8 right')).toMatchObject({ runway: '8L', via: ['L', 'V'], holdShort: [rw('8R')] })
  })

  it('reads turns', () => {
    expect(parseTaxi('turn left on Echo, then right on Alpha, taxi to runway 22 right')).toMatchObject({ via: ['E', 'A'], runway: '22R' })
    expect(parseTaxi('exit left, join Bravo, taxi to the gate')).toMatchObject({ via: ['B'], destination: 'gate' })
  })

  it('reads runway designators said as "thirty one"', () => {
    expect(parseTaxi('taxi to runway thirty one right via Kilo')).toMatchObject({ runway: '31R', via: ['K'] })
  })

  it('ignores calls that are not taxi instructions', () => {
    expect(parseTaxi('Delta 288, runway 4 right, cleared to land')).toBeNull()
    expect(parseTaxi('JetBlue 1407, runway 31 left, line up and wait')).toBeNull()
    expect(parseTaxi('Ground, Delta 288, ready to taxi')).toBeNull()
    expect(parseTaxi('hold position')).toBeNull()
    expect(parseTaxi('American 12, contact departure, good day')).toBeNull()
  })

  it('does not take the destination runway from a landing clearance', () => {
    const c = parseTaxi('runway 4R cleared to land, after landing taxi via Bravo')!
    expect(c.via).toEqual(['B'])
  })
})

describe('parseTaxi, as the recogniser writes it', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['Taxi to Runway 31L via Alpha, Bravo. Hold short of Runway 4L.', { runway: '31L', via: ['A', 'B'], holdShort: [rw('4L')] }],
    ['American 12 heavy, taxi to runway 31 left via Kilo Alpha, Bravo, hold short of runway 4 left', { runway: '31L', via: ['K', 'A', 'B'], pairs: [0], holdShort: [rw('4L')] }],
    ['Air Canada 328, runway two niner, taxi via Juliet, Charlie, Foxtrot', { runway: '29', via: ['J', 'C', 'F'] }],
    ['runway one seven right via Charlie', { runway: '17R', via: ['C'] }],
    ['via Bravo Kilo Foxtrot', { via: ['B', 'K', 'F'], runway: null }],
    ['Delta 288, taxi via Delta, hold short of Delta 3', { via: ['D'], holdShort: [tw('D3')] }],
    ['taxi via B, C3, hold short of 9 right at Charlie 3', { via: ['B', 'C3'], holdShort: [rw('9R')] }],
    ['Southwest 1234, Chicago Ground, runway 22L, taxi via Bravo, Charlie, cross runway 27R, hold short of runway 22R', { runway: '22L', via: ['B', 'C'], cross: ['27R'], holdShort: [rw('22R')] }],
    ['cross runway 13 right, continue on Kilo', { kind: 'continue', via: ['K'], cross: ['13R'] }],
    ['continue straight ahead on Alpha', { kind: 'continue', via: ['A'] }],
    ['Spirit 401, taxi via Papa, Alpha, runway 28 center', { runway: '28C', via: ['P', 'A'] }],
    ['JetBlue 9999, runway 4L, taxi via A, B, K, hold short of 4R.', { runway: '4L', via: ['A', 'B', 'K'], holdShort: [rw('4R')] }],
    ['follow the Airbus, taxi via Lima', { follow: 'airbus', via: ['L'] }],
    ['Lufthansa 400 heavy, taxi via Bravo, Kilo, Kilo Echo, hold short runway 22R', { via: ['B', 'K', 'K', 'E'], pairs: [2], holdShort: [rw('22R')] }],
    ['Taxi via Hotel, Echo, Foxtrot to runway eight right.', { runway: '8R', via: ['H', 'E', 'F'] }],
  ]
  for (const [text, want] of cases) {
    it(text, () => {
      expect(parseTaxi(text)).toMatchObject(want)
    })
  }
})

describe('normalizeRunway', () => {
  it('drops leading zeros and upper-cases the side', () => {
    expect(normalizeRunway('04L')).toBe('4L')
    expect(normalizeRunway('31r')).toBe('31R')
    expect(normalizeRunway('09')).toBe('9')
  })
})

describe('describeTaxi', () => {
  it('summarises a clearance', () => {
    expect(describeTaxi(parseTaxi('taxi to runway 31L via A, B, hold short of 4L')!)).toBe('Taxi to runway 31L via A, B · hold short of runway 4L')
  })
})
