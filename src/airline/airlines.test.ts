import { describe, expect, it } from 'vitest'
import { airlineInfo, brandFor, flightDesignator, logoCandidates, parseCallsign } from './airlines'

describe('parseCallsign', () => {
  it('splits airline callsigns into prefix and flight number', () => {
    expect(parseCallsign('DAL227')).toEqual({ prefix: 'DAL', number: 227 })
    expect(parseCallsign('ETD8NY')).toEqual({ prefix: 'ETD', number: 8 })
    expect(parseCallsign(' klm678 ')).toEqual({ prefix: 'KLM', number: 678 })
    expect(parseCallsign('CLX9')).toEqual({ prefix: 'CLX', number: 9 })
  })

  it('rejects registrations and junk', () => {
    expect(parseCallsign('N1818C')).toBeNull()
    expect(parseCallsign('CGENW')).toBeNull()
    expect(parseCallsign('GABCD')).toBeNull()
    expect(parseCallsign('DAL')).toBeNull()
    expect(parseCallsign('')).toBeNull()
    expect(parseCallsign(null)).toBeNull()
  })
})

describe('brandFor', () => {
  it('keeps mainline flights on their own brand', () => {
    expect(brandFor('DAL227')).toEqual({ operator: 'DAL', brand: 'DAL' })
    expect(brandFor('KLM678')).toEqual({ operator: 'KLM', brand: 'KLM' })
    expect(brandFor('JBU1407')).toEqual({ operator: 'JBU', brand: 'JBU' })
  })

  it('puts regional flights under the brand they fly for, as the reference does', () => {
    expect(brandFor('EDV5394')?.brand).toBe('DAL')
    expect(brandFor('JZA408')?.brand).toBe('ACA')
    expect(brandFor('ENY3600')?.brand).toBe('AAL')
    expect(brandFor('PDT5001')?.brand).toBe('AAL')
    expect(brandFor('JIA5200')?.brand).toBe('AAL')
    expect(brandFor('ASH6001')?.brand).toBe('UAL')
    expect(brandFor('GJS4400')?.brand).toBe('UAL')
    expect(brandFor('UCA4800')?.brand).toBe('UAL')
    expect(brandFor('QXE2100')?.brand).toBe('ASA')
    expect(brandFor('WEN3100')?.brand).toBe('WJA')
  })

  it('tells Republic flights apart by flight number', () => {
    // From the reference: RPA5609 and RPA5768 wear Delta, RPA4445 American.
    expect(brandFor('RPA5609')?.brand).toBe('DAL')
    expect(brandFor('RPA5768')?.brand).toBe('DAL')
    expect(brandFor('RPA4445')?.brand).toBe('AAL')
    expect(brandFor('RPA3512')?.brand).toBe('UAL')
    expect(brandFor('RPA7001')?.brand).toBe('RPA')
  })

  it('tells SkyWest flights apart where the number says, else keeps SkyWest', () => {
    expect(brandFor('SKW5446')?.brand).toBe('UAL')
    expect(brandFor('SKW3854')?.brand).toBe('DAL')
    expect(brandFor('SKW3201')?.brand).toBe('SKW')
  })

  it('has nothing for private aircraft', () => {
    expect(brandFor('N1818C')).toBeNull()
    expect(brandFor('CGENW')).toBeNull()
  })
})

describe('logoCandidates', () => {
  it('tries the brand first, then the operator', () => {
    expect(logoCandidates('EDV4918')).toEqual(['DAL', 'EDV'])
    expect(logoCandidates('AAL1442')).toEqual(['AAL'])
    expect(logoCandidates('N1818C')).toEqual([])
  })
})

describe('airlineInfo', () => {
  it('names airlines and gives their IATA code', () => {
    expect(airlineInfo('DAL')).toEqual({ icao: 'DAL', iata: 'DL', name: 'Delta' })
    expect(airlineInfo('etd')?.name).toBe('Etihad')
    expect(airlineInfo('SHT')?.iata).toBeNull()
    expect(airlineInfo('ZZZ')).toBeNull()
    expect(airlineInfo(null)).toBeNull()
  })
})

describe('flightDesignator', () => {
  it('turns radio callsigns into the flight numbers on tickets', () => {
    expect(flightDesignator('DAL189')?.text).toBe('DL 189')
    expect(flightDesignator('UAL0012')?.text).toBe('UA 12')
    expect(flightDesignator('KLM678')?.text).toBe('KL 678')
    expect(flightDesignator(' baw12a ')?.text).toBe('BA 12A')
    expect(flightDesignator('DAL189')?.brand.name).toBe('Delta')
  })

  it('sells regional flights under their brand', () => {
    const d = flightDesignator('EDV5394')!
    expect(d.text).toBe('DL 5394')
    expect(d.operator?.icao).toBe('EDV')
    expect(d.brand.icao).toBe('DAL')
    expect(flightDesignator('SKW5432')?.text).toBe('UA 5432')
    // SkyWest numbers that don't say whose flight it is keep SkyWest's own code.
    expect(flightDesignator('SKW3101')?.text).toBe('OO 3101')
  })

  it('says nothing when the callsign does not spell a flight number', () => {
    expect(flightDesignator('ETD8NY')).toBeNull()
    expect(flightDesignator('BAW9GE')).toBeNull()
    expect(flightDesignator('N1818C')).toBeNull()
    expect(flightDesignator('ZZZ123')).toBeNull()
    expect(flightDesignator('')).toBeNull()
    expect(flightDesignator(null)).toBeNull()
  })
})
