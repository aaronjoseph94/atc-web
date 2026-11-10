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
        url_photo_thumbnail: 'https://airport-data.com/images/aircraft/thumbnails/001/559/001559382.jpg',
      },
      flightroute: {
        callsign: 'AAL834',
        airline: { name: 'American Airlines' },
        origin: { iata_code: 'PHX', icao_code: 'KPHX', municipality: 'Phoenix', name: 'Phoenix Sky Harbor', latitude: 33.4, longitude: -112 },
        destination: { iata_code: 'MSN', icao_code: 'KMSN', municipality: 'Madison', name: 'Dane County Regional' },
      },
    },
  }

  it('merges route, airframe and a credited photo', () => {
    const info = buildFlightInfo('AAL834', db, {
      data: [{ image: 'https://airport-data.com/images/aircraft/thumbnails/001/755/001755603.jpg', link: 'https://airport-data.com/aircraft/photo/001755603', photographer: 'Florida Metal' }],
    })
    expect(info.origin).toMatchObject({ iata: 'PHX', city: 'Phoenix', lat: 33.4 })
    expect(info.destination).toMatchObject({ iata: 'MSN', lat: null })
    expect(info.typeName).toBe('A321 231SL')
    expect(info.photo).toEqual({
      thumbnail: 'https://airport-data.com/images/aircraft/thumbnails/001/755/001755603.jpg',
      link: 'https://airport-data.com/aircraft/photo/001755603',
      photographer: 'Florida Metal',
    })
  })

  it('falls back to the database thumbnail, and refuses images from other hosts', () => {
    expect(buildFlightInfo('AAL834', db, null).photo?.photographer).toBeNull()
    const evil = buildFlightInfo('X', null, { data: [{ image: 'https://evil.example/x.jpg' }] })
    expect(evil.photo).toBeNull()
  })

  it('handles an unknown flight', () => {
    expect(buildFlightInfo('N123AB', { response: 'unknown aircraft' }, null)).toMatchObject({
      callsign: 'N123AB',
      origin: null,
      destination: null,
      typeName: null,
      photo: null,
    })
  })
})
