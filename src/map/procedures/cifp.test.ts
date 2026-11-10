import { describe, expect, it } from 'vitest'
import { bearingDeg, distanceM, M_PER_NM, type LngLat } from '../geo'
import { buildAirportFile } from './build'
import { approachInfo, arcPoints, buildPath, clipToRadius, departureEnd, finalLegs, formatAltitude, intercept, parseCifp, parseLatLon, parseLeg, parseMagVar, runwaysFor, simplify } from './cifp'
import { isLine, type ProcLine } from './procedures'
import SAMPLE from './testdata/sample.cifp?raw'

// Real records from the FAA CIFP (cycle 2611): JFK's ILS 22L and SKORR6, ATL's ZELAN4 runway 27R (an RF arc).
const data = parseCifp(SAMPLE, new Set(['KJFK', 'KATL']))
const nm = (a: LngLat, b: LngLat) => distanceM(a, b) / M_PER_NM

describe('record parsing', () => {
  it('reads degrees, minutes and seconds', () => {
    const p = parseLatLon('N40382374', 'W073464329')!
    expect(p[1]).toBeCloseTo(40 + 38 / 60 + 23.74 / 3600, 6)
    expect(p[0]).toBeCloseTo(-(73 + 46 / 60 + 43.29 / 3600), 6)
    expect(parseLatLon('', 'W073464329')).toBeNull()
  })

  it('reads magnetic variation', () => {
    expect(parseMagVar('W0130')).toBe(-13)
    expect(parseMagVar('E0045')).toBe(4.5)
    expect(parseMagVar('     ')).toBe(0)
  })

  it('reads a leg record', () => {
    const line = SAMPLE.split('\n').find((l) => l.includes('KJFKK6FI22L  I      020ZALPO'))!
    const leg = parseLeg(line)!
    expect(leg).toMatchObject({ seq: 20, fix: 'ZALPO', fixSec: 'PC', pt: 'CF', courseDeg: 224, distNm: 5.2, altDesc: 'H', alt1: '01800' })
    expect(leg.desc[3]).toBe('F')
  })

  it('indexes the airport, runways, fixes and procedures', () => {
    expect(data.cycle).toBe('2611')
    const jfk = data.airports.get('KJFK')!
    expect(jfk.magVar).toBe(-13)
    expect(jfk.elevationFt).toBe(13)
    expect([...jfk.runways.keys()]).toContain('RW22L')
    expect(data.fix('PC', 'ROSLY', 'K6', 'KJFK')).not.toBeNull()
    expect(data.fix('D ', 'JFK', 'K6', 'KJFK')).not.toBeNull()
    expect(data.fix('EA', 'HOGGS', 'K6', 'KJFK')).not.toBeNull()
    expect(data.fix('PC', 'NOPE', 'K6', 'KJFK')).toBeNull()
    const ids = data.procedures.filter((p) => p.airport === 'KJFK').map((p) => `${p.id}/${p.transition}`)
    expect(ids).toEqual(expect.arrayContaining(['I22L/', 'SKORR6/RW31B', 'SKORR6/YNKEE']))
  })
})

describe('names', () => {
  it('names approaches as charted and skips the kinds not drawn', () => {
    expect(approachInfo('I22L')?.name).toBe('ILS 22L')
    expect(approachInfo('R04LY')?.name).toBe('RNAV (GPS) Y 04L')
    expect(approachInfo('H05-Z')?.name).toBe('RNAV (RNP) Z 05')
    expect(approachInfo('S13L')).toBeNull()
    expect(approachInfo('R027')).toBeNull()
  })

  it('expands "both" runway transitions and finds the far end', () => {
    expect(runwaysFor('RW31B', ['RW31L', 'RW31R', 'RW13L', 'RW04R'])).toEqual(['RW31L', 'RW31R'])
    expect(runwaysFor('RW22L', [])).toEqual(['RW22L'])
    expect(runwaysFor('ALL', ['RW31L'])).toEqual([])
    const jfk = data.airports.get('KJFK')!
    expect(departureEnd('RW31L', jfk.runways)).toEqual(jfk.runways.get('RW13R'))
  })

  it('formats altitude constraints', () => {
    expect(formatAltitude('+', '03000', '')).toBe('≥3000')
    expect(formatAltitude('-', 'FL240', '')).toBe('≤FL240')
    expect(formatAltitude('B', '11000', '08000')).toBe('8000–11000')
    expect(formatAltitude(' ', '05000', '')).toBe('5000')
    expect(formatAltitude('J', '03000', '01800')).toBe('≥3000')
    expect(formatAltitude(' ', '', '')).toBeNull()
  })
})

