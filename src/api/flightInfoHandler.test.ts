import { describe, expect, it } from 'vitest'
import { buildFlightInfo, parseFlightQuery } from './flightInfoHandler'

describe('parseFlightQuery', () => {
  it('accepts a hex and a callsign', () => {
    expect(parseFlightQuery('A09CAD', ' aal834 ')).toEqual({ hex: 'a09cad', callsign: 'AAL834' })
  })

  it('rejects junk and the hex-as-callsign fallback', () => {
    expect(parseFlightQuery('../etc', 'AAL 834?x=1')).toEqual({ hex: null, callsign: null })
    expect(parseFlightQuery('a09cad', 'A09CAD')).toEqual({ hex: 'a09cad', callsign: null })
  })
})

describe('buildFlightInfo', () => {
  const db = {
    response: {
      aircraft: {
        type: 'A321 231SL',
        manufacturer: 'Airbus',
        registration: 'N139AN',
        registered_owner: 'American Airlines',
      },
      flightroute: {
        callsign: 'AAL834',
        airline: { name: 'American Airlines' },
        origin: { iata_code: 'PHX', icao_code: 'KPHX', municipality: 'Phoenix', name: 'Phoenix Sky Harbor', latitude: 33.4, longitude: -112 },
        destination: { iata_code: 'MSN', icao_code: 'KMSN', municipality: 'Madison', name: 'Dane County Regional' },
      },
    },
  }

  it('merges route and airframe', () => {
    const info = buildFlightInfo('AAL834', db)
    expect(info.origin).toMatchObject({ iata: 'PHX', city: 'Phoenix', lat: 33.4 })
    expect(info.destination).toMatchObject({ iata: 'MSN', lat: null })
    expect(info.typeName).toBe('A321 231SL')
    expect(info.registration).toBe('N139AN')
    expect(info.airline).toBe('American Airlines')
  })

  it('carries no photo: the flight view draws the type instead', () => {
    expect('photo' in buildFlightInfo('AAL834', db)).toBe(false)
  })

  it('handles an unknown flight', () => {
    expect(buildFlightInfo('N123AB', { response: 'unknown aircraft' })).toMatchObject({
      callsign: 'N123AB',
      origin: null,
      destination: null,
      typeName: null,
    })
  })
})