describe('geometry', () => {
  it('draws an arc the right way round', () => {
    const c: LngLat = [-84, 33.6]
    const north: LngLat = [-84, 33.65]
    const east: LngLat = [-84 + 0.06, 33.6]
    const right = arcPoints(c, north, east, 'R')
    const left = arcPoints(c, north, east, 'L')
    // Right turn from north to east is a quarter circle; left is three quarters.
    expect(right.length).toBeLessThan(left.length)
    expect(bearingDeg(c, right[Math.floor(right.length / 2)])).toBeGreaterThan(20)
    expect(bearingDeg(c, right[Math.floor(right.length / 2)])).toBeLessThan(70)
    expect(right[right.length - 1]).toEqual(east)
  })

  it('finds where a heading meets a course', () => {
    const q: LngLat = [-73.8, 40.6]
    // Flying north from 2 nm west of a north–south line never meets it; flying east does.
    const p: LngLat = [-73.8 - 2 / 45.5, 40.6]
    expect(intercept(p, 0, q, 0)).toBeNull()
    const hit = intercept(p, 90, q, 0)!
    expect(nm(hit, q)).toBeLessThan(0.05)
  })

  it('stops approaches at the missed approach point', () => {
    const app = data.procedures.find((p) => p.airport === 'KJFK' && p.id === 'I22L' && p.routeType === 'I')!
    const legs = finalLegs(app.legs)
    expect(legs.map((l) => l.fix)).toEqual(['ROSLY', 'ZALPO', 'RW22L'])
    const built = buildPath(legs, { airport: data.airports.get('KJFK')!, fix: data.fix })
    expect(built.coords).toHaveLength(3)
    expect(built.fixes.map((f) => [f.ident, f.alt, f.role])).toEqual([
      ['ROSLY', '≥3000', 'IF'],
      ['ZALPO', '≥1800', 'FAF'],
    ])
    // The final runs south-west into runway 22L.
    expect(bearingDeg(built.coords[1], built.coords[2])).toBeGreaterThan(200)
    expect(bearingDeg(built.coords[1], built.coords[2])).toBeLessThan(215)
  })

  it('draws a departure heading as a stub from the runway end, then direct to the fix', () => {
    const jfk = data.airports.get('KJFK')!
    const sid = data.procedures.find((p) => p.airport === 'KJFK' && p.id === 'SKORR6' && p.transition === 'RW31B')!
    const start = departureEnd('RW31L', jfk.runways)!
    const built = buildPath(sid.legs, { airport: jfk, fix: data.fix, start })
    expect(built.coords[0]).toEqual(start)
    // Heading 313.8 magnetic is about 301 true; the stub is short at a sea-level field.
    const stub = built.coords[1]
    expect(bearingDeg(start, stub)).toBeCloseTo(313.8 - 13, 0)
    expect(nm(start, stub)).toBeGreaterThan(0.9)
    expect(nm(start, stub)).toBeLessThan(2.1)
    expect(built.coords[2]).toEqual(data.fix('PC', 'SKORR', 'K6', 'KJFK'))
  })

  it('follows an RF leg around its centre', () => {
    const atl = data.airports.get('KATL')!
    const sid = data.procedures.find((p) => p.airport === 'KATL' && p.id === 'ZELAN4')!
    const built = buildPath(sid.legs, { airport: atl, fix: data.fix })
    const centre = data.fix('PC', 'CFZJF', 'K7', 'KATL')!
    const mpass = data.fix('PC', 'MPASS', 'K7', 'KATL')!
    const arc = built.coords.slice(1, built.coords.indexOf(mpass) + 1)
    expect(arc.length).toBeGreaterThan(5)
    for (const p of arc) expect(nm(p, centre)).toBeCloseTo(3.46, 0)
  })

  it('simplifies straight runs and keeps corners', () => {
    const line: LngLat[] = [
      [0, 0],
      [0.001, 0.00000001],
      [0.002, 0],
      [0.002, 0.01],
    ]
    expect(simplify(line, 5)).toEqual([line[0], line[2], line[3]])
  })

  it('clips a line to a radius', () => {
    const c: LngLat = [-73.8, 40.6]
    const far: LngLat = [-73.8, 40.6 + 2]
    const runs = clipToRadius([c, far], c, 30)
    expect(runs).toHaveLength(1)
    expect(nm(c, runs[0][1])).toBeCloseTo(30, 0)
    expect(clipToRadius([[-70, 40.6], [-70, 41]], c, 30)).toEqual([])
  })
})

describe('airport file', () => {
  const file = buildAirportFile(data, 'KJFK')!
  const lines = file.features.filter(isLine) as ProcLine[]

  it('names the final after the ILS and lists the approaches that share it', () => {
    const finals = lines.filter((l) => l.properties.k === 'final')
    expect(finals).toHaveLength(1)
    expect(finals[0].properties).toMatchObject({ n: 'ILS 22L', rw: '22L', also: 'LOC 22L' })
  })

  it('splits a two-runway departure transition and names each', () => {
    const sids = lines.filter((l) => l.properties.n === 'SKORR6 departure').map((l) => l.properties.t)
    expect(sids).toEqual(expect.arrayContaining(['Runway 31L', 'Runway 31R', 'YNKEE transition']))
  })

  it('marks approach fixes and the final approach fix, rounded to 5 decimals', () => {
    const zalpo = file.features.find((f) => f.properties.k === 'fix' && f.properties.n === 'ZALPO')!
    expect(zalpo.properties).toMatchObject({ a: '≥1800', f: 1, faf: 1 })
    for (const f of file.features) {
      const cs = (f.geometry.type === 'Point' ? [f.geometry.coordinates] : f.geometry.coordinates) as LngLat[]
      for (const c of cs) for (const v of c) expect(Math.round(v * 1e5) / 1e5).toBe(v)
    }
  })
})
